# Urban Bees checkout server

Tiny Express server with one job: create a Stripe Checkout Session server-side
(so prices always come from here, never from the browser) and hand the
frontend a redirect URL.

## ⚠️ Keep `prices.json` in sync

`prices.json` is a second copy of the `PRODUCTS` catalog in the root
`index.html`. When you add, remove, re-price **or re-stock** a honey on the
site, update both files.

### One row per size, not per honey

A honey is one card on the site and several rows here: each size is its own
code, and the cart, the stock check and the checkout all work on those codes
and never need to know that two of them are the same honey. The code is
`<beekeeper><size>`: 1xx Cazzola, 2xx Marco Ruga, 3xx El Veler, and within a
beekeeper x01 = 125 g, x02 = 200 g, x03 = 400 g. In `index.html` the same
number is the `sku` of an entry in a product's `sizes` array.

Codes must never be reused for something else. A visitor with the shop open
holds codes in the page, and the server would happily sell them whatever that
code means at checkout time.

### Putting a honey on sale

A product carries `soon: true` while it is announced but not sellable: the
card and the button read "Presto disponibile" and nothing can be added to the
cart whatever its stock says. To open sales: set the real prices in both
files, give the sizes a stock count in both files, and delete the `soon` flag
from that product in `index.html`.

### The stock counts itself, from Stripe

Nothing here writes anything down. Every Stripe session carries its cart in
`metadata.ub_items`, so what has sold can be *asked for* instead of stored:
`/api/stock` lists the paid sessions created since `countSalesSince`, adds up
what went out and subtracts it from the figures below. The answer is cached
for a minute.

That is why there is no database to pay for and keep alive, why the counts
survive a restart or a redeploy, and why the shelf cannot drift from the
money — the till and the shelf are the same record.

So the numbers in this file are a **starting** stock, true as of
`countSalesSince`. **Restocking means raising a number and moving that date**,
otherwise sales already counted get subtracted from the new figure as well.

If Stripe cannot be reached the last good answer is used, and on a cold start
the starting figures; refusing every sale over a network blip would be a worse
failure than briefly offering one comb too many.

Bank-transfer orders are not in Stripe, so they do not count themselves. While
that route is on, subtract those by hand.

### Packs, or a weight

A size is stocked one of two ways, and the file says which.

**Countable packs** carry `stock`: El Veler's four 400 g trays are four
things, and the fourth order takes the last one.

**A weight** is for honey cut to order. Marco Ruga sent two kilos of comb; it
is not six of this and four of that, it is 2000 grams that can be cut any way
a customer asks. Those sizes carry `pool` and `g` instead of `stock`, and the
pool's grams live under `pools`. The server adds up the grams a whole cart
asks for and refuses to go past the pool — checking line by line would let
three 400 g combs through on a kilo, because each line on its own looks fine.

After shipping, lower the pool's grams by what you cut, in both files.

### Stock

Each entry carries a `stock` count. **This file is the one that counts**: the
storefront's copy only draws the "Sold out" and "Only N left" labels, and
anyone can edit a page in their own browser, so every order is checked against
the number here before it is accepted.

It does **not** count down by itself. Nothing is written back after a sale,
because the server keeps no state between restarts. So after shipping, lower
the number here and in `index.html`, and commit. Two people buying the last
comb in the same minute will both get through; at these quantities that is a
small risk, and the fix when it stops being small is a real datastore (Render
Key Value or Postgres) holding the counts. There's no shared data source yet —
for a catalogue this size duplicating with this warning was simpler than
building one; worth revisiting if it grows a lot.

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

### Order notifications

| Variable | What it is |
| --- | --- |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from the Stripe dashboard, for the endpoint above |
| `RESEND_API_KEY` | Resend API key; without it a paid order is logged, not emailed |
| `ORDER_EMAIL_TO` | where the order lands, e.g. `hey.urbanbees@gmail.com` |
| `ORDER_EMAIL_FROM` | optional; defaults to Resend's shared sender until a domain is verified |
| `RESEND_API_URL` | **tests only**: points the mailer at a stub instead of Resend |

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

## Telling Virginia an order came in

Stripe calls `POST /api/stripe-webhook` when a payment succeeds, and the
server emails her the lines, the shipping address and a reply-to. It is
mounted before `express.json()` and takes the raw body, because Stripe signs
the exact bytes.

Set it up once, in the Stripe dashboard, **in live mode**:

1. Developers → Webhooks → Add endpoint
2. URL: `https://urbanbees-checkout.onrender.com/api/stripe-webhook`
3. Event: `checkout.session.completed`
4. Copy the signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET` on Render

Without the secret the endpoint answers 503 and logs; with a wrong signature,
400. It answers Stripe before sending the mail, because Stripe retries
anything slow and a duplicate email is worse than a late one.

If the follow-up call to Stripe for the lines and the address fails, the email
still goes out, naming what was bought from the cart in the metadata and
saying to open Stripe for the address. The one thing this must never do is
stay silent.

The stock does not depend on this endpoint: the same paid session it announces
is the one `/api/stock` reads. If the webhook were down, the shelf would still
be right and only the email would be missing.

## Endpoints

- `GET /health` — liveness check.
- `POST /api/checkout` — body `{ cart: { "<productId>": quantity, ... }, lang: "it"|"en" }`,
  returns `{ url }` — redirect the browser there to open Stripe Checkout.
