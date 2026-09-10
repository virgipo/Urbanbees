# Urban Bees 🐝

High-end marketplace connecting Italy's finest independent beekeepers directly with consumers.
Shipping is always paid by the producer — never the buyer.

## What's here

- `index.html` — the full bilingual (IT/EN) storefront. Auto-detects browser language,
  with a manual IT/EN toggle in the header. Catalog is a curated list of Italian
  (plus one imported Manuka) honey varieties — acacia, chestnut, strawberry tree,
  wildflower, eucalyptus, linden, thyme — shaped as a JS array ready to be swapped
  for Supabase queries.
- Tapping a honey card opens a shareable detail page (`#honey-<id>`) with its
  characteristics — color, harvest window, crystallization behavior, flavor notes —
  plus a full description and suggested pairings.
- Checkout button is stubbed: see `startCheckout()` in `index.html` for where the
  Stripe Checkout call plugs in.

## Deploy (5 minutes)

1. Go to [vercel.com](https://vercel.com) → **Add New → Project** → import this repo.
2. Framework preset: **Other** (it's a static site). Deploy.
3. Live at `<project>.vercel.app`. Add your custom domain under
   **Settings → Domains** once purchased.

## Payments (Stripe Checkout)

Live in `api/checkout.js`. The flow: the basket is POSTed to the function, the
function looks each price up **server-side** in `api/_products.js`, creates a
Stripe Checkout Session, and returns its URL for the browser to redirect to.
Prices sent by the browser are ignored — a buyer can edit those before they leave
the page.

### Setup

1. **Install the dependency** — `npm install` (adds `stripe`).
2. **Get your keys** — Stripe Dashboard → *Developers → API keys*. Start with the
   **test** key (`sk_test_…`); nothing is charged and you can pay with card
   `4242 4242 4242 4242`, any future expiry, any CVC.
3. **Set the environment variables** in Vercel → *Settings → Environment Variables*:

   | Variable | Value |
   |---|---|
   | `STRIPE_SECRET_KEY` | `sk_test_…`, then `sk_live_…` when you go live |
   | `SITE_URL` | `https://urbanbees.it` (optional — falls back to the request host) |

   Never commit these; `.env` is gitignored.
4. **Deploy.** Vercel picks up `api/checkout.js` as a serverless function
   automatically — no config file needed.

### Keeping prices in sync

`api/_products.js` is generated from the catalogue in `index.html`. After changing
any price, name or jar size:

```
npm run sync-products
```

### What the buyer gets

Shipping is added as a €0 rate labelled *"Included — covered by the producer"*, so
the promise is visible on the Stripe page too. Billing and shipping addresses are
collected, and the Checkout page follows the site's IT/EN language.

On return, `?success=1` empties the basket and thanks the buyer; `?canceled=1`
leaves the basket untouched.

### Before going live

Switching to `sk_live_…` requires a completed Stripe account: business type, tax
details and a payout bank account. Selling habitually in Italy means a partita IVA
— test mode works fully in the meantime.

### Not built yet

Orders are not recorded anywhere. Stripe emails you each payment, but nothing
tells the producer to ship. That's the webhook in phase 4 below.

## Roadmap

| Phase | What | Tools |
|-------|------|-------|
| 1 | Static storefront live | Vercel (this repo) |
| 2 | Real catalogue + orders | Supabase (products, producers, orders tables) |
| 3 | Payments | ✅ Stripe Checkout via `/api/checkout` |
| 4 | Producer notifications | Stripe webhook → email/WhatsApp on paid order |
| 5 | Multi-producer payouts | Stripe Connect Express |
