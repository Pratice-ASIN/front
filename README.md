# Front: tax stamp payment

Minimal Angular client for the payment API (one page, standalone components, signals).

```bash
npm install
npm start      # http://localhost:4200 — /api and /simulator are proxied to http://localhost:8080
npm run build  # production build in dist/
```

Start the Spring Boot API first (`mvn spring-boot:run` at the repository root).

## What it does

- choose a user (simplified identification, sent as the `X-User-Id` header);
- register a document request; the amount shown is the one computed by the service;
- pay with MTN, MOOV or Celtiis; the phone number is checked on the client for comfort,
  the service remains the authority;
- one `Idempotency-Key` per attempt: on a network error the request is resent with the
  same key (no double debit), and the pay button is disabled while sending;
- follow the payment status (polling every 2 s) and see the attempt history.

## Files

```
src/app/api.ts      API types, HTTP client, X-User-Id interceptor, error messages
src/app/app.ts      page logic (requests, payment, tracking)
src/app/app.html    template (UI text in French)
src/app/app.css     component styles
proxy.conf.json     dev proxy to the API
```
