import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, defer, EMPTY, exhaustMap, filter, finalize, forkJoin, map, Observable, Subscription, switchMap, tap, timer } from 'rxjs';
import { ParticipantCardComponent } from '@app/components/group-orders/participant-card/participant-card.component';
import { InviteLinkPanelComponent } from '@app/components/reservations/invite-link-panel/invite-link-panel.component';
import { GroupSessionsResponse } from '@app/models/group-orders/group-sessions-response.model';
import { GroupReservationStatus } from '@app/models/group-orders/group-status.model';
import { Participant } from '@app/models/group-orders/participant.model';
import { GuestInvite } from '@app/models/reservations/guest-invite.model';
import { GroupOrdersService } from '@app/services/group-orders/group-orders.service';
import { ToastService } from '@app/services/toast/toast.service';
import { ModalComponent } from '@app/shared/custom-components/modal/modal.component';
import { consolidatePreOrder } from '@app/shared/helpers/consolidate-pre-order';
import { SYNC_INTERVAL_MS, STATUS_LABELS } from './constants';
import { ConsolidatedLine, LoadState, ParticipantCardView } from './models';

@Component({
  selector: 'app-group-order-page',
  imports: [CurrencyPipe, DatePipe, ModalComponent, ParticipantCardComponent, InviteLinkPanelComponent],
  templateUrl: './group-order-page.component.html',
  styleUrl: './group-order-page.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class GroupOrderPageComponent implements OnInit {
  private readonly groupOrdersService = inject(GroupOrdersService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  readonly reservationId = inject(ActivatedRoute).snapshot.paramMap.get('reservationId') ?? '';

  private loadSubscription?: Subscription;
  private syncSubscription?: Subscription;

  readonly loadState = signal<LoadState>('loading');
  readonly isNotFound = signal(false);
  readonly invite = signal<GuestInvite | null>(null);
  readonly participants = signal<Participant[]>([]);
  readonly ownerSessionId = signal<string | null>(null);
  readonly status = signal<GroupReservationStatus>('Open');
  readonly lastUpdated = signal<Date | null>(null);
  readonly refreshFailed = signal(false);
  readonly isSyncing = signal(false);

  readonly isInviteOpen = signal(false);
  readonly isSubmitDialogOpen = signal(false);
  readonly isSubmitting = signal(false);
  readonly guestToRemove = signal<Participant | null>(null);
  readonly isRemoving = signal(false);

  readonly isOpen = computed(() => this.status() === 'Open');
  readonly statusLabel = computed(() => STATUS_LABELS[this.status()]);

  /** Only submitted carts go to the restaurant — this, not `total` from the API, is the Grand Total. */
  readonly consolidated = computed(() => consolidatePreOrder(this.participants()));
  readonly consolidatedLines = computed<ConsolidatedLine[]>(() =>
    this.consolidated().items.map((item) => ({ ...item, lineTotal: item.dish.price * item.quantity })),
  );
  readonly grandTotal = computed(() => this.consolidated().total);

  readonly isEmpty = computed(() => this.participants().every((person) => person.items.length === 0));

  readonly pendingMessage = computed(() => {
    const count = this.participants().filter((person) => !person.isSubmitted).length;
    if (count === 0) return null;
    const who = count === 1 ? '1 participant hasn’t' : `${count} participants haven’t`;
    return `${who} submitted their cart yet — their dishes won’t be included in the order`;
  });

  readonly guestsLabel = computed(() => {
    const maxGuests = this.invite()?.MaxGuestCount;
    const joined = this.participants().length;
    return maxGuests ? `${joined} of ${maxGuests} guests` : `${joined} guests`;
  });

  readonly cards = computed<ParticipantCardView[]>(() =>
    this.participants().map((participant) => ({
      participant,
      isMe: participant.id === this.ownerSessionId(),
      canRemove: this.isOpen() && participant.type === 'Guest',
    })),
  );

  readonly canSubmit = computed(
    () => this.isOpen() && this.consolidated().items.length > 0 && !this.isSubmitting(),
  );

  private get groupReservationId(): string {
    return this.invite()?.GroupReservationId ?? '';
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    // «Try again» replaces the previous load and timer instead of adding a second one.
    this.loadSubscription?.unsubscribe();
    this.stopSync();
    this.loadState.set('loading');
    this.isNotFound.set(false);

    this.loadSubscription = this.groupOrdersService
      .getGroupInvite$(this.reservationId)
      .pipe(
        switchMap((invite) =>
          forkJoin({
            sessions: this.groupOrdersService.getSessions$(invite.GroupReservationId),
            ownerSessionId: this.groupOrdersService.getOwnerSessionId$(this.reservationId),
            groupStatus: this.groupOrdersService.getStatus$(invite.GroupReservationId),
          }).pipe(map((data) => ({ invite, ...data }))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ invite, sessions, ownerSessionId, groupStatus }) => {
          this.invite.set(invite);
          this.ownerSessionId.set(ownerSessionId);
          this.applySnapshot(sessions, groupStatus.status);
          this.loadState.set('ready');
          if (this.isOpen()) this.startSync();
        },
        error: (error: unknown) => {
          this.isNotFound.set(error instanceof HttpErrorResponse && error.status === 404);
          this.loadState.set('error');
        },
      });
  }

  refresh(): void {
    if (this.isSyncing()) return;
    this.syncNow$().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  openSubmitDialog(): void {
    if (this.canSubmit()) this.isSubmitDialogOpen.set(true);
  }

  closeSubmitDialog(): void {
    if (!this.isSubmitting()) this.isSubmitDialogOpen.set(false);
  }

  confirmSubmit(): void {
    if (this.isSubmitting()) return;
    this.isSubmitting.set(true);

    this.groupOrdersService
      .submit$(this.groupReservationId, this.reservationId)
      .pipe(
        finalize(() => this.isSubmitting.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.status.set('Submitted');
          this.stopSync();
          this.isSubmitDialogOpen.set(false);
          this.toastService.success('Pre-order sent to the restaurant');
        },
        // tokenInterceptor already shows the API error as a toast; the screen stays usable.
        error: () => this.isSubmitDialogOpen.set(false),
      });
  }

  requestRemove(participant: Participant): void {
    this.guestToRemove.set(participant);
  }

  closeRemoveDialog(): void {
    if (!this.isRemoving()) this.guestToRemove.set(null);
  }

  confirmRemove(): void {
    const guest = this.guestToRemove();
    if (!guest || this.isRemoving()) return;
    this.isRemoving.set(true);

    this.groupOrdersService
      .removeSession$(this.groupReservationId, guest.id)
      .pipe(
        finalize(() => this.isRemoving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (snapshot) => {
          this.applySnapshot(snapshot, this.status());
          this.guestToRemove.set(null);
          this.toastService.success(`${guest.name} was removed from the reservation`);
        },
        error: () => this.guestToRemove.set(null),
      });
  }

  private startSync(): void {
    this.syncSubscription?.unsubscribe();
    this.syncSubscription = timer(SYNC_INTERVAL_MS, SYNC_INTERVAL_MS)
      .pipe(
        // A manual Refresh may already be in flight; exhaustMap covers the timer's own requests.
        filter(() => !this.isSyncing()),
        exhaustMap(() => this.syncNow$()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  private stopSync(): void {
    this.syncSubscription?.unsubscribe();
    this.syncSubscription = undefined;
  }

  /** Silent refresh: no full-screen loader, no error toast; on failure the last data stays on screen. */
  private syncNow$(): Observable<unknown> {
    return defer(() => {
      this.isSyncing.set(true);
      return forkJoin({
        sessions: this.groupOrdersService.getSessions$(this.groupReservationId, { silent: true }),
        groupStatus: this.groupOrdersService.getStatus$(this.groupReservationId, { silent: true }),
      });
    }).pipe(
      tap(({ sessions, groupStatus }) => {
        this.applySnapshot(sessions, groupStatus.status);
        if (!this.isOpen()) this.stopSync();
      }),
      catchError(() => {
        this.refreshFailed.set(true);
        return EMPTY;
      }),
      finalize(() => this.isSyncing.set(false)),
    );
  }

  private applySnapshot(sessions: GroupSessionsResponse, status: GroupReservationStatus): void {
    this.participants.set(sessions.participants);
    this.status.set(status);
    this.lastUpdated.set(new Date());
    this.refreshFailed.set(false);
  }
}
