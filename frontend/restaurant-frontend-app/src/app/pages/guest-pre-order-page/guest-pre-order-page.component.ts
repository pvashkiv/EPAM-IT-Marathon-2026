import { Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, exhaustMap, map, Observable, takeWhile, tap, timer } from 'rxjs';

import { DishListResponse } from '@app/models/dishes/dish-list-response.model';
import { GroupBoardResponse, GroupFavouriteDish } from '@app/models/group-orders/group-board.model';
import { GuestMenuDish, GuestSessionsService } from '@app/services/guest-sessions/guest-sessions.service';
import { DishCardComponent } from '@app/shared/custom-components/dish-card/dish-card.component';
import { MainCoverImageComponent } from '@app/shared/custom-components/main-cover-image/main-cover-image.component';
import { ToastService } from '@app/services/toast/toast.service';
import { GuestPreorderStore } from './state/guest-preorder.store';

import { GuestNameModalComponent } from './ui/guest-name-modal/guest-name-modal.component';
import { GuestCartDrawerComponent } from './ui/guest-cart-drawer/guest-cart-drawer.component';
import { GuestPreorderSubmittedComponent } from './ui/guest-preorder-submitted/guest-preorder-submitted.component';
import { GuestGroupBoardComponent } from './ui/guest-group-board/guest-group-board.component';

const GROUP_BOARD_REFRESH_MS = 15_000;

