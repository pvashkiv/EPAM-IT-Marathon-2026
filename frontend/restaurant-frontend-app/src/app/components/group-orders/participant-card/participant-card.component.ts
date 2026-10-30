import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Participant } from '@app/models/group-orders/participant.model';
import { ParticipantCardLine } from './models';

@Component({
  selector: 'app-participant-card',
  imports: [CurrencyPipe],
  templateUrl: './participant-card.component.html',
  styleUrl: './participant-card.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ParticipantCardComponent {
  readonly participant = input.required<Participant>();
  /** The card of the signed-in Owner — titled «My Pre-Order». */
  readonly isMe = input(false);
  readonly canRemove = input(false);

  readonly removeClick = output<Participant>();

  readonly title = computed(() => {
    const person = this.participant();
    if (this.isMe()) return 'My Pre-Order';
    return person.type === 'Owner' ? `Owner: ${person.name}` : `Guest: ${person.name}`;
  });

  readonly statusLabel = computed(() => (this.participant().isSubmitted ? 'Submitted' : 'Still choosing'));

  readonly removeLabel = computed(() => `Remove ${this.participant().name}`);

  readonly lines = computed<ParticipantCardLine[]>(() =>
    this.participant().items.map((item) => ({
      dish: item.dish,
      quantity: item.quantity,
      lineTotal: item.dish.price * item.quantity,
      initial: item.dish.name.charAt(0).toUpperCase(),
    })),
  );

  readonly subtotal = computed(() => this.lines().reduce((sum, line) => sum + line.lineTotal, 0));

  onRemove(): void {
    this.removeClick.emit(this.participant());
  }
}
