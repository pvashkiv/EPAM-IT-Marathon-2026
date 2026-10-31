import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ToastService } from '../services/toast/toast.service';
import { Tokens } from './models/tokens.model';
import { AuthenticationService } from './services/authentication.service';
import { SKIP_ERROR_TOAST } from './skip-error-toast.context';
import { tokenInterceptor } from './token.interceptor';

const URL = 'https://test.api/reservations';

describe('tokenInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let toastService: jasmine.SpyObj<ToastService>;
  let authService: jasmine.SpyObj<AuthenticationService>;

  beforeEach(() => {
    toastService = jasmine.createSpyObj<ToastService>('ToastService', ['error']);
    authService = jasmine.createSpyObj<AuthenticationService>('AuthenticationService', [
      'getTokens',
    ]);
    authService.getTokens.and.returnValue(null);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([tokenInterceptor])),
        provideHttpClientTesting(),
        { provide: ToastService, useValue: toastService },
        { provide: AuthenticationService, useValue: authService },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('shows the server message in a toast for a 400 response', () => {
    http.post(URL, {}).subscribe({ error: () => undefined });

    httpMock
      .expectOne(URL)
      .flush({ message: 'Overlaps' }, { status: 400, statusText: 'Bad Request' });

    expect(toastService.error).toHaveBeenCalledWith('Overlaps', 'Error');
  });

  it('does not show a toast but still rethrows when SKIP_ERROR_TOAST is set', () => {
    let receivedStatus: number | undefined;
    http
      .post(URL, {}, { context: new HttpContext().set(SKIP_ERROR_TOAST, true) })
      .subscribe({ error: (error) => (receivedStatus = error.status) });

    httpMock
      .expectOne(URL)
      .flush({ message: 'Overlaps' }, { status: 400, statusText: 'Bad Request' });

    expect(toastService.error).not.toHaveBeenCalled();
    expect(receivedStatus).toBe(400);
  });

  describe('guest endpoints', () => {
    const GROUP_SESSIONS_URL = 'https://test.api/guest/groups/grp-1/sessions';
    const GUEST_SESSION_URL = 'https://test.api/guest/sessions/gs-1/menu';

    beforeEach(() => {
      authService.getTokens.and.returnValue({ idToken: 'owner-id-token' } as Tokens);
    });

    it('sends the signed-in owner token to group endpoints under /guest/groups/', () => {
      http.get(GROUP_SESSIONS_URL).subscribe();

      const req = httpMock.expectOne(GROUP_SESSIONS_URL);
      expect(req.request.headers.get('Authorization')).toBe('Bearer owner-id-token');
      req.flush({ participants: [], total: 0 });
    });

    it('honours SKIP_ERROR_TOAST on group endpoints (silent background sync)', () => {
      http
        .get(GROUP_SESSIONS_URL, { context: new HttpContext().set(SKIP_ERROR_TOAST, true) })
        .subscribe({ error: () => undefined });

      httpMock.expectOne(GROUP_SESSIONS_URL).flush(null, { status: 500, statusText: 'Server Error' });

      expect(toastService.error).not.toHaveBeenCalled();
    });

    it('leaves guest session endpoints without the Authorization header', () => {
      http.get(GUEST_SESSION_URL).subscribe();

      const req = httpMock.expectOne(GUEST_SESSION_URL);
      expect(req.request.headers.has('Authorization')).toBeFalse();
      req.flush({});
    });
  });
});