@Component({
    standalone: true,
    selector: 'app-guest-pre-order-page',
    templateUrl: './guest-pre-order-page.component.html',
    styleUrl: './guest-pre-order-page.component.scss',
    imports: [
        RouterLink,
        DishCardComponent,
        MainCoverImageComponent,
        GuestNameModalComponent,
        GuestCartDrawerComponent,
        GuestPreorderSubmittedComponent,
        GuestGroupBoardComponent
    ],
})
export class GuestPreOrderPageComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly toast = inject(ToastService);
    private readonly guestSessionsService = inject(GuestSessionsService);
    private readonly destroyRef = inject(DestroyRef);

    readonly store = inject(GuestPreorderStore);
    readonly isCartOpen = signal(false);
    readonly selectedCategory = signal<string | null>(null);
    readonly selectedSort = signal<'recommended' | 'price-asc' | 'price-desc'>('recommended');

    readonly groupBoard = signal<GroupBoardResponse | null>(null);
    readonly groupBoardUpdatedAt = signal<Date | null>(null);
    readonly groupBoardRefreshFailed = signal(false);
    readonly canAddFromBoard = computed(() =>
        this.store.status() === 'active' && this.groupBoard()?.status === 'Open'
    );

    readonly categoryOptions = computed(() =>
        this.store.menuCategories().map(key => ({ key, label: this.categoryLabel(key) }))
    );

    readonly visibleDishes = computed(() => {
        const selectedCategory = this.selectedCategory();
        const dishes = Object.entries(this.store.menuByCategory())
            .filter(([category]) => !selectedCategory || category === selectedCategory)
            .flatMap(([category, categoryDishes]) =>
                categoryDishes.map(dish => this.toCardDish(dish, category))
            );

        switch (this.selectedSort()) {
            case 'price-asc':
                return dishes.sort((a, b) => a.price - b.price);
            case 'price-desc':
                return dishes.sort((a, b) => b.price - a.price);
            default:
                return dishes;
        }
    });

    // token from /guest-pre-order/:token
    readonly token = toSignal(
        this.route.paramMap.pipe(map(pm => pm.get('token') ?? '')),
        { initialValue: '' }
    );

    constructor() {
        // init store by token
        effect(() => {
            const t = this.token();
            if (t) this.store.initContext(t);
        });

        // Live group board: refresh every 15 s while the group is open; stops on leave or once the host submits.
        effect(onCleanup => {
            const sessionId = this.store.guestSessionId();
            const sessionToken = this.store.guestSessionToken();
            if (!sessionId || !sessionToken) return;

            const subscription = timer(0, GROUP_BOARD_REFRESH_MS)
                .pipe(
                    exhaustMap(() => this.loadGroupBoard$(sessionId, sessionToken)),
                    takeWhile(board => board.status === 'Open'),
                )
                .subscribe();
            onCleanup(() => subscription.unsubscribe());
        });

        // Show my own "Ready" right after I submit instead of waiting for the next tick.
        effect(() => {
            if (this.store.status() === 'submitted') untracked(() => this.refreshGroupBoard());
        });

        // Redirect only for an invite that the backend confirms is invalid or expired.
        effect(() => {
            if (this.store.inviteError() === 'expired') {
                this.router.navigateByUrl('/guest-pre-order-expired');
            }
        });
    }

    openCart() { this.isCartOpen.set(true); }
    closeCart() { this.isCartOpen.set(false); }

    retryInviteLoad(): void {
        const token = this.token();
        if (token) void this.store.loadInviteByToken(token);
    }

    selectCategory(category: string | null): void {
        this.selectedCategory.set(category);
    }

    onSortChanged(event: Event): void {
        this.selectedSort.set((event.target as HTMLSelectElement).value as 'recommended' | 'price-asc' | 'price-desc');
    }

    async addDishToCart(dish: DishListResponse): Promise<void> {
        const added = await this.store.addDish({
            dishId: dish.id,
            title: dish.name,
            price: dish.price,
            imageUrl: dish.imageUrl,
        });

        if (added) {
            this.toast.success(`${dish.name} added to your pre-order.`, 'Added');
        }
    }

    async addFavourite(dish: GroupFavouriteDish): Promise<void> {
        const added = await this.store.addDish({
            dishId: dish.dishId,
            title: dish.name,
            price: dish.price,
            imageUrl: dish.imageUrl ?? undefined,
        });

        if (added) {
            this.toast.success(`${dish.name} added to your pre-order.`, 'Added');
            this.refreshGroupBoard();
        }
    }

    private refreshGroupBoard(): void {
        const sessionId = this.store.guestSessionId();
        const sessionToken = this.store.guestSessionToken();
        if (!sessionId || !sessionToken) return;

        this.loadGroupBoard$(sessionId, sessionToken).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    }

    /** Silent: on failure the last board stays on screen with a "Couldn't refresh" note, no toast. */
    private loadGroupBoard$(sessionId: string, sessionToken: string): Observable<GroupBoardResponse> {
        return this.guestSessionsService.getGroupBoard(sessionId, sessionToken, { silent: true }).pipe(
            tap(board => {
                this.groupBoard.set(board);
                this.groupBoardUpdatedAt.set(new Date());
                this.groupBoardRefreshFailed.set(false);
            }),
            catchError(() => {
                this.groupBoardRefreshFailed.set(true);
                return EMPTY;
            }),
        );
    }

    private categoryLabel(category: string): string {
        const labels: Record<string, string> = {
            Appetizer: 'Appetizers',
            MainCourse: 'Main Courses',
            Dessert: 'Desserts',
        };

        return labels[category] ?? category.replace(/([a-z])([A-Z])/g, '$1 $2');
    }

    private toCardDish(dish: GuestMenuDish, category: string): DishListResponse {
        return {
            id: dish.id,
            name: dish.name,
            imageUrl: dish.imageUrl || 'assets/img/dish.png',
            price: dish.price,
            state: dish.selectable ? dish.state : 'OutOfStock',
            weight: dish.weight ?? '',
            dishType: category,
            description: dish.description ?? '',
            calories: dish.calories ?? '',
            proteins: dish.proteins ?? '',
            carbohydrates: dish.carbohydrates ?? '',
            fats: dish.fats ?? '',
            vitamins: dish.vitamins ?? '',
        };
    }

    noop(): void {
        // Guest name modal is mandatory; ignore close attempts (Esc/X)
    }
}