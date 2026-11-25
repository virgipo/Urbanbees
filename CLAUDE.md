# Urban Bees — read this first

The shop at **urbanbees.it**: Italian honey in the comb (*miele in favo*) from
small beekeepers, sold online by Virginia Ponti from Milan. She is not a
developer and works in Italian: answer her in Italian, plainly, and explain
what you did and why before any jargon.

## Before you touch anything

- **Other sessions push to this repository too** — other Claude Code
  sessions and claude.ai project threads. Start every task with
  `git fetch origin` and work from the current `origin/main`, never from a
  checkout that might be days old. If `main` moved, merge it in first.
- **Nothing goes to `main` without Virginia saying so** (she says
  "pubblica"). `main` is what the public site runs on.
- **The repository is public.** Never commit secrets, API keys, her IBAN, or
  the list of beekeepers she is still talking to. Keys live only in Render's
  Environment settings; never ask her to paste one into the chat.

## How it is built

| Part | Where | Deploys |
| --- | --- | --- |
| Storefront | `index.html` — one file, no build step, IT + EN strings inside | Render static site, auto from `main` |
| Checkout server | `server/` — Express, Stripe, Resend | Render web service `urbanbees-checkout`, auto from `main` |
| Fonts | `fonts/` — Plus Jakarta Sans, self-hosted on purpose (no Google Fonts) | with the site |
| Photos | `blog/`, `prodotti/` — webp, EXIF stripped | with the site |

Italian is the default language; **every visible string exists in both IT and
EN**. Colours: dark green `#1F2A1E`, beige `#F1EADF`.

## The catalogue lives in two files — keep them identical

`PRODUCTS` in `index.html` draws the shop. `server/prices.json` is the one that
counts: prices and stock are always looked up there, never trusted from the
browser. Change one, change the other. `server/README.md` has the details.

- **One card per honey, one code per size.** Code = beekeeper + size:
  1xx Cazzola, 2xx Marco Ruga, 3xx El Veler; x01 small, x02 medium, x03
  large. The grams live in the entry, not in the code: Cazzola's 101 is
  90 g, Ruga's 201/202/203 are 125/200/400 g.
  Never reuse a code for something else.
- **Two kinds of stock.** Packs carry `stock` (El Veler: trays). Honey cut to
  order carries a weight shared by its sizes (`pool` + `grams`; Marco Ruga's
  linden). The server weighs the whole cart against the pool.
- **`soon: true`** shows a honey as "Presto disponibile" and blocks the cart.
- **The stock counts itself from Stripe.** Each checkout session carries its
  cart in `metadata.ub_items`; `/api/stock` subtracts paid sessions created
  since `countSalesSince`. **Restocking = raise the number AND move that date.**

## Payments and orders

- Stripe is **live**. Card only; Italy only; shipping 4,90 € below 35 €, free
  from 35 € (`SHIPPING_FEE` / `FREE_SHIPPING_FROM` in the server, mirrored in
  the page).
- **Order notifications come from Zapier**, outside this repository. Do not
  add a Stripe webhook that emails orders, or every order arrives twice.
- Newsletter signups go to a Google Sheet (`NEWSLETTER_SHEET_URL`).
- Bank transfer is written but switched off until IBAN and holder are set on
  Render.

## On hold — do not restart without asking

- **Privacy policy**: removed from the site on purpose; the text is in git at
  `482a4ff:privacy.html`.
- Terms of sale: not written yet. Ask Virginia before drafting.

This file is public: the static site serves the whole repository, so anyone
who types `urbanbees.it/CLAUDE.md` can read it. Keep it to how the code works;
business matters belong in her claude.ai project, not here.

## Writing for this shop

- It sells **combs**, not jars. Say *favo*, never *vasetto*.
- No superlatives ("il più autentico"). Say what is true and checkable.
- Never invent facts about a beekeeper or a honey. Ask.

## Checking your work

Serve the site with `python3 -m http.server`, drive it with Playwright
(Chromium is preinstalled), and look at it on a phone size and a desktop size
before saying it is done. For the server, see `server/README.md`.
