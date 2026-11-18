# SlopSlurperPlugin

Een Paper-plugin voor Minecraft **1.21.11** die ingame spelersdata opslaat, zodat we kunnen zien waar spelers hun tijd aan besteden.

## Mappen

| Map | Wat | In git? |
|---|---|---|
| `plugin/` | De plugin (Maven, Java 21). **Hier werk je.** | Ja |
| `server-template/` | De basisserver: Paper 1.21.11 (build 132), configs en de gedeelde startwereld. | Ja, maar raak hem niet aan |
| `run/` | Jouw lokale server. Wordt bij de eerste start gekopieerd uit `server-template/`. | Nee (genegeerd) |

Je speelt en test dus altijd in `run/`. Wat je daar bouwt, kapotmaakt of verandert, komt nooit in een commit. Je pusht alleen wijzigingen aan `plugin/`.

## Vereisten

- **Java 21** (bijvoorbeeld [Temurin 21](https://adoptium.net/)). Het script zoekt die zelf op, ook als je standaard `java` een oudere versie is.
- Maven hoef je niet te installeren: `plugin/mvnw` regelt dat.
- Een Minecraft Java-client op 1.21.11.

## Server starten

Windows (PowerShell):

```powershell
.\start-server.ps1
```

Mac/Linux:

```bash
./start-server.sh
```

Het script:
1. bouwt de plugin (`plugin/target/SlopSlurperPlugin.jar`);
2. maakt `run/` aan uit `server-template/` als die nog niet bestaat;
3. kopieert de nieuwe plugin-jar naar `run/plugins/`;
4. start de server.

Verbind daarna in Minecraft met `localhost`. Typ `stop` in de console om de server af te sluiten.

Opties:

| PowerShell | Bash | Effect |
|---|---|---|
| `-Reset` | `--reset` | Gooit `run/` weg en begint opnieuw met de verse templatewereld |
| `-NoBuild` | `--no-build` | Start zonder de plugin opnieuw te bouwen |
| `-NoBlueMap` | `--no-bluemap` | BlueMap (3D-kaart) niet downloaden |
| `-Memory 4G` | `MEMORY=4G ./start-server.sh` | Meer geheugen voor de server |

Als PowerShell het script blokkeert, start je het met `powershell -ExecutionPolicy Bypass -File .\start-server.ps1`.

## Werken aan de plugin

- Code staat in `plugin/src/main/java/com/slopslurper/plugin/`.
- Open `plugin/` in IntelliJ als Maven-project.
- Na een wijziging stop je de server en start je hem opnieuw met het script. Herladen met `/reload` raden we af.

## Data en dashboard

De plugin slaat op welke blokken spelers breken in `run/plugins/SlopSlurperPlugin/data.db` (SQLite).

- **In-game:** `/blockstats` toont je eigen top 10, `/blockstats <speler>` die van een ander (alleen voor op).
- **Dashboard:** zodra de server draait, open je **http://localhost:8080/**. Daar zie je een overzicht van alle spelers en per speler de top-blokken, gereedschap, werelden en activiteit per dag en per uur. De pagina ververst elke 10 seconden.

Het dashboard is standaard alleen bereikbaar vanaf je eigen pc. De poort en het adres stel je in via `run/plugins/SlopSlurperPlugin/config.yml`.

### 3D-kaart (BlueMap)

Op de dashboardpagina **3D-kaart** zie je de wereld in 3D, met een heatmap van waar blokken gebroken zijn. Elke chunk is een gekleurde kolom, van blauw (weinig) naar rood (veel). De kaart komt van [BlueMap](https://bluemap.bluecolored.de/).

- Het startscript downloadt **BlueMap 5.16** eenmalig naar `run/plugins/`. Dat is de laatste versie die 1.21.11 ondersteunt. De download wordt gecontroleerd met een checksum.
- **Eenmalig zelf doen:** BlueMap moet de textures van Minecraft downloaden. Daarvoor moet je zelf akkoord gaan met de [Minecraft EULA](https://aka.ms/MinecraftEULA):
  1. Start de server één keer. BlueMap maakt dan zijn configuratie aan.
  2. Zet in `run/plugins/BlueMap/core.conf` `accept-download: false` op `true` en sla het bestand op.
  3. Start de server opnieuw. BlueMap rendert de wereld, wat de eerste keer even duurt.
- De losse kaart draait op http://localhost:8100/. De heatmap wordt elke minuut bijgewerkt. In BlueMap zet je hem aan of uit via het lagen-menu ("SlopSlurper: gebroken blokken").
- Let op: BlueMap is standaard bereikbaar vanaf je hele netwerk. Wil je dat niet, zet dan in `run/plugins/BlueMap/webserver.conf` `ip: "127.0.0.1"`.
- Geen 3D-kaart nodig? Start met `-NoBlueMap`, of verwijder `run/plugins/bluemap-5.16-paper.jar`. De plugin werkt ook zonder BlueMap.

### API

Het dashboard haalt alles uit een JSON-API. Wil je later een andere frontend of een centrale webapp bouwen, dan is dit het contract:

| Endpoint | Inhoud |
|---|---|
| `GET /api/overview` | Totalen, top-blokken en meest actieve spelers |
| `GET /api/players` | Alle spelers met totaal en laatst actief |
| `GET /api/players/{uuid}?days=14` | Details van één speler, met activiteit per uur over de laatste N dagen |
| `GET /api/heatmap[?player={uuid}]` | Gebroken blokken per chunk (wereld, chunk x/z, aantal, min/max y) |
| `GET /api/config` | Instellingen voor de frontend, bijvoorbeeld of de 3D-kaart beschikbaar is |

### Opbouw

- `storage/DataStore`: de interface voor alle opslag. `SqliteDataStore` is nu de enige implementatie. Een centrale opslag (MySQL of een API) wordt later een tweede implementatie, zonder dat listeners of het dashboard veranderen.
- `web/WebServer`: de ingebouwde webserver (JDK `HttpServer`, geen extra dependencies).
- `src/main/resources/web/`: de dashboard-frontend in pure HTML, CSS en JS, zonder externe libraries of CDN.

## Afspraken

- Commit alleen in `plugin/` (en scripts of docs als dat nodig is).
- Wijzig `server-template/` alleen als het team een nieuwe basiswereld of andere serverconfig wil. Doe dat dan bewust in een aparte commit.
- `eula.txt` staat op `true`. Daarmee is de [Minecraft EULA](https://aka.ms/MinecraftEULA) geaccepteerd voor deze server.
