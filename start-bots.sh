#!/usr/bin/env bash
# Start testbots die op de lokale server spelen, zodat de trackers data verzamelen.
# Start eerst de server met:  ./start-server.sh --bots
# Gebruik:  ./start-bots.sh                   (4 bots)
#           ./start-bots.sh --count 5         (ander aantal; zie README)
#           ./start-bots.sh --pvp             (bots vallen elkaar soms aan, nooit echte spelers)
#           ./start-bots.sh --schedule        (bots spelen alleen op hun eigen speeltijden)
#           ./start-bots.sh --homes           (experimenteel: bots bouwen een eigen huis)
# Alle opties gaan door naar bots.js, bijvoorbeeld: ./start-bots.sh --session-min 5 --session-max 15
set -euo pipefail

BOTS="$(cd "$(dirname "$0")" && pwd)/bots"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js niet gevonden. Installeer Node 22 of nieuwer: https://nodejs.org/" >&2
  exit 1
fi
major="$(node --version | sed 's/^v//; s/\..*//')"
if [ "$major" -lt 22 ]; then
  echo "Node $major gevonden, maar de bots hebben Node 22 of nieuwer nodig: https://nodejs.org/" >&2
  exit 1
fi

cd "$BOTS"
# Afhankelijkheden (opnieuw) installeren als ze ontbreken of package-lock.json nieuwer is
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Bot-afhankelijkheden installeren..."
  npm ci --no-fund --no-audit
fi

exec node bots.js "$@"
