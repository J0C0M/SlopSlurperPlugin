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
| `-Bots` | `--bots` | Offline mode en alleen bereikbaar vanaf je eigen pc, zodat de testbots kunnen inloggen (zie [Testbots](#testbots)) |
| `-Memory 4G` | `MEMORY=4G ./start-server.sh` | Meer geheugen voor de server |

Als PowerShell het script blokkeert, start je het met `powershell -ExecutionPolicy Bypass -File .\start-server.ps1`.

## Testbots

Wil je data verzamelen zonder zelf uren te spelen? In `bots/` staan bots die als echte spelers inloggen (met [Mineflayer](https://github.com/PrismarineJS/mineflayer)). De plugin ziet ze als gewone spelers, dus alle trackers vangen hun data op: sessies, AFK, gebroken en geplaatste blokken, kills, doden en posities.

Je hebt **Node.js 22** of nieuwer nodig ([nodejs.org](https://nodejs.org/)).

1. Start de server in botmodus:
   ```powershell
   .\start-server.ps1 -Bots
   ```
2. Start in een tweede venster de bots:
   ```powershell
   .\start-bots.ps1
   ```
   De eerste keer worden de afhankelijkheden geïnstalleerd. Stoppen doe je met Ctrl+C.

Mac/Linux: `./start-server.sh --bots` en `./start-bots.sh`.

**Hoeveel bots?** Gebruik er 4 of 5; met 5 is 20 minuten getest. Alle bots draaien in één Node-proces. Met 16 bots liep dat na een paar minuten vast met "heap out of memory" en kregen alle bots "Timed out". Daarna zijn de zichtafstand (5 chunks) en de rekentijd per route verkleind, maar meer dan 5 bots is sindsdien niet getest. Reken op 15 tot 25 minuten voordat de snelste bots ijzer hebben.

**Meekijken.** De bots hebben zelf geen beeld (headless), maar je kunt als speler meedoen: verbind in Minecraft met `localhost`. Typ in de serverconsole `gamemode spectator <jouw naam>` en `tp <jouw naam> Bot_1`.

**Wat de bots doen.** Elke bot werkt een doelenpad af, van lege handen tot ijzer: hout, houten en stenen gereedschap (ook een schep), oven, vlees jagen en bakken, kolen, fakkels, ijzer mijnen en smelten, en daarna ijzeren gereedschap en armor. Tussendoor doen ze ook andere dingen: rondlopen, mobs aanvallen, vrienden opzoeken, chatten en stilstaan (soms lang genoeg om AFK te worden). Ze leren niet: het pad staat vast in de code.

| Speelstijl | Verschil |
|---|---|
| `miner` | werkt het meest aan zijn doelen; eerst de pickaxe, dan armor |
| `builder` | verzamelt eerst 64 cobblestone |
| `fighter` | eerst zwaard, schild en armor; vecht veel |
| `explorer` | loopt veel rond |
| `lazy` | staat vaak stil en stopt na pickaxe en zwaard |

Het volgende doel volgt uit wat een bot bij zich heeft. Na uitloggen gaat hij dus verder waar hij was. Gaat hij dood, dan probeert hij één keer zijn spullen op te halen; lukt dat niet, dan begint hij bij een eerdere stap. Wie nog geen armor heeft, werkt 's nachts ondergronds of schuilt in een gat. Erts mijnen ze alleen als het aan lucht grenst, dus niet dwars door steen heen gezien. Mijlpalen staan in de log en in `bots/state/`.

**Grind en zand.** Bots graven liever niet onder grind of zand door. Moet het toch, dan blijven ze staan tot alles is nagevallen en weggehakt. Komt hun hoofd toch in een blok, dan hakken ze zich eerst vrij.

**Samen spelen.** Elke bot heeft twee vrienden (de bots naast hem: `Bot_2` is bevriend met `Bot_1` en `Bot_3`). Bots zoeken elkaar op als ze in de buurt en op ongeveer dezelfde hoogte zijn, nodigen elkaar uit en blijven dan een paar minuten bij elkaar: achter elkaar aan lopen, samen minen en samen mobs aanvallen. Dat zie je op het dashboard terug bij "met wie speelt iemand". Omdat ze vaak ondergronds zitten, gebeurt dit nog weinig.

**Speelschema's (`-Schedule`).** Standaard spelen alle bots meteen, wat handig is om te testen. Met `-Schedule` heeft elke bot een eigen ritme en speelt hij alleen op zijn eigen tijden:

| Schema | Wanneer |
|---|---|
| avondspeler | doordeweeks ±19:00–23:00, in het weekend 's middags en 's avonds |
| scholier | doordeweeks na school en een stukje 's avonds, in het weekend overdag |
| nachtbraker | ±21:00 tot 02:00 of later |
| casual speler | korte sessies verspreid over de dag, niet elke dag |
| weekendspeler | vooral zaterdag en zondag, lange sessies |

Begin- en eindtijden schuiven per dag een beetje, en niet elke dag wordt er gespeeld. Bij het starten zie je per bot wanneer hij begint. Zo krijg je realistische activiteit per uur en per dag, maar dan moeten de bots wel lang (dagen) draaien.

**Lopen en vastzitten.** Bots kiezen eerst een route waarbij ze niet graven of bouwen. Alleen als die er niet is, hakken ze door een heuvel of bouwen ze een opstapje. Dat lijkt meer op een echte speler en houdt de data schoon: blokken die alleen voor de route gebroken of geplaatst worden, komen anders ook in je trackers. Zit een bot toch vast, dan springt hij een andere kant op. Blijft hij op dezelfde plek vastzitten, dan logt hij uit en na een paar seconden weer in, en maakt hij zijn sessie af. Dat geeft een extra sessie in de data.

Door afronding bij botsingen liep Mineflayer soms een blok in, waarna Paper de bot elke tick terugzette. Twee dingen lossen dat samen op: een fractie bredere hitbox (`playerHalfWidth` in `bots.js`) en een kleine marge in de botsingsberekening (`patches/prismarine-physics`). Haal geen van beide weg: dan lopen bots voortdurend vast.

**Eigen huis (`-Homes`, experimenteel).** Elke bot kiest een vlakke plek, bouwt daar stap voor stap een huisje met werkbank en kist en keert er steeds naar terug om buit op te bergen. Bots breken elkaars huizen niet af. De plek wordt bewaard in `bots/state/`. Is er geen hout te bereiken, dan bouwt hij met aarde. Dit staat standaard uit, omdat het nog weinig getest is. Na `-Reset` gooi je ook `bots/state/` weg, anders gebruiken ze plekken uit de oude wereld.

Opties:

| PowerShell | Bash | Effect |
|---|---|---|
| `-Count 5` | `--count 5` | Aantal bots (standaard 4; zie "Hoeveel bots?"). Ze heten `Bot_1`, `Bot_2`, enzovoort |
| `-Pvp` | `--pvp` | Bots vallen elkaar soms aan (nooit echte spelers, en nooit hun vrienden) |
| `-Schedule` | `--schedule` | Bots spelen alleen op hun eigen speeltijden (zie hierboven) |
| `-Homes` | `--homes` | Experimenteel: bots bouwen een eigen huis |
| `--session-min 10 --session-max 40` | idem | Minuten online per sessie (zonder `-Schedule`) |
| `--offline-min 1 --offline-max 10` | idem | Minuten offline tussen sessies (zonder `-Schedule`) |
| `--prefix Test` | idem | Andere naam voor de bots (`Test_1`, ...) |
| `--host` / `--port` | idem | Andere server (standaard `localhost:25565`) |
| `--only social` | idem | Testhulp: bots doen alleen deze activiteit (`progress`, `mine`, `build`, `fight`, `explore`, `idle`, `chat`, `social`, `home`) |

Wil je zien wat een bot precies doet, zet dan eerst `$env:BOTS_DEBUG=1` (Bash: `BOTS_DEBUG=1 ./start-bots.sh`).

**Rapport.** Stop je de bots met Ctrl+C, dan zie je per bot wat hij gedaan heeft: nieuwe mijlpalen (met de tijd online tot dan), afstand, blokken, kills, doden met oorzaak, en hoe vaak hij vastzat of opnieuw moest inloggen. Ook zie je plekken waar hij hetzelfde blok minstens drie keer plaatste en weer brak, want dat vervuilt de data. Het rapport staat daarna in `bots/reports/`. Elke 5 minuten wordt een tussenstand opgeslagen, zodat je na een crash ook iets hebt. De cijfers komen van de bots zelf en kunnen iets afwijken van het dashboard.

**Aan de bots werken.**

| Bestand | Wat |
|---|---|
| `bots/bots.js` | De bots zelf: speelstijlen, activiteiten, samen spelen, huizen, lopen en losmaken |
| `bots/progress.js` | Het doelenpad: verzamelen, maken, smelten, mijnen, eten en overleven |
| `bots/schedule.js` | De speelschema's en hun tijden |
| `bots/report.js` | Het rapport per run |
| `bots/patches/` | Patches op `mineflayer-pathfinder` (van Mindcraft) en `prismarine-physics` (eigen fix). Die worden bij elke `npm ci` automatisch toegepast (via `patch-package`) |
| `bots/state/` | Per bot zijn mijlpalen, mijningang en huis (niet in git) |
| `bots/reports/` | Rapporten van eerdere runs (niet in git) |

De pathfinder-patch komt uit [Mindcraft](https://github.com/mindcraft-bots/mindcraft) (MIT-licentie). Ook het idee om eerst een route zonder graven en bouwen te zoeken, en opnieuw in te loggen als laatste redmiddel, komt daarvandaan. De patch:
- repareert het neerzetten van opstapjes: de pathfinder bleef soms in "bouwen" hangen, of hield springen ingedrukt;
- laat de bot pas doorlopen als hij dichter bij het midden van een blok staat, zodat hij minder hoekjes afsnijdt;
- laat bots deuren, hekken en luiken openen, en langs ranken klimmen.

Werk je een van die pakketten bij naar een nieuwe versie? Kijk dan of de patch nog nodig is en nog past. Een patch die niet meer past, laat `npm ci` mislukken.

**Let op:**
- In botmodus staat de server in **offline mode**: iedereen kan inloggen met elke naam, ook die van een op. Daarom luistert de server dan alleen op `127.0.0.1`, zodat alleen jouw eigen pc erop kan. Start je later weer zonder `-Bots`, dan zet het script online mode vanzelf terug.
- Log je in botmodus zelf in, dan krijg je een andere UUID dan normaal. Je bent dan voor de plugin (en voor je inventory in de wereld) een andere speler.
- Botdata komt in dezelfde `data.db` als echte data, maar het dashboard houdt ze uit elkaar. Het toont standaard alleen **echte spelers**; kies bovenaan **Bots** om te zien wat de bots doen, of **Iedereen** voor alles samen.
- Het verschil zit in de UUID: zonder Minecraft-account (offline mode) is die versie 3, met account versie 4. Daardoor werkt het ook voor oude data en met een andere `--prefix`. Log je zelf in botmodus in, dan tel je dus als bot. Op een server die altijd in offline mode draait, telt iedereen als bot.
- De bots hakken en bouwen in je eigen wereld in `run/`. Is die je dierbaar, maak dan eerst een kopie.

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
| `positions` | Elke paar seconden per speler: wereld, positie, biome, ondergronds of niet, voertuig (boot, paard, minecart, elytra) en welke spelers in de buurt zijn. Eigen tabel `position_samples`. | `sample-seconds` (10), `nearby-radius` (32) |

**Over AFK:** iemand is AFK na `afk-timeout-seconds` zonder echte input. Als input telt: rondkijken, zelf lopen, springen, klikken, interacties, inventory, chat, commando's, sneaken, sprinten en van hotbar-slot wisselen. Meegevoerd worden door water, een minecart of een boot telt niet, dus AFK-pools werken niet om speeltijd te faken. De AFK-tijd telt terug vanaf de laatste input: wie 3 minuten stilstaat, heeft 3 minuten AFK.

**Bij een crash:** lopende sessies worden elke `checkpoint-seconds` tussentijds opgeslagen. Na een crash sluit de plugin ze bij de volgende start af op dat laatste moment, met als reden `SERVER_CRASH`.

**Over posities:** `positions` legt elke `sample-seconds` vast waar iedere online speler is. Elke rij telt als `sample-seconds` speeltijd, dus de som geeft "tijd in biome X" of "tijd met speler Y". "Ondergronds" betekent: geen daglicht en een blok boven je hoofd. Een huis zonder ramen telt dus ook mee. In de Nether en de End is dit leeg. Bij 10 seconden zijn dat 360 rijen per speler per uur.

- **In-game:** `/blockstats` toont hoeveel blokken je gebroken en geplaatst hebt, en je top 10. `/blockstats <speler>` doet dat voor een ander (alleen voor op).
- **Dashboard:** zodra de server draait, open je **http://localhost:8080/**.
  - **Overzicht:** alle spelers met speeltijd, gebroken en geplaatste blokken, kills en doden, plus de meest gebroken en geplaatste blokken, de meest gedode mobs en de doodsoorzaken.
  - **Per speler:** verdeeld over de tabbladen Activiteit, Blokken, Gevecht, Items en Locaties: speeltijd en AFK, de laatste sessies, activiteit per dag en per uur, blokken, gereedschap, gedode mobs en spelers, doodsoorzaken, schade, genezing, eten, crafting, smelten, enchanten, aambeeld, brouwen, en uit de posities: tijd per wereld en biome, ondergronds of bovengronds, tijd in voertuigen en met wie de speler het meest speelt.
  - **Heatmap:** waar spelers hun tijd doorbrengen, per wereld en voor iedereen of één speler. Je kunt zoomen (scrollen of knoppen) en slepen.
  - **Toon:** bovenaan kies je echte spelers (standaard), bots of iedereen (zie [Testbots](#testbots)). Je browser onthoudt de keuze.
  - De pagina ververst elke 10 seconden.

Het dashboard is standaard alleen bereikbaar vanaf je eigen pc. De poort en het adres stel je in via `run/plugins/SlopSlurperPlugin/config.yml`.

### 3D-kaart (BlueMap)

Op de dashboardpagina **3D-kaart** zie je de wereld in 3D, met een heatmap van waar blokken gebroken zijn. Elke chunk is een gekleurde kolom, van blauw (weinig) naar rood (veel). De kaart komt van [BlueMap](https://bluemap.bluecolored.de/).

- Het startscript downloadt **BlueMap 5.16** eenmalig naar `run/plugins/`. Dat is de laatste versie die 1.21.11 ondersteunt. De download wordt gecontroleerd met een checksum.
- **Eenmalig zelf doen:** BlueMap moet de textures van Minecraft downloaden. Daarvoor moet je zelf akkoord gaan met de [Minecraft EULA](https://aka.ms/MinecraftEULA):
  1. Start de server één keer. BlueMap maakt dan zijn configuratie aan.
  2. Zet in `run/plugins/BlueMap/core.conf` `accept-download: false` op `true` en sla het bestand op.
  3. Start de server opnieuw. BlueMap rendert de wereld, wat de eerste keer even duurt.
- De losse kaart draait op http://localhost:8100/. De heatmap wordt elke minuut bijgewerkt. In BlueMap zet je hem aan of uit via het lagen-menu ("SlopSlurper: gebroken blokken"). Bots hebben een eigen laag, die standaard uit staat.
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
| `GET /api/config` | Instellingen voor de frontend, bijvoorbeeld of de 3D-kaart beschikbaar is |

`overview`, `players` en beide heatmaps accepteren `players=real` (alleen echte spelers), `players=bots` of `players=all` (standaard). Elke speler heeft een veld `bot`.

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
