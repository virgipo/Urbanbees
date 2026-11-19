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

// Which payment methods Stripe should offer. Each one has to be switched on in
// the Stripe dashboard first: asking for one that is not activated makes the
// whole checkout fail, so this stays an environment variable rather than a code
// change. Set PAYMENT_METHODS=card,paypal in Render once PayPal is live there.
const PAYMENT_METHODS = (process.env.PAYMENT_METHODS || 'card')
  .split(',').map(s => s.trim()).filter(Boolean);

// The same storefront answers on the custom domain, its www variant and the
// Render-assigned URL, so checkout has to work from all three.
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : [SITE_URL, SITE_URL.replace('://', '://www.'), 'https://urbanbees-1fo1.onrender.com'];

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

// What is actually left, straight from the authoritative copy. The storefront
// asks on load so a page left open overnight does not keep offering sold-out jars.
app.get('/api/stock', (req, res) => {
  res.json(Object.fromEntries(prices.map(p => [p.id, p.stock ?? 0])));
});

app.post('/api/checkout', async (req, res) => {
  try {
    const { cart, lang } = req.body || {};
    const locale = lang === 'it' ? 'it' : 'en';
    // Send the customer back to whichever address they started from.
    const returnTo = ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : SITE_URL;

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
      // Stock is checked here, not in the browser: the page's copy is only for
      // display and anyone can edit it.
      if (quantity > (product.stock ?? 0)) {
        throw new Error(`Out of stock: id=${idStr} wanted=${quantity} left=${product.stock ?? 0}`);
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
      // Apple Pay and Google Pay ride along with 'card' and need no entry here.
      payment_method_types: PAYMENT_METHODS,
      line_items,
      locale,
      // Italy only for now: the business is not yet set up to charge another
      // country's VAT, and honey is restricted at several non-EU borders.
      shipping_address_collection: { allowed_countries: ['IT'] },
      success_url: `${returnTo}/?success=1`,
      cancel_url: `${returnTo}/?canceled=1`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(400).json({ error: 'Could not create checkout session' });
  }
});

/* ============================================================
   Bank transfer orders

   The customer pays by hand into Virginia's account, so nothing here takes
   money: it records what was ordered, hands back an IBAN and a reference to
   quote, and emails the order to her and the instructions to the customer.
   She ships once the transfer shows up with that reference.

   Unlike the Stripe route, this endpoint receives personal data, so it keeps
   none of it: the emails go out and nothing is written to disk or to a log.
   ============================================================ */

const BANK = {
  iban: process.env.BANK_IBAN || '',
  holder: process.env.BANK_HOLDER || '',
  bank: process.env.BANK_NAME || '',
};
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const ORDER_EMAIL_TO = process.env.ORDER_EMAIL_TO || '';
// Resend will only send from a domain you have verified with it. Until
// urbanbees.it is verified there, its shared test sender works.
const ORDER_EMAIL_FROM = process.env.ORDER_EMAIL_FROM || 'Urban Bees <onboarding@resend.dev>';

const bankTransferReady = Boolean(BANK.iban && RESEND_API_KEY && ORDER_EMAIL_TO);

// Which methods the storefront should offer. It asks before drawing the
// checkout so a half-configured option is never shown to a customer.
app.get('/api/config', (req, res) => {
  res.json({
    card: true,
    paypal: PAYMENT_METHODS.includes('paypal'),
    bankTransfer: bankTransferReady,
  });
});

/* A reference short enough to type into a bank form, unambiguous enough to
   read back over the phone: no 0/O or 1/I. */
const REF_ALPHABET = 'ACDEFGHJKLMNPQRSTUVWXYZ2345679';
function orderReference() {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  let tail = '';
  for (let i = 0; i < 4; i++) {
    tail += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  }
  return `UB-${yy}${mm}-${tail}`;
}

/* Anyone can POST here, and every call sends two emails, so cap it. In memory
   is enough: the worst a restart costs is a reset counter. */
const RATE = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const hits = (RATE.get(ip) || []).filter(t => now - t < windowMs);
  hits.push(now);
  RATE.set(ip, hits);
  if (RATE.size > 5000) RATE.clear();
  return hits.length > 5;
}

