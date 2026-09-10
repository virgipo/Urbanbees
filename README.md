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
- Checkout uses [Stripe Checkout](https://stripe.com/docs/payments/checkout):
  `startCheckout()` in `index.html` posts the cart to the `server/` API, which
  creates a Stripe Checkout Session and returns its URL for redirect. See
  `server/README.md` for that piece.

## Deploy

- **Storefront** (`index.html`) — Render Static Site, root of this repo,
  auto-deploys on push to `main`. Publish directory `.`, no build command.
- **Checkout API** (`server/`) — separate Render Web Service, same repo,
  build command `cd server && npm install`, start command `cd server && npm start`.
  Needs `STRIPE_SECRET_KEY` and `SITE_URL` env vars set in its Render dashboard.

## Roadmap

| Phase | What | Tools |
|-------|------|-------|
| 1 | Static storefront live | Render Static Site (this repo) |
| 2 | Payments | Stripe Checkout via `server/` (done) |
| 3 | Real catalog + orders | Supabase (products, producers, orders tables) |
| 4 | Producer notifications | Stripe webhook → email/WhatsApp on paid order |
| 5 | Multi-producer payouts | Stripe Connect Express
