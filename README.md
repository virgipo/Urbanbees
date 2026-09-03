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

## Roadmap

| Phase | What | Tools |
|-------|------|-------|
| 1 | Static storefront live | Vercel (this repo) |
| 2 | Real catalog + orders | Supabase (products, producers, orders tables) |
| 3 | Payments | Stripe Checkout via `/api/checkout` serverless function |
| 4 | Producer notifications | Stripe webhook → email/WhatsApp on paid order |
| 5 | Multi-producer payouts | Stripe Connect Express |

## Stripe wiring (when ready)

Create `api/checkout.js` (Vercel serverless function):

```js
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  const { cart, lang } = req.body;
  // look up prices server-side (never trust client prices)
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: buildLineItems(cart),
    locale: lang,
    success_url: `${process.env.SITE_URL}/?success=1`,
    cancel_url: `${process.env.SITE_URL}/?canceled=1`,
  });
  res.json({ url: session.url });
}
```

Set `STRIPE_SECRET_KEY` in Vercel → Settings → Environment Variables.
