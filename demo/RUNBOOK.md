# Eurasian Hack London — submission runbook

## Event facts

- One-day hackathon by Eurasian Hub; Cognition is the main partner.
- **16:00 is hard code freeze and submission close.** Judging is 16:00–16:30, science-fair style at your table.
- The only real rule: it must be built via Devin. Unofficial tracks include Real-time/multiplayer, Money-moving apps and Generative media.
- Eurasian Hub is offering a **$1,000 cash prize**.

## Pitch and track fit

**Village Party — a party game where your phone is an Orchard villager in a tiny island economy; apple, wood and basket prices move with what everyone does; and the same island is a private survival benchmark for AI models.**

- **Primary:** Real-time/multiplayer — everyone picks on their own phone; the island and market update together.
- **Also:** Money-moving apps — in Settlers of Solana, every trade settles on a Solana program.
- **Also:** Generative media — the game has an original synthesized score and a rendered demo film.
- Built with Devin.

The village now picks apples in the Orchard and weaves baskets in the Workshop. Event IDs are unchanged: `shoal` displays as **Bumper crop**, `gulls` as **Crow heist**, and `storm` as **Hailstorm**.

## Before 16:00

- [ ] Push the repo and make sure the submitted revision is the one on screen.
- [ ] Update the README and check the demo/runbook links.
- [ ] GitHub Pages is on (Settings → Pages → Deploy from branch `main`, folder `/` (root)); open https://inverseit.github.io/village-party/docs/village-party-demo.mp4 and https://inverseit.github.io/village-party/docs/deck/ once to confirm they load.
- [ ] Submit the project link and video before the deadline; don't rely on a saved draft.
- [ ] Charge the laptop, bring its charger, and test the big-screen display.
- [ ] Have a phone hotspot ready; test the QR on the same Wi-Fi and, if needed, a tunnel.

## Set up the live demo

From the repo root, build and start the party host:

```bash
npm install && npm run web:install && npm run web:build && npm start
```

Open **http://localhost:8787** on the big screen. Create a room with about **14 bots, 8 rounds, 10 seconds per round, chaos 3**. Phones join by scanning the room QR code. Same Wi-Fi is simplest. For remote phones, run `ngrok http 8787` in another terminal; the party server detects an ngrok tunnel automatically. For a different public URL, start the server with `PUBLIC_URL=https://your-public-host npm start`.

If Wi-Fi dies, run the local scripted-player backup against the server:

```bash
node party/demo.mjs --humans 4 --rounds 12 --seconds 7
```

Those flags are supported. The CLI accepts `--port`, `--bots`, `--humans`, `--rounds`, `--seconds`, `--chaos` and `--lobby`; defaults are port 8787, 14 bots, 4 humans, 30 rounds, 8-second rounds, chaos 3 and a 3-second lobby. It drives four synthetic phone players through a complete game. The party game uses scripted bots; **never start paid LLM mode** for this demo.

## 90-second judge script

Have the room ready and start the game as the judge scans in. Keep talking while rounds resolve.

1. **Hook (0–10 s):** “Your group chat has to decide who picks the apples. Naturally, it invents a market.”
2. **Join (10–20 s):** Point to the QR; invite the judge to join and pick a job on their phone.
3. **Economics (20–33 s):** “A job everybody picks pays badly; a job nobody picks pays well.” Target price is `base × (normal supply / actual supply)^0.6`, clamped to 0.4–2.5× and smoothed with the previous price.
4. **Live event (33–43 s):** Queue the crow raid for the next round boundary:
   ```bash
   curl -sS -X POST http://localhost:8787/api/event \
     -H 'content-type: application/json' \
     -d '{"id":"gulls"}'
   ```
   The endpoint takes an event `id`; the API ID is still `gulls`, while the phone now displays **Crow heist**. Show the event and the market response on screen.
5. **Results (43–55 s):** Open the results screen and point out the price and points charts.
6. **Benchmark (55–73 s):** “Swap scripted villagers for a model: same rules and events, same board. The private benchmark rewards surviving fed, warm and solvent. Nothing to memorise; compare humans, bots and the model together.”
7. **Solana + Devin (73–90 s):** “In Settlers of Solana, the model decides off-chain but every trade settles on an Anchor program.” Devin was used to build the project. If useful, show the free local run: start `backend/scripts/validator.sh` in one terminal, then run `PROVIDER=stub node backend/src/server.mjs` in another. Stub villagers are free; do not select a paid model.

## Likely judge questions

- **Is it really multiplayer?** Yes. Phones join the same live room, each controls a villager, and picks, events and results are shared on the host screen.
- **Where's the AI?** Party mode is scripted for a reliable live demo. The companion Settlers simulation in `backend/` can swap in model-controlled villagers.
- **How is the benchmark scored?** By survival and wellbeing: stay fed and warm, avoid going broke, and finish with a strong life. Humans, scripted bots and models can share the board.
- **Why Solana?** In Settlers of Solana, the Anchor program owns the ledger and settles trades; the backend cannot simply hand a villager coins.
- **What did Devin build?** Say what you used Devin for. This demo film, its renderer, music and this runbook were made by Devin.

## Demo film and regeneration

The target final file is `demo/out/village-party-demo.mp4`; the headless renderer writes frames first and the ffmpeg montage step creates the MP4. It starts from a real scripted Orchard game recording, replays that timeline on the Three.js island with a virtual clock, and uses original music synthesized in Python.

1. Run from the repo root. If the party server is not already running, start it in its own terminal; then record and render the score:
   ```bash
   PORT=8790 PARTY_DB=/home/ubuntu/demo/party-orchard.db node party/server.mjs
   node demo/record.mjs
   python demo/music.py
   ```
   By default, `record.mjs` writes into `/home/ubuntu/demo/rec/` and `/home/ubuntu/demo/phone/`, and `music.py` writes under `/home/ubuntu/demo/audio/`. Override with `DEMO_OUTPUT_DIR` and `DEMO_AUDIO_DIR` (relative paths resolve from the repo root). Phone captures use the CDP endpoint at `localhost:29229` by default.
2. Copy recording files to the film source data directory. Keep the timeline JSON at the data root; the renderer reads it there:
   ```bash
   cp -R /home/ubuntu/demo/rec/. web/src/film/data/
   mkdir -p web/src/film/data/phone
   cp -R /home/ubuntu/demo/phone/. web/src/film/data/phone/
   ```
3. Start the Vite page, render the frames, then assemble the montage:
   ```bash
   VITE_PORT=5190 npm --prefix web run dev
   node demo/render.mjs --workers 8 --fps 24 --warm 1 --scale 0.6667   # 1280x720; resumes if interrupted
   python3 demo/mix.py                                                   # music + SFX → demo/out/mix.wav
   bash demo/montage.sh                                                  # → demo/out/village-party-demo.mp4
   cp demo/out/village-party-demo.mp4 docs/                              # published copy (GitHub Pages)
   ```
   Check one shot first with `node demo/render.mjs --still tutor:8` (writes `demo/out/stills/`). The shot list, captions and camera paths are in `web/src/film/shots.js`. On this VM (software WebGL, 8 cores) the full render takes about 40 minutes.