const str = (v, max) =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';
const looksLikeEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const money = n => '€ ' + n.toFixed(2).replace('.', ',');
const esc = v => String(v).replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function sendEmail({ to, subject, html, replyTo }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: ORDER_EMAIL_FROM,
      to: [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}`);
}

app.post('/api/order/bank-transfer', async (req, res) => {
  if (!bankTransferReady) {
    return res.status(503).json({ error: 'Bank transfer is not configured' });
  }
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Too many orders, please try again later' });
  }

  try {
    const { cart, lang, customer = {}, company } = req.body || {};
    // Honeypot: a real form leaves this empty, a bot fills every field it sees.
    if (company) return res.json({ reference: orderReference(), iban: BANK.iban });

    const it = lang === 'it';

    const c = {
      name: str(customer.name, 100),
      email: str(customer.email, 120).toLowerCase(),
      phone: str(customer.phone, 40),
      address: str(customer.address, 160),
      zip: str(customer.zip, 12),
      city: str(customer.city, 80),
      province: str(customer.province, 40),
      note: str(customer.note, 500),
    };
    for (const f of ['name', 'email', 'address', 'zip', 'city']) {
      if (!c[f]) return res.status(400).json({ error: `Missing field: ${f}` });
    }
    if (!looksLikeEmail(c.email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    // Prices come from here, exactly as they do for Stripe.
    if (!cart || typeof cart !== 'object' || Array.isArray(cart)) {
      return res.status(400).json({ error: 'Invalid cart' });
    }
    const lines = [];
    let total = 0;
    for (const [idStr, qty] of Object.entries(cart)) {
      const product = priceById.get(Number(idStr));
      const quantity = Number(qty);
      if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        return res.status(400).json({ error: 'Invalid cart line' });
      }
      if (quantity > (product.stock ?? 0)) {
        return res.status(409).json({
          error: 'Out of stock',
          id: product.id,
          left: product.stock ?? 0,
        });
      }
      const sum = product.price * quantity;
      total += sum;
      lines.push({ name: product.name[it ? 'it' : 'en'], unit: product.unit[it ? 'it' : 'en'], quantity, sum });
    }
    if (!lines.length) return res.status(400).json({ error: 'Cart is empty' });
    total = Math.round(total * 100) / 100;

    const reference = orderReference();
    const rows = lines.map(l =>
      `<tr><td>${esc(l.quantity)}&times;</td><td>${esc(l.name)}<br><small>${esc(l.unit)}</small></td>` +
      `<td align="right">${money(l.sum)}</td></tr>`).join('');

    const orderTable =
      `<table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">` +
      rows +
      `<tr><td></td><td><strong>${it ? 'Totale' : 'Total'}</strong></td>` +
      `<td align="right"><strong>${money(total)}</strong></td></tr></table>`;

    // To Virginia: everything she needs to ship, nothing she has to look up.
    await sendEmail({
      to: ORDER_EMAIL_TO,
      replyTo: c.email,
      subject: `Nuovo ordine ${reference} — ${money(total)} — ${c.name}`,
      html: `
        <div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#212121">
          <h2 style="margin:0 0 4px">Nuovo ordine: ${esc(reference)}</h2>
          <p style="margin:0 0 18px;color:#6E6A64">Pagamento con bonifico — da spedire quando il bonifico arriva.</p>
          ${orderTable}
          <h3 style="margin:22px 0 6px">Spedire a</h3>
          <p style="margin:0">
            ${esc(c.name)}<br>
            ${esc(c.address)}<br>
            ${esc(c.zip)} ${esc(c.city)}${c.province ? ' (' + esc(c.province) + ')' : ''}<br>
            ${c.phone ? 'Tel: ' + esc(c.phone) + '<br>' : ''}
            Email: ${esc(c.email)}
          </p>
          ${c.note ? `<h3 style="margin:22px 0 6px">Note</h3><p style="margin:0">${esc(c.note)}</p>` : ''}
        </div>`,
    });

    // To the customer: how to pay, and what to write in the reference field.
    await sendEmail({
      to: c.email,
      replyTo: ORDER_EMAIL_TO,
      subject: it
        ? `Il tuo ordine Urban Bees ${reference}`
        : `Your Urban Bees order ${reference}`,
      html: `
        <div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#212121">
          <p>${it ? `Grazie ${esc(c.name)},` : `Thank you ${esc(c.name)},`}</p>
          <p>${it
            ? 'abbiamo ricevuto il tuo ordine. Per completarlo, fai un bonifico con questi dati:'
            : 'we have received your order. To complete it, please make a bank transfer with these details:'}</p>
          <table cellpadding="6" style="border-collapse:collapse;background:#F1EADF;font-size:14px">
            <tr><td><strong>${it ? 'Intestatario' : 'Account holder'}</strong></td><td>${esc(BANK.holder)}</td></tr>
            <tr><td><strong>IBAN</strong></td><td style="font-family:monospace">${esc(BANK.iban)}</td></tr>
            ${BANK.bank ? `<tr><td><strong>${it ? 'Banca' : 'Bank'}</strong></td><td>${esc(BANK.bank)}</td></tr>` : ''}
            <tr><td><strong>${it ? 'Importo' : 'Amount'}</strong></td><td>${money(total)}</td></tr>
            <tr><td><strong>${it ? 'Causale' : 'Reference'}</strong></td><td style="font-family:monospace"><strong>${esc(reference)}</strong></td></tr>
          </table>
          <p>${it
            ? '<strong>Scrivi la causale esattamente così</strong>: è come riconosciamo il tuo ordine.'
            : '<strong>Please quote the reference exactly</strong>: it is how we match your payment to your order.'}</p>
          ${orderTable}
          <p>${it
            ? 'Spediamo appena il bonifico arriva, di solito in due o tre giorni lavorativi. Spedizione inclusa.'
            : 'We ship as soon as the transfer arrives, usually within two or three working days. Shipping included.'}</p>
          <p style="color:#6E6A64">Urban Bees — urbanbees.it</p>
        </div>`,
    });

    // Reference and total only: no personal data in the logs.
    console.log(`Bank transfer order ${reference} — ${money(total)}`);
    res.json({ reference, iban: BANK.iban, holder: BANK.holder, bank: BANK.bank, total });
  } catch (err) {
    console.error('Bank transfer order error:', err.message);
    res.status(500).json({ error: 'Could not record the order' });
  }
});


const port = PORT || 10000;
app.listen(port, () => console.log(`Checkout server listening on :${port}`));
