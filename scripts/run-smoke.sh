#!/usr/bin/env bash
# Boots the emulators and a dev server, seeds, runs tests/smoke.mjs, tears
# everything down. Used by `npm run test:e2e`.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${SMOKE_ENV_FILE:-.env.smoke}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. See SETUP.md, 'Running the tests'." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
export GCLOUD_PROJECT="$FIREBASE_PROJECT_ID"

LOGS="$(mktemp -d)"
EMU_PID=""
DEV_PID=""

cleanup() {
  [[ -n "$DEV_PID" ]] && kill "$DEV_PID" 2>/dev/null
  [[ -n "$EMU_PID" ]] && kill "$EMU_PID" 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT

wait_for() {
  local url="$1" name="$2" tries="${3:-60}"
  for _ in $(seq "$tries"); do
    if curl -sf -o /dev/null "$url" 2>/dev/null; then return 0; fi
    sleep 1
  done
  echo "$name never came up. Log:" >&2
  tail -30 "$LOGS/$name.log" >&2
  return 1
}

echo "starting emulators…"
npx firebase emulators:start --only firestore,auth --project "$FIREBASE_PROJECT_ID" \
  >"$LOGS/emulators.log" 2>&1 &
EMU_PID=$!
wait_for "http://127.0.0.1:8080/" emulators || exit 1
wait_for "http://127.0.0.1:9099/" emulators || exit 1

echo "seeding…"
node scripts/seed.mjs >"$LOGS/seed.log" 2>&1 || {
  tail -20 "$LOGS/seed.log" >&2
  exit 1
}

echo "starting dev server…"
npx next dev --port 3000 >"$LOGS/dev.log" 2>&1 &
DEV_PID=$!
wait_for "http://127.0.0.1:3000/" dev || exit 1

echo "running smoke test…"
node tests/smoke.mjs
STATUS=$?

if [[ $STATUS -ne 0 ]]; then
  echo "--- dev server log (tail) ---" >&2
  tail -40 "$LOGS/dev.log" >&2
fi

exit $STATUS
