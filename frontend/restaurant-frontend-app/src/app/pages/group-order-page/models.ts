import { Participant } from '@app/models/group-orders/participant.model';
import { Dish } from '@app/shared/helpers/consolidate-pre-order';

export type LoadState = 'loading' | 'ready' | 'error';

export interface ParticipantCardView {
  participant: Participant;
  isMe: boolean;
  canRemove: boolean;
}

export interface ConsolidatedLine {
  dish: Dish;
  quantity: number;
  lineTotal: number;
}
