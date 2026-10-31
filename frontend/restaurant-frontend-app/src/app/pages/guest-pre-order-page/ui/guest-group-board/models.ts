import { GroupFavouriteDish } from '@app/models/group-orders/group-board.model';

export interface GroupBoardRow {
    key: string;
    name: string;
    badge: string | null;
    isMe: boolean;
    isSubmitted: boolean;
    statusText: string;
}

export interface GroupFavouriteView extends GroupFavouriteDish {
    initial: string;
    addLabel: string;
}
