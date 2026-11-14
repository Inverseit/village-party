#!/usr/bin/env bash
# Start the village party game: the server, plus a throwaway local Solana validator per run.
#   ./party.sh                 # free scripted villagers
#   PROVIDER=openai ./party.sh # LLM villagers (needs OPENAI_API_KEY in .env)
# The Solana tools live in .tools/ (project-local). The validator's keypair lives in
# ~/.cache/village-party, because the Solana CLI cannot read a keypair from a path with a
# space in it; it only ever signs on the local throwaway validator.
set -euo pipefail
cd "$(dirname "$0")"
export SOLANA_BIN="$PWD/.tools/solana-release/bin"
[ -x "$SOLANA_BIN/solana-test-validator" ] || { echo "Solana tools missing: see AGENTS.md (setup)"; exit 1; }
PARTY_HOME="${PARTY_HOME:-$HOME/.cache/village-party}"
KEY="$PARTY_HOME/.config/solana/id.json"
[ -f "$KEY" ] || { mkdir -p "$(dirname "$KEY")"; HOME="$PARTY_HOME" "$SOLANA_BIN/solana-keygen" new --no-bip39-passphrase --silent -o "$KEY"; }
[ -f chain/target/deploy/chain.so ] || { mkdir -p chain/target/deploy chain/target/idl; cp chain/prebuilt/chain.so chain/target/deploy/; cp chain/prebuilt/chain.json chain/target/idl/; }
export HOME="$PARTY_HOME" MANAGED_VALIDATOR=1 PROVIDER="${PROVIDER:-stub}" AGENTS="${AGENTS:-24}" PORT="${PORT:-8787}"
exec node backend/src/server.mjs
