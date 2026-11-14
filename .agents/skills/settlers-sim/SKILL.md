---
name: settlers-sim
description: Run the Settlers of Solana simulation (backend/ + chain/) against a local Solana validator — headless stub runs, the dashboard, rebuilding the Anchor program, and analysing runs. Use when touching backend/src, backend/scripts, chain/, or when asked to run/compare/analyse a village run.
---

# Settlers of Solana simulation

`CLAUDE.md` and `README.md` are the reference; this is the verified, minimal path.

## Toolchain (installed by the Devin blueprint)

- Node 22 (nvm), Solana/Agave CLI in `~/.local/share/solana/install/active_release/bin`
  (add to `PATH`), keypair `~/.config/solana/id.json`.
- Rust 1.89 via `chain/rust-toolchain.toml`; Anchor 1.2.0 via `avm` (built from source —
  the prebuilt anchor binary needs GLIBC 2.39 and fails on Ubuntu 22.04).
- `chain/target/` is not in git. Without an `anchor build`, seed it from the prebuilt program:
  `mkdir -p chain/target/deploy chain/target/idl && cp chain/prebuilt/chain.so chain/target/deploy/ && cp chain/prebuilt/chain.json chain/target/idl/`

## Run a village (free)

```bash
export PATH=$HOME/.local/share/solana/install/active_release/bin:$PATH
backend/scripts/validator.sh          # own long-lived shell; Ctrl-C stops it and deletes the ledger
PROVIDER=stub AGENTS=10 RUN_ROUNDS=5 OPEN_BROWSER=0 node backend/src/server.mjs   # headless, prints invariants
npm start --prefix backend            # dashboard on :8787 (needs npm run web:build for the new UI)
node backend/scripts/analyze.mjs      # latest runs/<timestamp>
```

`./party.sh` instead runs the backend with a validator it manages itself (`MANAGED_VALIDATOR=1`);
it expects `.tools/solana-release` → symlink it to the active Solana release.

## Gotchas

- Stop the validator with Ctrl-C (SIGINT) in its own shell. Killing `validator.sh` with
  `timeout`/SIGTERM orphans `solana-test-validator`, which then holds ports 8899/9900 and makes
  the next start fail with "Unable to bind faucet". Fix: `pkill -f solana-test-validator`.
- Change `lib.rs` → `cd chain && anchor build` → restart the validator, or every settle fails
  with `InsufficientGoods`. The hosted image uses `chain/prebuilt` (SBPF v0, for Agave 2.2):
  rebuild it as the Dockerfile comment says.
- The ledger grows ~90 MB/min; don't leave a validator running.
- `cargo test` in `chain/` compiles and passes but currently has 0 tests.
- `PROVIDER=openai|anthropic|deepinfra` runs cost real money — never start one unless asked.
