import { DishShort } from '@app/models/group-orders/participant.model';

export interface ParticipantCardLine {
  dish: DishShort;
  quantity: number;
  lineTotal: number;
  /** Shown on a green circle when the dish has no photo. */
  initial: string;
}
