import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { GroupInviteToken } from '@app/models/reservations/guest-invite.model';
import { GuestInviteService } from '@app/services/reservation/guest-invite.service';
import { ToastService } from '@app/services/toast/toast.service';
import { InviteLinkPanelComponent } from './invite-link-panel.component';

const LINK = `${window.location.origin}/join/abc123xyz`;

describe('InviteLinkPanelComponent', () => {
  let fixture: ComponentFixture<InviteLinkPanelComponent>;
  let component: InviteLinkPanelComponent;
  let element: HTMLElement;
  let toastService: jasmine.SpyObj<ToastService>;
  let guestInviteService: jasmine.SpyObj<GuestInviteService>;

  function render(): void {
    fixture = TestBed.createComponent(InviteLinkPanelComponent);
    component = fixture.componentInstance;
    element = fixture.nativeElement;
    fixture.componentRef.setInput('reservationId', 'res-1');
    fixture.detectChanges();
  }

  const input = () => element.querySelector<HTMLInputElement>('#invite-link-input')!;
  const copyButton = () => element.querySelector<HTMLButtonElement>('button[aria-label="Copy invite link"]')!;

  beforeEach(() => {
    toastService = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    guestInviteService = jasmine.createSpyObj<GuestInviteService>('GuestInviteService', ['getInviteToken$']);
    guestInviteService.getInviteToken$.and.returnValue(of({ token: 'abc123xyz' }));

    TestBed.configureTestingModule({
      imports: [InviteLinkPanelComponent],
      providers: [
        { provide: ToastService, useValue: toastService },
        { provide: GuestInviteService, useValue: guestInviteService },
      ],
    });
  });

  it('loads the invite token for the reservation and shows the link', () => {
    render();

    expect(guestInviteService.getInviteToken$).toHaveBeenCalledOnceWith('res-1');
    expect(input().value).toBe(LINK);
    expect(copyButton().disabled).toBeFalse();
  });

  it('draws a QR code once the link is known', () => {
    render();

    expect(element.querySelector('.qr-code svg')).withContext('QR code svg').not.toBeNull();
  });

  it('shows a loading placeholder, no QR and a disabled copy button while the token loads', () => {
    guestInviteService.getInviteToken$.and.returnValue(new Subject<GroupInviteToken>());
    render();

    expect(input().placeholder).toBe('Generating link...');
    expect(copyButton().disabled).toBeTrue();
    expect(element.querySelector('.qr-code')).toBeNull();
  });

  it('shows an error toast and keeps copy disabled when the token request fails', () => {
    guestInviteService.getInviteToken$.and.returnValue(throwError(() => new Error('boom')));
    render();

    expect(input().placeholder).toBe('Link is unavailable');
    expect(copyButton().disabled).toBeTrue();
    expect(toastService.error).toHaveBeenCalled();
  });

  it('does not copy or toast when the token has not loaded yet', async () => {
    guestInviteService.getInviteToken$.and.returnValue(new Subject<GroupInviteToken>());
    render();
    const writeText = spyOn(navigator.clipboard, 'writeText').and.resolveTo();

    await component.onCopyLink();

    expect(writeText).not.toHaveBeenCalled();
    expect(toastService.success).not.toHaveBeenCalled();
  });

  it('copies the link and shows a success toast', async () => {
    render();
    const writeText = spyOn(navigator.clipboard, 'writeText').and.resolveTo();

    await component.onCopyLink();

    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(toastService.success).toHaveBeenCalledWith('Share it with your friends.', 'Link copied!');
  });

  it('shows an error toast when copying fails', async () => {
    render();
    spyOn(navigator.clipboard, 'writeText').and.rejectWith(new Error('denied'));

    await component.onCopyLink();

    expect(toastService.error).toHaveBeenCalled();
    expect(toastService.success).not.toHaveBeenCalled();
  });
});
