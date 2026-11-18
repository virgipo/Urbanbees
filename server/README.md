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
- `PAYMENT_METHODS` — comma-separated, defaults to `card`. Set it to
  `card,paypal` **only after** switching PayPal on in Stripe → Settings →
  Payment methods. Asking Stripe for a method that is not activated makes the
  whole checkout fail, which is why this is a variable and not code.

### Bank transfer (optional)

The storefront only offers the bank-transfer option when all three of these
are set; otherwise the button stays hidden and `/api/config` reports it off.

- `BANK_IBAN` — the account customers transfer to. Kept here rather than in
  the repository, which is public.
- `BANK_HOLDER` — the account holder's name, as the bank has it.
- `BANK_NAME` — optional, shown for reassurance.
- `RESEND_API_KEY` — from resend.com. Orders arrive by email, so without this
  an order would be taken and never seen.
- `ORDER_EMAIL_TO` — where new orders are sent.
- `ORDER_EMAIL_FROM` — optional. Resend only sends from a domain verified with
  it; until `urbanbees.it` is verified there, leave this unset and its shared
  test sender is used.

No order is written to disk: the customer's details go into the two emails and
are then discarded. Only the reference and the total reach the logs.

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
