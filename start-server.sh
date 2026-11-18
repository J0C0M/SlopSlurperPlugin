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

# 0. Een server van een vorige start die nog draait (bijv. nog aan het afsluiten na Ctrl+C,
#    gepauzeerd met Ctrl+Z of open in een ander venster) houdt de poort bezet. Die eerst stoppen,
#    vóór --reset run/ weggooit onder een draaiende server.
server_port() {
  local f port
  for f in "$RUN/server.properties" "$TEMPLATE/server.properties"; do
    if [ -f "$f" ]; then
      port="$(tr -d '\r' < "$f" | sed -n 's/^server-port=\([0-9][0-9]*\).*/\1/p' | head -1)"
      echo "${port:-25565}"
      return
    fi
  done
  echo 25565
}

port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

is_running() {
  local stat
  stat="$(ps -o stat= -p "$1" 2>/dev/null || true)"
  [ -n "$stat" ] && [ "${stat:0:1}" != "Z" ]
}

# PID's van Paper-servers die uit deze run/ map draaien
find_running_servers() {
  local p cmd cwd
  for p in $(pgrep java 2>/dev/null || true); do
    cmd="$(ps -ww -o args= -p "$p" 2>/dev/null || true)"
    case "$cmd" in *paper.jar*) ;; *) continue ;; esac
    cwd="$(readlink "/proc/$p/cwd" 2>/dev/null || true)"
    if [[ "$cmd" == *"-Dslopslurper.run=$RUN "* ]] || [ "${cwd% (deleted)}" = "$RUN" ]; then
      is_running "$p" && echo "$p"
    fi
  done
}

stop_running_servers() {
  local pids p i
  pids="$(find_running_servers)"
  [ -z "$pids" ] && return 0
  for p in $pids; do
    echo "Er draait nog een server van een vorige start (PID $p). Die wordt eerst netjes afgesloten..."
    kill -CONT "$p" 2>/dev/null || true # voor het geval hij met Ctrl+Z gepauzeerd is
    kill -TERM "$p" 2>/dev/null || true
  done
  for p in $pids; do
    for i in $(seq 1 60); do
      is_running "$p" || break
      sleep 1
    done
    if is_running "$p"; then
      echo "Server (PID $p) reageert niet na 60s, wordt geforceerd gestopt." >&2
      kill -KILL "$p" 2>/dev/null || true
      sleep 1
    fi
  done
}

stop_running_servers
PORT="$(server_port)"
if port_in_use "$PORT"; then
  echo "Poort $PORT is al in gebruik door een ander programma, de server kan niet starten." >&2
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :$PORT" 2>/dev/null | tail -n +2 >&2 || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2 || true
  fi
  echo "Stop dat programma, of zet een andere server-port in run/server.properties." >&2
  exit 1
fi

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

# 5. Starten. -Dslopslurper.run markeert het proces, zodat een volgende start het terugvindt.
cd "$RUN"
exec "$JAVA" "-Dslopslurper.run=$RUN" -Xms1G "-Xmx$MEMORY" -jar paper.jar --nogui
