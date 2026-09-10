import Stripe from 'stripe';
import { PRODUCTS, CURRENCY } from './_products.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Shipping is always covered by the producer — it's the promise the whole
// brand rests on, so the buyer is never charged for it here.
const MAX_QTY_PER_LINE = 20;

function buildLineItems(cart, lang) {
  const locale = lang === 'en' ? 'en' : 'it';
  const items = [];

  for (const [id, rawQty] of Object.entries(cart || {})) {
    const product = PRODUCTS.find(p => String(p.id) === String(id));
    if (!product) continue;

    const qty = Math.floor(Number(rawQty));
    if (!Number.isFinite(qty) || qty < 1) continue;

    items.push({
      quantity: Math.min(qty, MAX_QTY_PER_LINE),
      price_data: {
        currency: CURRENCY,
        unit_amount: product.amount, // from our catalogue, never from the browser
        product_data: {
          name: product.name[locale],
          description: product.unit[locale],
          metadata: { product_id: String(product.id) },
        },
      },
    });
  }

  return items;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is not set.');
    return res.status(500).json({ error: 'Payments are not configured yet.' });
  }

  try {
    const { cart, lang } = req.body || {};
    const line_items = buildLineItems(cart, lang);

    if (!line_items.length) {
      return res.status(400).json({ error: 'Your basket is empty.' });
    }

    const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      locale: lang === 'en' ? 'en' : 'it',
      billing_address_collection: 'required',
      shipping_address_collection: {
        allowed_countries: [
          'IT', 'FR', 'DE', 'ES', 'PT', 'NL', 'BE', 'LU', 'AT', 'IE',
          'DK', 'SE', 'FI', 'PL', 'CZ', 'GR', 'SI', 'SK', 'HR', 'EE',
          'LV', 'LT', 'BG', 'RO', 'HU', 'CY', 'MT',
          'GB', 'CH', 'NO', 'US', 'CA', 'AU', 'JP', 'SG',
        ],
      },
      shipping_options: [{
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: 0, currency: CURRENCY },
          display_name: lang === 'en'
            ? 'Included — covered by the producer'
            : 'Inclusa — a carico del produttore',
        },
      }],
      success_url: `${siteUrl}/?success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/?canceled=1`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout failed:', err);
    return res.status(500).json({ error: 'We could not start the checkout. Please try again.' });
  }
}
