# PokeMMO leveling orders

A one-page order form (GitHub Pages): customers add Pokémon to a box, set the levels, EVs and level-up moves per
species, pick a meeting time, give their in-game name and Discord username, and the order arrives in Discord. Prices:
0.17 ¥ per exp, 20,000 ¥ per Pokémon with EVs.

## Files

- `index.html`, `style.css`, `app.js` - the page. `ORDER_URL` at the top of `app.js` is the relay's address.
- `data.js` - every Pokémon you can order (649 + 11 forms with their own moves), its exp group and level-up moves.
- `relay/worker.js` - the Cloudflare Worker between the page and Discord. It holds the webhook as a secret, so the
  webhook URL never appears on the public page; only order-shaped messages get through, nobody can be pinged, and
  one order a minute per address.

## Setting up the relay (once)

1. Make a free Cloudflare account, then Workers & Pages -> Create -> Create Worker -> name it
   `pokemmo-orders-relay` -> Deploy.
2. Edit code: replace everything with `relay/worker.js` -> Deploy.
3. Settings -> Variables and Secrets -> Add: type Secret, name `WEBHOOK_URL`, value your Discord webhook URL.
   Add a second one: type Text, name `ALLOWED_ORIGIN`, value `https://cassnadra.github.io`.
4. Copy the worker's address into `ORDER_URL` in `app.js` (now: https://pokemmo-orders-relay.cassnadra.workers.dev/).

## Security

- The page sends only what is ordered (Pokémon, levels, EVs, moves, time, names, notes). The relay checks it against
  its own copy of the data (`relay/data.js`, written by `tools/make_data.py`), works out every price, and writes the
  Discord message itself. A faked price on the page shows up as "⚠ Price mismatch" with the real total.
- The customer's names and notes lose Discord markdown, links, mentions and timestamps; nothing can ping.
- Every order needs Cloudflare Turnstile (invisible bot check; secret `TURNSTILE_SECRET` on the relay).
- One order a minute per address, at most 10 a minute per relay instance.
- The page: a Content-Security-Policy (scripts only from this site and Cloudflare's bot check, sends only to the relay),
  it won't show inside another site's frame, and a saved draft is checked before it's used.
- If the relay is ever abused anyway: make a new Discord webhook and replace the relay's `WEBHOOK_URL` secret.

Tests: `node relay/worker_test.mjs` (tampering, injection, limits, bot check) and `tools/test_page.py`.

## Where the data comes from

PokeMMO's own files, so the moves are exactly the game's:

- level-up moves: the client's `data/data.pak` (`tools/pak_learnsets.py`)
- exp groups: the Pokémon Black ROM PokeMMO runs on (`tools/rom_growth.py`, needs `pip install ndspy`)
- names: MMO Showdown's PokeMMO dex (species) and Showdown's move list (moves by number)

Rebuild after a PokeMMO update: run the two tools into `src/`, then `python -I tools/make_data.py src raw_csv data.js`.
`tools/compare_pak.py` compares the game's moves with MMO Showdown's; `tools/test_page.py` tests the page in headless
Edge (needs `pip install playwright`).
