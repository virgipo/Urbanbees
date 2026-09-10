/**
 * Rebuilds api/_products.js from the catalogue in index.html.
 *
 * The browser catalogue is the single source of truth for what a jar costs.
 * The checkout function needs the same numbers server-side, because prices
 * that arrive from the browser can be edited by the buyer before they're sent.
 *
 * Run this after changing any price, name or jar size:  npm run sync-products
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const match = src.match(/const PRODUCTS = (\[[\s\S]*?\n\];)/);
if (!match) {
  console.error('Could not find the PRODUCTS array in index.html.');
  process.exit(1);
}

const products = eval(match[1].replace(/;$/, ''));

const rows = products.map(p => ({
  id: p.id,
  amount: Math.round(p.price * 100), // Stripe charges in cents
  name: { it: p.name.it, en: p.name.en },
  unit: { it: p.unit.it, en: p.unit.en },
}));

const out =
  '// Generated from the catalogue in index.html — the server never trusts client prices.\n' +
  '// Regenerate with: npm run sync-products\n\n' +
  'export const PRODUCTS = ' + JSON.stringify(rows, null, 2) + ';\n\n' +
  "export const CURRENCY = 'eur';\n";

fs.writeFileSync(path.join(root, 'api', '_products.js'), out);
console.log(`Wrote api/_products.js — ${rows.length} products.`);
