import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SKIP_ERROR_TOAST } from '@app/auth/skip-error-toast.context';
import { API_BASE_URL } from '@app/shared/config/api-base-url.token';
import { GuestSessionsService } from './guest-sessions.service';

const BASE_URL = 'https://api.test';
const BOARD_URL = `${BASE_URL}/guest/sessions/gs-1/group`;

describe('GuestSessionsService.getGroupBoard', () => {
    let service: GuestSessionsService;
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideHttpClient(), provideHttpClientTesting(), { provide: API_BASE_URL, useValue: BASE_URL }],
        });
        service = TestBed.inject(GuestSessionsService);
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    it('GETs the group board with the guest session token', () => {
        service.getGroupBoard('gs-1', 'guest-token').subscribe();

        const req = http.expectOne(BOARD_URL);
        expect(req.request.method).toBe('GET');
        expect(req.request.headers.get('Authorization')).toBe('Bearer guest-token');
        expect(req.request.context.get(SKIP_ERROR_TOAST)).toBeFalse();
        req.flush({ status: 'Open', maxGuests: 2, participants: [], favourites: [] });
    });

    it('marks background requests as silent', () => {
        service.getGroupBoard('gs-1', 'guest-token', { silent: true }).subscribe();

        const req = http.expectOne(BOARD_URL);
        expect(req.request.context.get(SKIP_ERROR_TOAST)).toBeTrue();
        req.flush({ status: 'Open', maxGuests: 2, participants: [], favourites: [] });
    });
});
