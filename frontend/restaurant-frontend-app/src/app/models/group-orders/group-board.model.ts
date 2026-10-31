import { GroupReservationStatus } from './group-status.model';

/** GET /guest/sessions/{guestSessionId}/group — what a guest may see about the rest of the group. */
export interface GroupBoardResponse {
  status: GroupReservationStatus;
  maxGuests: number;
  participants: GroupBoardParticipant[];
  /** The group's most ordered dishes, most popular first (max 3). */
  favourites: GroupFavouriteDish[];
}

export interface GroupBoardParticipant {
  name: string;
  isOwner: boolean;
  isMe: boolean;
  isSubmitted: boolean;
  dishCount: number;
}

export interface GroupFavouriteDish {
  dishId: string;
  name: string;
  imageUrl?: string | null;
  price: number;
  /** How many portions the whole group has picked. */
  count: number;
}
