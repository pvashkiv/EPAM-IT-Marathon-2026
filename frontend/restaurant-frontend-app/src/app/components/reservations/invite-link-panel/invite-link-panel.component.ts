import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import QRCodeStyling from 'qr-code-styling';
import { GuestInviteService } from '@app/services/reservation/guest-invite.service';
import { ToastService } from '@app/services/toast/toast.service';

const QR_SIZE_PX = 168;

/** Invite link of a group reservation: read-only field, copy button and a QR code for phones. */
@Component({
  selector: 'app-invite-link-panel',
  templateUrl: './invite-link-panel.component.html',
  styleUrl: './invite-link-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class InviteLinkPanelComponent implements OnInit {
  private readonly toastService = inject(ToastService);
  private readonly guestInviteService = inject(GuestInviteService);
  private readonly destroyRef = inject(DestroyRef);

  readonly reservationId = input.required<string>();

  private readonly qrHost = viewChild<ElementRef<HTMLElement>>('qrHost');

  private readonly inviteToken = signal<string | null>(null);
  private readonly tokenLoading = signal(false);
  private readonly tokenFailed = signal(false);

  readonly inviteLink = computed(() => {
    const token = this.inviteToken();
    return token ? `${window.location.origin}/join/${token}` : null;
  });

  readonly invitePlaceholder = computed(() => {
    if (this.tokenFailed()) {
      return 'Link is unavailable';
    }
    return this.tokenLoading() ? 'Generating link...' : 'Link will be available soon';
  });

  constructor() {
    // The QR host only exists once the link is known, so draw when both are ready.
    effect(() => {
      const link = this.inviteLink();
      const host = this.qrHost()?.nativeElement;
      if (!link || !host) {
        return;
      }

      host.replaceChildren();
      new QRCodeStyling({
        width: QR_SIZE_PX,
        height: QR_SIZE_PX,
        type: 'svg',
        data: link,
        margin: 4,
        dotsOptions: { color: '#0b5b29', type: 'rounded' },
        backgroundOptions: { color: '#ffffff' },
      }).append(host);
    });
  }

  ngOnInit(): void {
    this.tokenLoading.set(true);
    this.guestInviteService
      .getInviteToken$(this.reservationId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ token }) => {
          this.inviteToken.set(token);
          this.tokenLoading.set(false);
        },
        error: () => {
          this.tokenLoading.set(false);
          this.tokenFailed.set(true);
          this.toastService.error('Could not load the invite link. Please try again later.');
        },
      });
  }

  async onCopyLink(): Promise<void> {
    const link = this.inviteLink();
    if (!link) {
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      this.toastService.success('Share it with your friends.', 'Link copied!');
    } catch {
      this.toastService.error('Could not copy the link. Please copy it manually.');
    }
  }
}
