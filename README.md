# PokeMMO leveling orders

A one-page order form (GitHub Pages): customers add Pokémon to a box, set the levels, EVs and level-up moves per
species, pick a meeting time and contact method, and the order arrives in Discord. Prices are fixed:
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

Test the relay: `node relay/worker_test.mjs` (Discord stubbed out).

## Where the data comes from

PokeMMO's own files, so the moves are exactly the game's:

- level-up moves: the client's `data/data.pak` (`tools/pak_learnsets.py`)
- exp groups: the Pokémon Black ROM PokeMMO runs on (`tools/rom_growth.py`, needs `pip install ndspy`)
- names: MMO Showdown's PokeMMO dex (species) and Showdown's move list (moves by number)

Rebuild after a PokeMMO update: run the two tools into `src/`, then `python -I tools/make_data.py src raw_csv data.js`.
`tools/compare_pak.py` compares the game's moves with MMO Showdown's; `tools/test_page.py` tests the page in headless
Edge (needs `pip install playwright`).
