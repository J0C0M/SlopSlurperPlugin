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

Verbind daarna in Minecraft met `localhost`. Typ `stop` in de console (of druk Ctrl+C) om de server af te sluiten.

Draait er nog een server van een vorige start (bijvoorbeeld nog aan het afsluiten, gepauzeerd met Ctrl+Z of open in een ander venster), dan sluit het script die eerst af voordat het opnieuw bouwt, reset of start. Is de poort bezet door een ander programma, dan stopt het script met een duidelijke melding.

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

De plugin slaat spelersdata op in `run/plugins/SlopSlurperPlugin/data.db` (SQLite). Elke tracker voegt daar zijn eigen soort data aan toe:

| Tracker | Wat | Instellingen |
|---|---|---|
| `sessions` | Sessies van join tot quit: speeltijd, AFK-tijd en de reden van uitloggen. Events `session_start`, `session_end`, `afk_start` en `afk_end`. | `afk-timeout-seconds` (180), `checkpoint-seconds` (60) |
| `block-break` | Elk gebroken blok: type, plek en gereedschap. Event `block_break`. | – |
| `block-place` | Elk geplaatst blok: type en plek. Event `block_place`. | – |
| `kills` | Mobs en spelers die een speler doodt: type, wapen, plek en afstand. Events `mob_kill` en `pvp_kill`. | – |
| `deaths` | Doodgaan: oorzaak (dader of schadetype, bijv. `ZOMBIE` of `FALL`), plek, verloren items, level en hoe lang de speler het volhield. Event `death`. | – |
| `health` | Schade gedaan en gekregen (per mob of oorzaak), genezing en eten. Schade en genezing zijn opgeteld, in levenspunten (2 = één hart). Schade die door absorptie wordt opgevangen telt niet mee, taart eten ook niet. Events `damage_dealt`, `damage_taken`, `heal` en `eat`. | `flush-seconds` (60) |
| `crafting` | Gecrafte items met het echte aantal (ook bij shift-klik), en of het aan een werkbank of in de inventory was. Event `craft`. | – |
| `stations` | Smelten (item en aantal), enchanten (enchantments en levels), aambeeld (repareren, combineren, boek, hernoemen) en brouwen (op naam van wie de stand het laatst opende). Events `smelt`, `enchant`, `anvil` en `brew`. | – |
| `interactions` | Rechtsklikken op deuren, luiken, poorten, knoppen, hendels, werkstations en redstone (opgeteld per bloktype), en slapen. Kisten en andere opslag niet. Events `interact` en `sleep`. | `flush-seconds` (60) |
| `items` | Opgepakte en weggegooide items (opgeteld per item), en gereedschap en armor dat kapotgaat. Events `pickup`, `drop` en `item_break`. | `flush-seconds` (60) |
| `positions` | Elke paar seconden per speler: wereld, positie, biome, ondergronds of niet, voertuig (boot, paard, minecart, elytra) en welke spelers in de buurt zijn. Eigen tabel `position_samples`. | `sample-seconds` (10), `nearby-radius` (32) |

**Over AFK:** iemand is AFK na `afk-timeout-seconds` zonder echte input. Als input telt: rondkijken, zelf lopen, springen, klikken, interacties, inventory, chat, commando's, sneaken, sprinten en van hotbar-slot wisselen. Meegevoerd worden door water, een minecart of een boot telt niet, dus AFK-pools werken niet om speeltijd te faken. De AFK-tijd telt terug vanaf de laatste input: wie 3 minuten stilstaat, heeft 3 minuten AFK.

**Bij een crash:** lopende sessies worden elke `checkpoint-seconds` tussentijds opgeslagen. Na een crash sluit de plugin ze bij de volgende start af op dat laatste moment, met als reden `SERVER_CRASH`.

**Over posities:** `positions` legt elke `sample-seconds` vast waar iedere online speler is. Elke rij telt als `sample-seconds` speeltijd, dus de som geeft "tijd in biome X" of "tijd met speler Y". "Ondergronds" betekent: geen daglicht en een blok boven je hoofd. Een huis zonder ramen telt dus ook mee. In de Nether en de End is dit leeg. Bij 10 seconden zijn dat 360 rijen per speler per uur.

