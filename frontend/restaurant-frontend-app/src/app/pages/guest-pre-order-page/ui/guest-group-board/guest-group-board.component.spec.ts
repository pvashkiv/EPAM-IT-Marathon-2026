import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GroupBoardResponse, GroupFavouriteDish } from '@app/models/group-orders/group-board.model';
import { GuestGroupBoardComponent } from './guest-group-board.component';

const BOARD: GroupBoardResponse = {
    status: 'Open',
    maxGuests: 4,
    participants: [
        { name: 'Pablo', isOwner: true, isMe: false, isSubmitted: true, dishCount: 2 },
        { name: 'Anna', isOwner: false, isMe: true, isSubmitted: false, dishCount: 1 },
        { name: 'Bob', isOwner: false, isMe: false, isSubmitted: false, dishCount: 0 },
    ],
    favourites: [
        { dishId: 'dish-salad', name: 'Spring Salad', imageUrl: 'assets/img/dishes/spring-salad.jpg', price: 12, count: 3 },
        { dishId: 'dish-tea', name: 'Tea', imageUrl: null, price: 3, count: 1 },
    ],
};

describe('GuestGroupBoardComponent', () => {
    let fixture: ComponentFixture<GuestGroupBoardComponent>;
    let element: HTMLElement;

    function render(board: GroupBoardResponse, canAdd = true): void {
        fixture = TestBed.createComponent(GuestGroupBoardComponent);
        fixture.componentRef.setInput('board', board);
        fixture.componentRef.setInput('canAdd', canAdd);
        fixture.detectChanges();
        element = fixture.nativeElement;
    }

    const people = () => [...element.querySelectorAll('.person')].map(li => li.textContent?.replace(/\s+/g, ' ').trim());
    const addButtons = () => [...element.querySelectorAll<HTMLButtonElement>('.add-button')];

    beforeEach(() => TestBed.configureTestingModule({ imports: [GuestGroupBoardComponent] }));

    it('summarises how many joined and how many are ready', () => {
        render(BOARD);
        expect(element.querySelector('.board-summary')?.textContent).toContain('3 of 4 joined · 1 ready');
    });

    it('lists everyone with a text status, marking the host and me', () => {
        render(BOARD);
        expect(people()).toEqual([
            'Pablo Host Ready',
            'Anna You Still choosing · 1 dish',
            'Bob Still choosing',
        ]);
        expect(element.querySelector('.person--me')?.textContent).toContain('Anna');
    });

    it('shows group favourites with photo or initial and how many the group picked', () => {
        render(BOARD);
        const favourites = element.querySelectorAll('.favourite');
        expect(favourites.length).toBe(2);
        expect(favourites[0].textContent).toContain('× 3 in the group');
        expect(favourites[0].querySelector('img')?.getAttribute('src')).toBe('assets/img/dishes/spring-salad.jpg');
        expect(favourites[1].querySelector('.thumb--initial')?.textContent?.trim()).toBe('T');
    });

    it('emits the dish when "Add" is pressed', () => {
        render(BOARD);
        const emitted: GroupFavouriteDish[] = [];
        fixture.componentInstance.addFavourite.subscribe(dish => emitted.push(dish));

        addButtons()[0].click();

        expect(emitted.map(dish => dish.dishId)).toEqual(['dish-salad']);
        expect(addButtons()[0].getAttribute('aria-label')).toBe('Add Spring Salad to my order');
    });

    it('hides "Add" when the guest can no longer change the cart', () => {
        render(BOARD, false);
        expect(addButtons().length).toBe(0);
    });

    it('tells guests when the host has already sent the order', () => {
        render({ ...BOARD, status: 'Submitted' });
        expect(element.textContent).toContain('The host has sent the group pre-order to the restaurant.');
    });

    it('shows no favourites block when nobody picked anything yet', () => {
        render({ ...BOARD, favourites: [] });
        expect(element.querySelector('.favourites')).toBeNull();
    });
});
