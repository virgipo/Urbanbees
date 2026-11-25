const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const catalogue = require('./prices.json');
const prices = catalogue.items;
const pools = catalogue.pools || {};

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

// Shipping: a flat fee on small orders, free from a threshold. The storefront
// shows the same two numbers in the cart (SHIPPING in index.html), so change
// them together.
const SHIPPING_FEE = 4.90;
const FREE_SHIPPING_FROM = 35;
const shippingFor = subtotal => (subtotal >= FREE_SHIPPING_FROM ? 0 : SHIPPING_FEE);
const priceById = new Map(prices.map(p => [p.id, p]));

/* ============================================================
   What is left

   Nothing here writes anything down, because Stripe already has: every paid
   session carries the cart that produced it in its metadata, so what has been
   sold can be asked for rather than stored. That means the counts survive a
   restart, a redeploy and a new container without a database to pay for and
   keep alive, and they cannot drift from the money — the till and the shelf
   are the same record.

   The figures in prices.json are therefore a *starting* stock, true as of
   countSalesSince. Restocking means raising the number and moving that date.
   ============================================================ */

const COUNT_SINCE = Math.floor(
  new Date(catalogue.countSalesSince || '2026-01-01T00:00:00Z').getTime() / 1000);

let soldCache = { at: 0, map: null };

