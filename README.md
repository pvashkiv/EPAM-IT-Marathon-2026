# Green & Tasty — restaurant booking with group pre-orders

Book a table, invite friends with a link or QR code, and let everyone pick their own dishes before you arrive.
The host sees every cart live and sends **one** consolidated pre-order to the restaurant.

**Live demo:** https://d2kt1ucumwtur0.cloudfront.net

| | |
|---|---|
| Frontend | Angular 22 · standalone components · signals · SCSS |
| Backend | .NET 10 AWS Lambda (`api-handler`) behind API Gateway |
| Data & auth | DynamoDB · Cognito |
| Hosting | S3 + CloudFront (frontend) · Syndicate (backend) · Terraform (shared infra) |

## What I built

The Owner flow for the group pre-order, end to end: 5 backend endpoints, the host's Group Pre-Order page, the guests' live board, tests and AWS deployment.

- **Group pre-order (host):** a live screen with every guest's cart. It shows a consolidated order with a total for submitted carts only, refreshes every 15 s and has a manual Refresh. The host can remove a guest and submit the whole order in one go.
- **Invite guests:** an invite link with a copy button and a **QR code**. It is shown after booking and can be reopened anytime from the reservation card or the Group Pre-Order page.
- **Live group board (guests):** anyone with the invite link sees, without an account:
  - who joined and who is ready;
  - the group's favourite dishes, which they can add to their own cart in one click.
- **Seed data:** an idempotent script that fills an empty DynamoDB with locations, tables, dishes and waiters.
- **AWS deployment:** the backend runs on Lambda + API Gateway with DynamoDB and Cognito. The frontend is served from S3 behind CloudFront.

## Already in the base app

These existed before my work. The only change here is the live group board, added to the guest join page:

- **Booking:** pick a location, date, time and table; manage your reservations.
- **Personal pre-order:** order dishes in advance for your own reservation.
- **Guest join page:** a guest opens the invite link, enters a name and builds a cart.
- **Waiter & admin:** waiter reservation dashboard, notifications, admin reports.

## How the group pre-order works

```
Host books a table (2+ guests) ──► Invite Guests: link / QR ──► Guest opens /join/<token>
                                                                  │  enters a name, picks dishes,
                                                                  │  sees the live group board
Host: Reservations ► Group Pre-Order ◄────── every 15 s ──────────┘  submits the cart
   └─► Submit Pre-Order ──► submitted carts merged into the reservation's order ──► restaurant
```

## API added for the group pre-order

Base URL: `https://<api-id>.execute-api.<region>.amazonaws.com/develop`. Full reference: [docs/ApiRoutes.md](backend/restaurant-backend-app/docs/ApiRoutes.md).

| Method & path | Who | What it does |
|---|---|---|
| `GET /guest/groups/{groupReservationId}/sessions` | Host (Cognito) | Every participant with dishes and subtotals; the host is listed first |
| `GET /reservations/{reservationId}/guest-session-id` | Host (Cognito) | The host's own session id, created on first use |
| `POST /group-reservations/{groupReservationId}/submit` | Host (Cognito) | Merges **submitted** carts by dish into the order; marks the order `SubmittedByCustomer` and the group `Submitted` |
| `DELETE /guest/groups/{groupReservationId}/sessions/{guestSessionId}` | Host (Cognito) | Removes a guest and returns the updated group |
| `GET /guest/sessions/{guestSessionId}/group` | Guest (session token) | Live group board: names, ready status, top-3 dishes. It returns no prices or other people's carts |

Errors follow one convention: `400` for an invalid request, `401` for a missing or invalid token, `403` if the caller is not the host, `404` if the target is not found.

## Repository layout

```
frontend/restaurant-frontend-app   Angular SPA (see its CLAUDE.md for conventions)
backend/restaurant-backend-app     .NET Lambdas, Syndicate config, API docs, seed script
infra/terraform                    Cognito, S3, CloudFront, SQS, EventBridge
docs/DEPLOYMENT.md                 Step-by-step deployment and clean-up guide
```

## Run locally

```bash
# Frontend — the group pre-order works against a built-in mock, no backend needed
cd frontend/restaurant-frontend-app
npm ci
npm start      # http://localhost:4200/reservations/demo-reservation/group-order?demo

npm run test:hw   # homework tests for the group pre-order
npm test          # whole frontend suite

# Backend unit tests
cd backend/restaurant-backend-app
dotnet test restaurant-backend-app.sln
```

To use a real API locally, set `backendUrl` in `frontend/restaurant-frontend-app/src/environments/environment.development.ts`.

## Deploy

Details are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). In short:

1. **Infrastructure:** `terraform apply` in `infra/terraform`.
2. **Backend:** `syndicate build`, then `syndicate update` on an existing stack. Never `clean`: it wipes DynamoDB.
3. **Seed data:** `python3 backend/restaurant-backend-app/scripts/seed/seed_catalog.py` adds 3 locations, 12 tables, 24 dishes and 3 waiters.
4. **Frontend:** `BACKEND_URL=<api url> npm run build`, then `aws s3 sync … --delete` and a CloudFront invalidation.
