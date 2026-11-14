---
name: party-game
description: Run, test and tune the village party game (party/ + web/) — the multiplayer host-screen + phone-controller game served by `npm start`. Use when working on party/*.mjs, web/src/party, web/src/play, or anything the root package.json scripts touch.
---

# Village party game

The root `package.json` is the party game, not the Solana simulation. It needs **no
validator and no API key**: `party/server.mjs` holds one game in memory, keeps finished games
in SQLite (`node:sqlite`, Node 22.13+), and serves the built `web/dist`.

## Commands (repo root)

```bash
npm test                         # node --test party/*.test.mjs (game + server, ~8s)
node party/sim.mjs [games] [bots] [rounds] [chaos]   # instant balance harness, no timers
npm run web:build                # build web/dist — the server serves it; rebuild after web/ changes
npm start                        # http://localhost:8787 host screen, /play phone controller
PORT=8790 npm start              # another port
npm run web:dev                  # Vite on :5183, proxies /state /events /api /start /stop to :8787
```

- `GET /state` returns JSON (good smoke test); `/events` is SSE.
- Phones join at `joinBase` from `/state`: `PUBLIC_URL` wins, else a local ngrok tunnel, else the LAN IP.
- AI villagers use `OPENAI_API_KEY` (env, `./.env` or `../.env`), `OPENAI_MODEL` (default
  `gpt-6-luna`) and `PARTY_AI_BUDGET_USD` (default 0.5). Without a key every villager is
  scripted (`party/bots.mjs`) — that is free; LLM villagers cost real money, never enable
  them unless asked.
- Game data: `party/data/party.db` (gitignored); override with `PARTY_DB`.
- Balance constants live in `party/game.mjs` (`C`, `EVENTS`); check changes with `sim.mjs`.

## Testing in the browser

Start `npm run web:build && npm start`, open `http://localhost:8787` as host, and
`http://localhost:8787/play` in a second tab (or a phone-sized window) as a player.