async function soldSoFar() {
  // One call a minute at most: the shop asks on every page load.
  if (soldCache.map && Date.now() - soldCache.at < 60_000) return soldCache.map;

  const sold = {};
  let startingAfter;
  for (let page = 0; page < 10; page++) {
    const batch = await stripe.checkout.sessions.list({
      created: { gte: COUNT_SINCE },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const session of batch.data) {
      if (session.payment_status !== 'paid') continue;
      const raw = session.metadata && session.metadata.ub_items;
      if (!raw) continue;
      let items;
      try { items = JSON.parse(raw); } catch { continue; }
      for (const [sku, qty] of Object.entries(items)) {
        sold[sku] = (sold[sku] || 0) + Number(qty || 0);
      }
    }
    if (!batch.has_more) break;
    startingAfter = batch.data[batch.data.length - 1].id;
  }

  soldCache = { at: Date.now(), map: sold };
  return sold;
}

/* Starting stock minus what Stripe says went out. If Stripe cannot be reached
   the last good answer is used, and only on a cold start does it fall back to
   the starting figures — refusing every sale because of a network blip would
   be a worse failure than briefly offering one comb too many. */
async function availability() {
  let sold = {};
  try {
    sold = await soldSoFar();
  } catch (err) {
    console.error('Could not read sales from Stripe:', err.message);
    sold = soldCache.map || {};
  }

  const items = {};
  const grams = Object.fromEntries(
    Object.entries(pools).map(([name, v]) => [name, v.grams ?? 0]));

  for (const product of prices) {
    const out = sold[product.id] || 0;
    if (product.pool) {
      grams[product.pool] = Math.max(0, (grams[product.pool] ?? 0) - out * product.g);
    } else {
      items[product.id] = Math.max(0, (product.stock ?? 0) - out);
    }
  }
  return { items, pools: grams };
}

/* A honey cut to order has no count of packs: it has a weight, and the sizes
   share it. So stock is checked twice — once per row for countable packs, and
   once per pool for the grams a whole cart asks for. Doing it per line would
   let three 400 g combs through on 1 kg of honey, because each line on its own
   looks fine. */
async function checkCart(cart){
  const left = await availability();
  const used = {};
  for (const [idStr, qty] of Object.entries(cart)) {
    const product = priceById.get(Number(idStr));
    const quantity = Number(qty);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      return { error: 'Invalid cart line', id: idStr, status: 400 };
    }
    if (product.pool) {
      used[product.pool] = (used[product.pool] || 0) + product.g * quantity;
    } else if (quantity > (left.items[product.id] ?? 0)) {
      return { error: 'Out of stock', id: product.id, left: left.items[product.id] ?? 0, status: 409 };
    }
  }
  for (const [name, gramsWanted] of Object.entries(used)) {
    const have = left.pools[name] ?? 0;
    if (gramsWanted > have) {
      return { error: 'Out of stock', pool: name, wanted: gramsWanted, left: have, status: 409 };
    }
  }
  return null;
}

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
app.get('/api/stock', async (req, res) => {
  res.json(await availability());
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

    // Stock is checked here, not in the browser: the page's copy is only for
    // display and anyone can edit it. The whole cart is weighed at once.
    const bad = await checkCart(cart);
    if (bad) throw new Error(`${bad.error}: ${JSON.stringify(bad)}`);

    const line_items = Object.entries(cart).map(([idStr, qty]) => {
      const id = Number(idStr);
      const quantity = Number(qty);
      const product = priceById.get(id);
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

    // Decided on the cart before any promotion code, which Stripe applies
    // later on its own page.
    const subtotal = Object.entries(cart).reduce(
      (n, [id, qty]) => n + priceById.get(Number(id)).price * Number(qty), 0);
    const fee = shippingFor(Math.round(subtotal * 100) / 100);
    const shipping_options = [{
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: Math.round(fee * 100), currency: 'eur' },
        display_name: fee
          ? (locale === 'it' ? 'Spedizione' : 'Shipping')
          : (locale === 'it' ? 'Spedizione gratuita' : 'Free shipping'),
        delivery_estimate: {
          minimum: { unit: 'business_day', value: 2 },
          maximum: { unit: 'business_day', value: 4 },
        },
      },
    }];

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // Apple Pay and Google Pay ride along with 'card' and need no entry here.
      payment_method_types: PAYMENT_METHODS,
      // Shows the "Add promotion code" field on Stripe's page. The codes
      // themselves are created in the Stripe dashboard, not here.
      allow_promotion_codes: true,
      // Asks for a phone number on Stripe's page, so the courier and we can
      // reach the customer. It arrives on the session as customer_details.phone.
      phone_number_collection: { enabled: true },
      line_items,
      locale,
      // Italy only for now: the business is not yet set up to charge another
      // country's VAT, and honey is restricted at several non-EU borders.
      shipping_address_collection: { allowed_countries: ['IT'] },
      shipping_options,
      // The cart rides along so a paid session can be read back as a sale.
      // This is what makes the stock count possible without a database.
      metadata: { ub_items: JSON.stringify(cart).slice(0, 480) },
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
const RESEND_API_URL = process.env.RESEND_API_URL || 'https://api.resend.com/emails';
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
  const r = await fetch(RESEND_API_URL, {
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

/* Newsletter signups are written to a Google Sheet: the server posts each
   address to a small Google Apps Script web app bound to that sheet, which
   appends a row (see server/README.md). Set NEWSLETTER_SHEET_URL on Render
   to that web app's URL. Without it, each signup is emailed to
   ORDER_EMAIL_TO instead, so no address is ever lost. */
const NEWSLETTER_SHEET_URL = process.env.NEWSLETTER_SHEET_URL || '';

async function addToSheet(email, lang){
  const r = await fetch(NEWSLETTER_SHEET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, lang, source: 'sito' }),
    redirect: 'follow',     // Apps Script answers through a redirect
  });
  if (!r.ok) throw new Error(`Sheet ${r.status}`);
}

app.post('/api/subscribe', async (req, res) => {
  if (!NEWSLETTER_SHEET_URL && (!RESEND_API_KEY || !ORDER_EMAIL_TO)) {
    return res.status(503).json({ error: 'Newsletter is not configured' });
  }
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: 'Too many requests' });

  const email = str((req.body || {}).email, 120).toLowerCase();
  if ((req.body || {}).company) return res.json({ ok: true });  // honeypot
  if (!looksLikeEmail(email)) return res.status(400).json({ error: 'Invalid email' });

  try {
    if (NEWSLETTER_SHEET_URL) {
      await addToSheet(email, (req.body || {}).lang === 'en' ? 'en' : 'it');
      console.log('Newsletter signup saved');   // the address itself stays out of the logs
      return res.json({ ok: true });
    }
    await sendEmail({
      to: ORDER_EMAIL_TO,
      replyTo: email,
      subject: `Iscrizione newsletter — ${email}`,
      html: `<div style="font-family:sans-serif;font-size:14px">
               <p>Nuova iscrizione alla newsletter:</p>
               <p><strong>${esc(email)}</strong></p>
             </div>`,
    });
    console.log('Newsletter signup received');   // the address itself stays out of the logs
    res.json({ ok: true });
  } catch (err) {
    console.error('Subscribe error:', err.message);
    res.status(500).json({ error: 'Could not subscribe' });
  }
});

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
    const bad = await checkCart(cart);
    if (bad) {
      const { status, ...body } = bad;
      return res.status(status).json(body);
    }

    const lines = [];
    let total = 0;
    for (const [idStr, qty] of Object.entries(cart)) {
      const product = priceById.get(Number(idStr));
      const quantity = Number(qty);
      const sum = product.price * quantity;
      total += sum;
      lines.push({ name: product.name[it ? 'it' : 'en'], unit: product.unit[it ? 'it' : 'en'], quantity, sum });
    }
    if (!lines.length) return res.status(400).json({ error: 'Cart is empty' });
    total = Math.round(total * 100) / 100;
    const shipping = shippingFor(total);
    total = Math.round((total + shipping) * 100) / 100;

    const reference = orderReference();
    const rows = lines.map(l =>
      `<tr><td>${esc(l.quantity)}&times;</td><td>${esc(l.name)}<br><small>${esc(l.unit)}</small></td>` +
      `<td align="right">${money(l.sum)}</td></tr>`).join('');

    const orderTable =
      `<table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">` +
      rows +
      `<tr><td></td><td>${it ? 'Spedizione' : 'Shipping'}</td>` +
      `<td align="right">${shipping ? money(shipping) : (it ? 'Gratis' : 'Free')}</td></tr>` +
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
            ? 'Spediamo appena il bonifico arriva, di solito in due o tre giorni lavorativi.'
            : 'We ship as soon as the transfer arrives, usually within two or three working days.'}</p>
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