- **In-game:** `/blockstats` toont hoeveel blokken je gebroken en geplaatst hebt, en je top 10. `/blockstats <speler>` doet dat voor een ander (alleen voor op).
- **Dashboard:** zodra de server draait, open je **http://localhost:8080/**.
  - **Overzicht:** kerncijfers van de hele server, met tabbladen Spelers, Activiteit (speeltijd per dag, AFK, afstand), Blokken, Gevecht (ook de laatste doden met plek) en Items.
  - **Per speler:** verdeeld over de tabbladen Activiteit, Blokken, Gevecht, Items en Locaties: speeltijd en AFK, de laatste sessies, activiteit per dag en per uur, blokken, gereedschap, gedode mobs en spelers, doodsoorzaken, schade, genezing, eten, crafting, smelten, enchanten, aambeeld, brouwen, en uit de posities: tijd per wereld en biome, ondergronds of bovengronds, tijd in voertuigen en met wie de speler het meest speelt.
  - **Heatmap:** waar spelers hun tijd doorbrengen, per wereld en voor iedereen of één speler. Je kunt zoomen (scrollen of knoppen) en slepen.
  - De pagina ververst elke 10 seconden.

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
| `GET /api/overview` | Totalen (blokken, kills, doden, speeltijd), top-blokken, top-mobs, doodsoorzaken en meest actieve spelers |
| `GET /api/players` | Alle spelers met hun totalen, speeltijd en laatst actief |
| `GET /api/players/{uuid}?days=14` | Details van één speler, met activiteit per uur over de laatste N dagen en `places` (tijd per wereld, biome, voertuig en met wie, in ms), `health` (schade en genezing in levenspunten, eten) en `crafting` |
| `GET /api/heatmap[?player={uuid}]` | Gebroken blokken per chunk (wereld, chunk x/z, aantal, min/max y) |
| `GET /api/heatmap/positions[?player={uuid}&world={naam}]` | Doorgebrachte tijd per chunk (wereld, chunk x/z, tijd in ms), uit de positie-samples |
| `GET /api/stats[?player={uuid}&days=14]` | Sessies, blokken per uur, gevecht, doden met plek, items en geschatte afstand, voor één speler of de hele server |
| `GET /api/config` | Instellingen voor de frontend, bijvoorbeeld of de 3D-kaart beschikbaar is |

### Opbouw

- `trackers/`: elke tracker verzamelt één soort data. `TrackerManager` start ze, en in `config.yml` zet je ze aan of uit (zie hieronder).
- `storage/DataStore`: de interface voor alle opslag. `SqliteDataStore` is nu de enige implementatie. Een centrale opslag (MySQL of een API) wordt later een tweede implementatie, zonder dat trackers of het dashboard veranderen.
- `storage/GameEvent`: het ene datamodel voor alles wat er gebeurt. Alles komt in één tabel, `events`, met kolommen `type`, `subtype`, speler, wereld, x/y/z, `item`, `game_mode`, `value`, `meta` (JSON) en `created_at`. De mogelijke `type`-waarden en hun meta-velden staan in `storage/EventTypes`.
- Twee uitzonderingen met een eigen tabel: `sessions` (één rij per sessie, wordt bijgewerkt) en `position_samples` (veel rijen met steeds dezelfde vaste velden, zie `storage/PositionSample`).
- `storage/SqliteMigrations`: schemawijzigingen. Bij het opstarten werkt elke `data.db` zichzelf bij. Vóór een migratie op bestaande data maakt de plugin automatisch een backup (`data.db.backup-v<versie>`).
- `web/WebServer`: de ingebouwde webserver (JDK `HttpServer`, geen extra dependencies).
- `src/main/resources/web/`: de dashboard-frontend in pure HTML, CSS en JS, zonder externe libraries of CDN.

### Een tracker toevoegen

1. Voeg een constante toe aan `storage/EventTypes`, bijvoorbeeld `FISH = "fish"`.
2. Maak in `trackers/` een klasse die `EventTracker` uitbreidt, met een `id()` (bijvoorbeeld `fishing`) en `@EventHandler`-methodes. `BlockPlaceTracker` en `KillTracker` zijn korte voorbeelden.
   ```java
   @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
   public void onFish(PlayerFishEvent event) {
       if (event.getState() != PlayerFishEvent.State.CAUGHT_FISH) return;
       if (!(event.getCaught() instanceof Item caught)) return;
       record(GameEvent.of(EventTypes.FISH, event.getPlayer())
               .subtype(caught.getItemStack().getType())
               .build());
   }
   ```
   `GameEvent.of(type, player)` vult al in: speler, positie, wereld, gamemode, item in de hand en het tijdstip.
3. Registreer de tracker in `TrackerManager.TRACKERS`.
4. Zet een blok in `src/main/resources/config.yml` onder `trackers:`. Bestaande configs krijgen dat bij de volgende start vanzelf.

Een nieuwe tabel of kolom nodig? Voeg dan **onderaan** in `SqliteMigrations` een nieuwe migratie toe, met het volgende versienummer. Pas nooit een migratie aan die al gecommit is, want bij teamgenoten heeft die al gedraaid.

### Trackers aan- of uitzetten

In `run/plugins/SlopSlurperPlugin/config.yml`:
```yaml
trackers:
  block-break:
    enabled: false
```
Daarna herstart je de server. In de console zie je welke trackers aan staan: `Trackers aan: ...`.

## Afspraken

- Commit alleen in `plugin/` (en scripts of docs als dat nodig is).
- Wijzig `server-template/` alleen als het team een nieuwe basiswereld of andere serverconfig wil. Doe dat dan bewust in een aparte commit.
- `eula.txt` staat op `true`. Daarmee is de [Minecraft EULA](https://aka.ms/MinecraftEULA) geaccepteerd voor deze server.
