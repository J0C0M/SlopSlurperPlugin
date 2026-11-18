#!/usr/bin/env bash
# Bouwt de plugin en start de lokale Paper 1.21.11 server in run/.
# Gebruik:  ./start-server.sh            (bouwen + starten)
#           ./start-server.sh --reset    (run/ weggooien en opnieuw uit server-template/ halen)
#           ./start-server.sh --no-build (alleen starten)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="$ROOT/server-template"
RUN="$ROOT/run"
PLUGIN="$ROOT/plugin"
MEMORY="${MEMORY:-2G}"
RESET=0
BUILD=1
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    --no-build) BUILD=0 ;;
    *) echo "Onbekende optie: $arg"; exit 1 ;;
  esac
done

java_major() {
  "$1" -version 2>&1 | head -1 | sed -E 's/.*version "([0-9]+)(\.([0-9]+))?.*/\1 \3/' | awk '{ if ($1 == 1) print $2; else print $1 }'
}

# 1. Java 21+ zoeken
JAVA=""
for c in "${JAVA_HOME:+$JAVA_HOME/bin/java}" "$(command -v java || true)"; do
  if [ -n "$c" ] && [ -x "$c" ] && [ "$(java_major "$c")" -ge 21 ] 2>/dev/null; then JAVA="$c"; break; fi
done
if [ -z "$JAVA" ]; then
  echo "Geen Java 21 of nieuwer gevonden. Installeer bijvoorbeeld Temurin 21: https://adoptium.net/" >&2
  exit 1
fi
export JAVA_HOME="$(cd "$(dirname "$JAVA")/.." && pwd)"
echo "Java: $JAVA"

# 2. Plugin bouwen
if [ "$BUILD" = 1 ]; then
  echo "Plugin bouwen..."
  (cd "$PLUGIN" && ./mvnw -q -B package)
fi

# 3. run/ klaarzetten
if [ "$RESET" = 1 ] && [ -d "$RUN" ]; then
  echo "run/ wordt gereset vanuit server-template/..."
  rm -rf "$RUN"
fi
if [ ! -d "$RUN" ]; then
  echo "run/ aanmaken vanuit server-template/..."
  cp -R "$TEMPLATE" "$RUN"
fi

# 4. Plugin-jar kopiëren
mkdir -p "$RUN/plugins"
if [ -f "$PLUGIN/target/SlopSlurperPlugin.jar" ]; then
  cp -f "$PLUGIN/target/SlopSlurperPlugin.jar" "$RUN/plugins/"
else
  echo "Waarschuwing: geen plugin-jar gevonden, server start zonder plugin." >&2
fi

# 5. Starten
cd "$RUN"
exec "$JAVA" -Xms1G "-Xmx$MEMORY" -jar paper.jar --nogui
