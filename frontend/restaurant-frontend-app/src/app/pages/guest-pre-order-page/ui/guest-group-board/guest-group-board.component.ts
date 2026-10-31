import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { GroupBoardResponse, GroupFavouriteDish } from '@app/models/group-orders/group-board.model';
import { GroupBoardRow, GroupFavouriteView } from './models';

/** Live view of the whole group for a guest: who joined, who is ready, what the group likes. */
@Component({
    standalone: true,
    selector: 'app-guest-group-board',
    templateUrl: './guest-group-board.component.html',
    styleUrl: './guest-group-board.component.scss',
    imports: [CurrencyPipe, DatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GuestGroupBoardComponent {
    readonly board = input.required<GroupBoardResponse>();
    /** False once this guest has submitted, or when the group no longer takes changes. */
    readonly canAdd = input(false);
    readonly updatedAt = input<Date | null>(null);
    readonly refreshFailed = input(false);

    readonly addFavourite = output<GroupFavouriteDish>();

    readonly isOpen = computed(() => this.board().status === 'Open');

    readonly joinedLabel = computed(() => {
        const { participants, maxGuests } = this.board();
        return `${participants.length} of ${maxGuests} joined`;
    });

    readonly readyLabel = computed(() => {
        const ready = this.board().participants.filter(person => person.isSubmitted).length;
        return `${ready} ready`;
    });

    readonly rows = computed<GroupBoardRow[]>(() =>
        this.board().participants.map((person, index) => ({
            key: `${index}-${person.name}`,
            name: person.name,
            badge: person.isMe ? 'You' : person.isOwner ? 'Host' : null,
            isMe: person.isMe,
            isSubmitted: person.isSubmitted,
            statusText: person.isSubmitted
                ? 'Ready'
                : person.dishCount > 0
                    ? `Still choosing · ${person.dishCount} ${person.dishCount === 1 ? 'dish' : 'dishes'}`
                    : 'Still choosing',
        }))
    );

    readonly favourites = computed<GroupFavouriteView[]>(() =>
        this.board().favourites.map(dish => ({
            ...dish,
            initial: dish.name.charAt(0).toUpperCase(),
            addLabel: `Add ${dish.name} to my order`,
        }))
    );
}
