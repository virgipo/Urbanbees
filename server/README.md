# Urban Bees checkout server

Tiny Express server with one job: create a Stripe Checkout Session server-side
(so prices always come from here, never from the browser) and hand the
frontend a redirect URL.

## ⚠️ Keep `prices.json` in sync

`prices.json` is a second copy of the `PRODUCTS` catalog in the root
`index.html`. When you add, remove, or re-price a honey on the site, update
both files. There's no shared data source yet — for a catalog this size
(8 items) duplicating with this warning was simpler than building one; worth
revisiting if the catalog grows a lot.

## Environment variables

- `STRIPE_SECRET_KEY` — from the Stripe Dashboard → Developers → API keys.
  Use the **test** secret key while developing, the **live** one only once
  you're ready to accept real payments.
- `SITE_URL` — the storefront's URL (e.g. `https://urbanbees.it`). Used both
  to restrict CORS to that origin and to build the success/cancel redirect
  URLs Stripe sends the customer back to.

## Local run

```
cd server
npm install
STRIPE_SECRET_KEY=sk_test_... SITE_URL=http://localhost:8930 npm start
```

## Endpoints

- `GET /health` — liveness check.
- `POST /api/checkout` — body `{ cart: { "<productId>": quantity, ... }, lang: "it"|"en" }`,
  returns `{ url }` — redirect the browser there to open Stripe Checkout.
