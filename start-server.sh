#!/usr/bin/env bash
# Bouwt de plugin en start de lokale Paper 1.21.11 server in run/.
# Gebruik:  ./start-server.sh            (bouwen + starten)
#           ./start-server.sh --reset    (run/ weggooien en opnieuw uit server-template/ halen)
#           ./start-server.sh --no-build (alleen starten)
#           ./start-server.sh --no-bluemap (BlueMap 3D-kaart niet downloaden)
set -euo pipefail

# BlueMap 5.16 is de laatste versie die Minecraft 1.21.11 ondersteunt
BLUEMAP_JAR="bluemap-5.16-paper.jar"
BLUEMAP_URL="https://cdn.modrinth.com/data/swbUV1cr/versions/Vb2ZE8bR/bluemap-5.16-paper.jar"
BLUEMAP_SHA512="4336174ede66d4c2f14d1830c068b7a8229afd0dd5e736526246486c1e3ff28eeed6c8044e74ddc81b5067a055a153189006389f5d3e70f434138fe7753628f2"

ROOT="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="$ROOT/server-template"
RUN="$ROOT/run"
PLUGIN="$ROOT/plugin"
MEMORY="${MEMORY:-2G}"
RESET=0
BUILD=1
BLUEMAP=1
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    --no-build) BUILD=0 ;;
    --no-bluemap) BLUEMAP=0 ;;
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

# 4b. BlueMap (3D-kaart) eenmalig downloaden, met checksum-controle
if [ "$BLUEMAP" = 1 ]; then
  if [ ! -f "$RUN/plugins/$BLUEMAP_JAR" ]; then
    echo "BlueMap downloaden (eenmalig, ~6 MB)..."
    TMP="$RUN/plugins/$BLUEMAP_JAR.download"
    if curl -fsSL -o "$TMP" "$BLUEMAP_URL"; then
      if command -v sha512sum >/dev/null; then ACTUAL=$(sha512sum "$TMP" | cut -d' ' -f1)
      else ACTUAL=$(shasum -a 512 "$TMP" | cut -d' ' -f1); fi
      if [ "$ACTUAL" = "$BLUEMAP_SHA512" ]; then
        mv -f "$TMP" "$RUN/plugins/$BLUEMAP_JAR"
        echo "BlueMap geinstalleerd."
      else
        rm -f "$TMP"
        echo "Waarschuwing: checksum van BlueMap klopt niet. Server start zonder 3D-kaart." >&2
      fi
    else
      rm -f "$TMP"
      echo "Waarschuwing: BlueMap downloaden mislukt. Server start zonder 3D-kaart." >&2
    fi
  fi
  if grep -qE '^accept-download:[[:space:]]*false' "$RUN/plugins/BlueMap/core.conf" 2>/dev/null; then
    echo "Let op: BlueMap wacht op jouw akkoord: zet 'accept-download: true' in run/plugins/BlueMap/core.conf (zie README)." >&2
  fi
fi

# 5. Starten
cd "$RUN"
exec "$JAVA" -Xms1G "-Xmx$MEMORY" -jar paper.jar --nogui
