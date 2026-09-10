const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const prices = require('./prices.json');

const { STRIPE_SECRET_KEY, SITE_URL, PORT } = process.env;

if (!STRIPE_SECRET_KEY) {
  console.error('Missing STRIPE_SECRET_KEY environment variable.');
  process.exit(1);
}
if (!SITE_URL) {
  console.error('Missing SITE_URL environment variable (e.g. https://urbanbees.it).');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);
const priceById = new Map(prices.map(p => [p.id, p]));

const app = express();
app.use(cors({ origin: SITE_URL }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/api/checkout', async (req, res) => {
  try {
    const { cart, lang } = req.body || {};
    const locale = lang === 'it' ? 'it' : 'en';

    if (!cart || typeof cart !== 'object' || Array.isArray(cart)) {
      return res.status(400).json({ error: 'Invalid cart' });
    }

    const line_items = Object.entries(cart).map(([idStr, qty]) => {
      const id = Number(idStr);
      const quantity = Number(qty);
      const product = priceById.get(id);
      if (!product || !Number.isInteger(quantity) || quantity < 1) {
        throw new Error(`Invalid cart line: id=${idStr} qty=${qty}`);
      }
      return {
        quantity,
        price_data: {
          currency: 'eur',
          unit_amount: Math.round(product.price * 100), // price looked up server-side, never trust the client
          product_data: {
            name: product.name[locale],
            description: product.unit[locale],
          },
        },
      };
    });

    if (line_items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      locale,
      shipping_address_collection: { allowed_countries: ['IT', 'US', 'CA', 'GB', 'FR', 'DE', 'ES', 'NL', 'BE', 'AT', 'CH', 'AU'] },
      success_url: `${SITE_URL}/?success=1`,
      cancel_url: `${SITE_URL}/?canceled=1`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(400).json({ error: 'Could not create checkout session' });
  }
});

const port = PORT || 10000;
app.listen(port, () => console.log(`Checkout server listening on :${port}`));
