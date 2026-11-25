// SlopSlurper dashboard: haalt data op uit /api/... en tekent alles zonder externe libraries.
(() => {
    "use strict";

    const REFRESH_MS = 10_000;
    const DAYS = 14;
    const app = document.getElementById("app");
    const status = document.getElementById("status");
    const filter = document.getElementById("filter");
    const nf = new Intl.NumberFormat("nl-NL");

    // ---------- Hulpfuncties ----------

    /** Maakt een element; tekst gaat altijd via textContent (geen HTML-injectie). */
    function h(tag, attrs = {}, ...children) {
        const el = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (value == null || value === false) continue;
            if (key === "class") el.className = value;
            else if (key === "style") el.style.cssText = value;
            else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
            else el.setAttribute(key, value);
        }
        for (const child of children.flat()) {
            if (child == null || child === false) continue;
            el.append(child instanceof Node ? child : document.createTextNode(String(child)));
        }
        return el;
    }

    async function api(path) {
        const res = await fetch(path, { cache: "no-store" });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    const FILTER_KEY = "slopslurper-players";
    try { // keuze van de vorige keer; zonder opslag gewoon echte spelers
        const saved = localStorage.getItem(FILTER_KEY);
        if ([...filter.options].some(o => o.value === saved)) filter.value = saved;
    } catch { /* geen opslag beschikbaar */ }

    /** API-pad voor de spelers die bovenaan gekozen zijn. */
    const filtered = path => `${path}?players=${filter.value}`;

    const inFilter = p => filter.value === "all" || p.bot === (filter.value === "bots");

    /** STONE_BRICKS -> "Stone bricks" */
    function pretty(name) {
        if (!name) return "";
        if (name === "HAND") return "Hand";
        const s = name.toLowerCase().replace(/_/g, " ");
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function prettyWorld(name) {
        return { world: "Overworld", world_nether: "Nether", world_the_end: "The End" }[name] ?? name;
    }

    function timeAgo(ms) {
        if (!ms) return "–";
        const sec = Math.round((Date.now() - ms) / 1000);
        if (sec < 60) return "zojuist";
        const min = Math.round(sec / 60);
        if (min < 60) return `${min} min geleden`;
        const hours = Math.round(min / 60);
        if (hours < 24) return `${hours} uur geleden`;
        const days = Math.round(hours / 24);
        return days === 1 ? "gisteren" : `${days} dagen geleden`;
    }

    function avatar(name, large = false) {
        return h("span", { class: large ? "avatar large" : "avatar", "aria-hidden": "true" },
            (name || "?").charAt(0).toUpperCase());
    }

    function kpi(label, value, sub) {
        return h("div", { class: "kpi" },
            h("div", { class: "kpi-label" }, label),
            h("div", { class: "kpi-value" }, value),
            sub ? h("div", { class: "kpi-sub" }, sub) : null);
    }

    /** 9_000_000 ms -> "2 u 30 m" */
    function duration(ms) {
        if (!ms || ms < 60_000) return ms > 0 ? "< 1 m" : "0 m";
        const totalMin = Math.round(ms / 60_000);
        const hours = Math.floor(totalMin / 60);
        const min = totalMin % 60;
        return hours ? `${hours} u ${min} m` : `${min} m`;
    }

    function afkShare(afkMs, totalMs) {
        if (!totalMs) return null;
        return `${Math.round((afkMs / totalMs) * 100)}% AFK`;
    }

    const dateTimeFmt = new Intl.DateTimeFormat("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

    function endReason(reason) {
        if (!reason) return "Speelt nog";
        return {
            DISCONNECTED: "Uitgelogd",
            KICKED: "Gekickt",
            TIMED_OUT: "Verbinding verloren",
            ERRONEOUS_STATE: "Fout",
            SERVER_CRASH: "Server gecrasht",
            PLUGIN_STOP: "Server gestopt",
            REPLACED: "Opnieuw ingelogd",
        }[reason] ?? pretty(reason);
    }

    function card(title, content, wide = false) {
        return h("section", { class: wide ? "card wide" : "card" }, h("h2", {}, title), content);
    }

    function empty(title, text) {
        return h("div", { class: "empty" }, h("strong", {}, title), text);
    }

    /**
     * Horizontale balkenlijst, bv. top-blokken. valueFn bepaalt hoe het getal eruitziet
     * (standaard een aantal; geef `duration` mee voor tijden in ms).
     */
    function barList(entries, labelFn = pretty, valueFn = v => nf.format(v), emptyText = "Nog geen data.") {
        entries = (entries || []).filter(e => e.amount > 0);
        if (!entries.length) return h("p", { class: "muted" }, emptyText);
        const max = Math.max(...entries.map(e => e.amount));
        return h("div", { class: "bars" }, entries.map(e =>
            h("div", { class: "bar-row", title: `${labelFn(e.key)}: ${valueFn(e.amount)}` },
                h("span", { class: "bar-label" }, labelFn(e.key)),
                h("span", { class: "bar-track" },
                    h("span", { class: "bar-fill", style: `width:${(e.amount / max) * 100}%` })),
                h("span", { class: "bar-value" }, valueFn(e.amount)))));
    }

    const asIs = key => key;

    /** Levenspunten -> harten: 7 -> "3,5 ♥" */
    const hearts = points => `${nf.format(points / 2)} ♥`;

    function healReason(key) {
        return {
            SATIATED: "Volle hongerbalk",
            REGEN: "Vredige wereld",
            MAGIC: "Genezingsdrank",
            MAGIC_REGEN: "Regeneratie",
            EATING: "Eten",
            CUSTOM: "Anders",
        }[key] ?? pretty(key);
    }

    function anvilOperation(key) {
        return {
            RENAME: "Hernoemd",
            REPAIR: "Gerepareerd",
            COMBINE: "Gecombineerd",
            ENCHANT: "Enchantment uit boek",
        }[key] ?? pretty(key);
    }

    /** 0.25 -> "25%" */
    function percent(part, total) {
        return total ? `${Math.round((part / total) * 100)}%` : "–";
    }

    /** Subtype van een death-event: dader (ZOMBIE, PLAYER) of schadetype (FALL, LAVA). */
    function deathCause(key) {
        return {
            PLAYER: "Andere speler",
            FALL: "Vallen",
            LAVA: "Lava",
            DROWN: "Verdronken",
            IN_FIRE: "Vuur",
            ON_FIRE: "Verbrand",
            CAMPFIRE: "Kampvuur",
            HOT_FLOOR: "Magmablok",
            STARVE: "Verhongerd",
            OUT_OF_WORLD: "Uit de wereld gevallen",
            IN_WALL: "Gestikt in een blok",
            CRAMMING: "Platgedrukt",
            CACTUS: "Cactus",
            SWEET_BERRY_BUSH: "Bessenstruik",
            EXPLOSION: "Explosie",
            BAD_RESPAWN_POINT: "Ontploft bed of respawn anchor",
            LIGHTNING_BOLT: "Bliksem",
            MAGIC: "Magie",
            WITHER: "Wither-effect",
            FREEZE: "Bevroren",
            FLY_INTO_WALL: "Tegen een muur gevlogen",
            FALLING_BLOCK: "Vallend blok",
            FALLING_ANVIL: "Vallend aambeeld",
            FALLING_STALACTITE: "Vallende stalactiet",
            STALAGMITE: "Stalagmiet",
            DRY_OUT: "Uitgedroogd",
            GENERIC_KILL: "/kill",
            GENERIC: "Onbekend",
        }[key] ?? pretty(key);
    }

    /** Kolomgrafiek. points: [{label, value, title}]. Toont elk n-de label. */
    function columnChart(points, labelEvery = 1) {
        const max = Math.max(1, ...points.map(p => p.value));
        return h("div", {},
            h("div", { class: "columns", role: "img", "aria-label": points.map(p => p.title).join(", ") },
                points.map(p => h("div", { class: "column", title: p.title },
                    h("div", { class: "column-fill", style: `height:${(p.value / max) * 100}%` })))),
            h("div", { class: "column-labels", "aria-hidden": "true" },
                points.map((p, i) => h("span", {}, i % labelEvery === 0 ? p.label : ""))));
    }

    // ---------- Activiteit (uur-buckets uit de API) ----------

    function perDay(activity, days) {
        const counts = new Map();
        for (const b of activity) {
            const d = new Date(b.hourStart);
            const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
            counts.set(key, (counts.get(key) ?? 0) + b.count);
        }
        const points = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dayFmt = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" });
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            const value = counts.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) ?? 0;
            const label = dayFmt.format(d);
            points.push({ label, value, title: `${label}: ${nf.format(value)} blokken` });
        }
        return points;
    }

    function perHourOfDay(activity) {
        const counts = new Array(24).fill(0);
        for (const b of activity) counts[new Date(b.hourStart).getHours()] += b.count;
        return counts.map((value, hour) => ({
            label: String(hour).padStart(2, "0"),
            value,
            title: `${String(hour).padStart(2, "0")}:00–${String(hour + 1).padStart(2, "0")}:00: ${nf.format(value)} blokken`,
        }));
    }

    // ---------- Pagina's ----------

    async function renderOverview() {
        const [overview, players] = await Promise.all([api(filtered("/api/overview")), api(filtered("/api/players"))]);

        if (!overview || overview.playerCount === 0) {
            return [
                h("h1", {}, "Overzicht"),
                h("p", { class: "subtitle" }, "Wat spelers op deze server doen."),
                h("div", { class: "card" }, empty("Nog geen data",
                    filter.value === "bots" ? "Er hebben nog geen bots gespeeld (zie Testbots in de README)."
                        : "Join de server en breek een paar blokken. Dit dashboard ververst vanzelf. "
                            + (filter.value === "real" ? "Data van bots zie je door bovenaan Bots te kiezen." : ""))),
            ];
        }

        const top = overview.topBlocks[0];
        const topCause = overview.topDeathCauses[0];
        const table = h("table", {},
            h("thead", {}, h("tr", {},
                h("th", {}, "Speler"),
                h("th", { class: "num" }, "Speeltijd"),
                h("th", { class: "num" }, "Gebroken"),
                h("th", { class: "num" }, "Geplaatst"),
                h("th", { class: "num" }, "Kills"),
                h("th", { class: "num" }, "Doden"),
                h("th", { class: "num" }, "Laatst actief"))),
            h("tbody", {}, players.map(p =>
                h("tr", { onclick: () => { location.hash = `#/speler/${p.uuid}`; } },
                    h("td", {}, h("a", { href: `#/speler/${p.uuid}`, class: "player-cell" }, avatar(p.name), p.name,
                        p.bot ? h("span", { class: "muted" }, "(bot)") : null)),
                    h("td", { class: "num", title: afkShare(p.afkMs, p.playtimeMs) ?? "" }, duration(p.playtimeMs)),
                    h("td", { class: "num" }, nf.format(p.totalBreaks)),
                    h("td", { class: "num" }, nf.format(p.totalPlaced)),
                    h("td", { class: "num", title: `${nf.format(p.mobKills)} mobs, ${nf.format(p.pvpKills)} spelers` },
                        nf.format(p.mobKills + p.pvpKills)),
                    h("td", { class: "num" }, nf.format(p.deaths)),
                    h("td", { class: "num" }, timeAgo(p.lastActive))))));

        return [
            h("h1", {}, "Overzicht"),
            h("p", { class: "subtitle" }, "Wat spelers op deze server doen."),
            h("div", { class: "kpis" },
                kpi("Speeltijd (totaal)", duration(overview.playtimeMs), afkShare(overview.afkMs, overview.playtimeMs)),
                kpi("Blokken gebroken", nf.format(overview.totalBreaks), `${nf.format(overview.totalPlaced)} geplaatst`),
                kpi("Mobs gedood", nf.format(overview.mobKills),
                    overview.pvpKills ? `en ${nf.format(overview.pvpKills)} spelers` : null),
                kpi("Doodgegaan", nf.format(overview.deaths), topCause ? `meestal: ${deathCause(topCause.key)}` : null),
                kpi("Spelers", nf.format(overview.playerCount)),
                kpi("Meest gebroken blok", top ? pretty(top.key) : "–")),
            h("div", { class: "grid" },
                card("Spelers", h("div", { class: "table-wrap" }, table), true),
                card("Meest gebroken blokken", barList(overview.topBlocks)),
                card("Meest geplaatste blokken", barList(overview.topPlaced)),
                card("Meest gedode mobs", barList(overview.topMobs)),
                card("Doodsoorzaken", barList(overview.topDeathCauses, deathCause))),
        ];
    }

    function sessionTable(sessions) {
        if (!sessions.length) return h("p", { class: "muted" }, "Nog geen sessies.");
        return h("div", { class: "table-wrap" }, h("table", { class: "static" },
            h("thead", {}, h("tr", {},
                h("th", {}, "Begonnen"),
                h("th", { class: "num" }, "Duur"),
                h("th", { class: "num" }, "AFK"),
                h("th", {}, "Einde"))),
            h("tbody", {}, sessions.map(s =>
                h("tr", {},
                    h("td", {}, dateTimeFmt.format(new Date(s.startedAt))),
                    h("td", { class: "num" }, duration(s.durationMs)),
                    h("td", { class: "num" }, duration(s.afkMs)),
                    h("td", {}, s.endedAt == null ? h("span", { class: "live" }, "● Speelt nog") : endReason(s.endReason)))))));
    }

    /** Laatst opgehaalde speler, zodat wisselen van tabblad niet op de server hoeft te wachten. */
    let cachedPlayer = { uuid: null, detail: null };

    /** Tabbladen van de spelerspagina. Elk geeft blokken {title, content, wide?, empty?} terug. */
    const PLAYER_TABS = [
        { id: "activiteit", label: "Activiteit", blocks: activityBlocks },
        { id: "blokken", label: "Blokken", blocks: blockBlocks },
        { id: "gevecht", label: "Gevecht", blocks: combatBlocks },
        { id: "items", label: "Items", blocks: itemBlocks },
        { id: "locaties", label: "Locaties", blocks: placeBlocks },
    ];

    async function renderPlayer(uuid, tabId, useCache) {
        if (!useCache || cachedPlayer.uuid !== uuid) {
            cachedPlayer = { uuid, detail: await api(`/api/players/${encodeURIComponent(uuid)}?days=${DAYS}`) };
        }
        const detail = cachedPlayer.detail;
        const back = h("a", { href: "#/", class: "back" }, "← Overzicht");

        if (!detail) {
            return [back, h("div", { class: "card" }, empty("Speler niet gevonden",
                "Er is (nog) geen data voor deze speler."))];
        }

        const p = detail.player;
        const topCause = detail.deathCauses[0];
        const active = PLAYER_TABS.find(t => t.id === tabId) ?? PLAYER_TABS[0];

        return [
            back,
            h("div", { class: "player-head" },
                avatar(p.name, true),
                h("div", {}, h("h1", {}, p.name), h("p", {}, `Laatst actief ${timeAgo(p.lastActive)}`))),
            h("div", { class: "kpis" },
                kpi("Speeltijd", duration(p.playtimeMs), afkShare(p.afkMs, p.playtimeMs)),
                kpi("Sessies", nf.format(p.sessions),
                    p.sessions ? `gem. ${duration(p.playtimeMs / p.sessions)}` : null),
                kpi("Blokken gebroken", nf.format(p.totalBreaks), `${nf.format(p.totalPlaced)} geplaatst`),
                kpi("Mobs gedood", nf.format(p.mobKills), p.pvpKills ? `en ${nf.format(p.pvpKills)} spelers` : null),
                kpi("Doodgegaan", nf.format(p.deaths), topCause ? `meestal: ${deathCause(topCause.key)}` : null)),
            h("nav", { class: "tabs", "aria-label": "Gegevens van deze speler" }, PLAYER_TABS.map(t =>
                h("a", {
                    href: `#/speler/${uuid}/${t.id}`,
                    class: t === active ? "active" : null,
                    "aria-current": t === active ? "page" : null,
                    "data-tab": t.id,
                }, t.label))),
            ...blockGrid(active.blocks(detail)),
        ];
    }

    /** Balkenlijst als blok; zonder data komt alleen de titel onderaan te staan. */
    function bars(title, entries, labelFn, valueFn) {
        return { title, content: barList(entries, labelFn, valueFn), empty: !(entries || []).some(e => e.amount > 0) };
    }

    /** Kaarten met data, en de lege categorieën samen op één regel. */
    function blockGrid(blocks) {
        const filled = blocks.filter(b => !b.empty);
        const none = blocks.filter(b => b.empty).map(b => b.title);
        return [
            filled.length ? h("div", { class: "grid" }, filled.map(b => card(b.title, b.content, b.wide))) : null,
            none.length ? h("p", { class: "hint" }, `Nog geen data: ${none.join(", ")}.`) : null,
        ].filter(Boolean);
    }

    function activityBlocks(d) {
        return [
            { title: `Blokken per dag (laatste ${DAYS} dagen)`, content: columnChart(perDay(d.activity, DAYS), 2) },
            { title: "Wanneer speelt deze speler?", content: columnChart(perHourOfDay(d.activity), 3) },
            { title: "Laatste sessies", content: sessionTable(d.sessions || []), wide: true },
        ];
    }

    function blockBlocks(d) {
        return [
            bars("Meest gebroken blokken", d.topBlocks),
            bars("Meest geplaatste blokken", d.topPlaced),
            bars("Gereedschap", d.tools),
            bars("Gebroken per wereld", d.worlds, prettyWorld),
        ];
    }

    function combatBlocks(d) {
        return [
            bars("Gedode mobs", d.mobKills),
            bars("Gedode spelers", d.pvpVictims, asIs),
            bars("Doodsoorzaken", d.deathCauses, deathCause),
            bars("Schade uitgedeeld", d.health.damageDealt, pretty, hearts),
            bars("Schade gekregen", d.health.damageTaken, deathCause, hearts),
            bars("Genezing", d.health.healed, healReason, hearts),
        ];
    }

    function itemBlocks(d) {
        return [
            bars("Gecraft", d.crafting.crafted),
            bars("Gesmolten", d.crafting.smelted),
            bars("Gegeten", d.health.food),
            bars("Gevangen bij het vissen", d.catches),
            bars("Geënchant", d.crafting.enchanted),
            bars("Aambeeld", d.crafting.anvil, anvilOperation),
            bars("Gebrouwen", d.crafting.brewed),
        ];
    }

    /** Uit de positie-samples: werelden, biomen, ondergronds, voertuigen en met wie. */
    function placeBlocks({ player, places }) {
        if (!places || !places.sampledMs) {
            return [{ title: "Waar speelt deze speler?", wide: true, content: h("p", { class: "muted" },
                "Nog geen positie-data. Zolang de speler online is, wordt elke paar seconden vastgelegd waar hij is.") }];
        }
        const depth = [
            { key: "Ondergronds of binnen", amount: places.undergroundMs },
            { key: "Bovengronds", amount: places.surfaceMs },
        ];
        const companions = bars("Speelt het meest met", places.companions, asIs, duration);
        companions.content = h("div", {},
            h("p", { class: "muted" },
                `${percent(places.withOthersMs, places.sampledMs)} van de tijd met andere spelers in de buurt.`),
            companions.content);
        return [
            bars("Tijd per wereld", places.worlds, prettyWorld, duration),
            bars("Biomen", places.biomes, pretty, duration),
            bars("Ondergronds of bovengronds", depth, asIs, duration),
            bars("Onderweg", places.vehicles, pretty, duration),
            companions,
            { title: "Op de kaart", content: h("a", { href: `#/heatmap/world/${player.uuid}` }, "Bekijk de heatmap van deze speler →") },
        ];
    }

    // ---------- Heatmap: waar spelers hun tijd doorbrengen ----------

    const HEAT_ROUTE = /^#\/heatmap(?:\/([^/]+))?(?:\/([0-9a-fA-F-]{36}))?$/;
    const HEAT_STOPS = [[0, 80, 255], [0, 220, 120], [255, 230, 0], [255, 40, 20]]; // zelfde als op de 3D-kaart
    const CHUNK = 16;

    /** Ververst de getoonde heatmap zonder zoom, positie of keuzes kwijt te raken. */
    let refreshHeatmap = null;

    function heatColor(t) {
        const scaled = Math.max(0, Math.min(1, t)) * (HEAT_STOPS.length - 1);
        const i = Math.min(Math.floor(scaled), HEAT_STOPS.length - 2);
        const c = HEAT_STOPS[i].map((v, k) => Math.round(v + (HEAT_STOPS[i + 1][k] - v) * (scaled - i)));
        return `rgb(${c.join(",")})`;
    }

    /** Korte tijden zijn hier normaal, dus preciezer dan duration(): 40_000 -> "40 s" */
    const shortTime = ms => ms < 60_000 ? `${Math.round(ms / 1000)} s` : duration(ms);

    const chunkLabel = c => `x ${c.chunkX * CHUNK}, z ${c.chunkZ * CHUNK}`;

    async function renderHeatmap(worldParam, playerParam) {
        let world = worldParam ? decodeURIComponent(worldParam) : "world";
        let player = playerParam ?? "";
        let cells = []; // alle werelden van de gekozen speler
        let shown = [];
        let view = null; // midden (in blokken) en scale (pixels per blok)
        let drag = null;

        const worldSelect = h("select", { onchange: () => { world = worldSelect.value; choose(); } });
        const playerSelect = h("select", { onchange: () => { player = playerSelect.value; choose(); } });
        const canvas = h("canvas", { class: "heat-canvas", role: "img" });
        const tip = h("div", { class: "heat-tip", hidden: "" });
        const none = h("div", { class: "heat-none", hidden: "" }, "Nog geen posities voor deze keuze.");
        const top = h("div");
        const ctx = canvas.getContext("2d");
        const zoomButton = (label, text, action) =>
            h("button", { type: "button", "aria-label": label, title: label, onclick: action }, text);

        function choose() {
            history.replaceState(null, "", `#/heatmap/${encodeURIComponent(world)}${player ? "/" + player : ""}`);
            view = null;
            load().catch(showOffline);
        }

        function showOffline() {
            status.textContent = "Server niet bereikbaar";
            status.classList.add("error");
        }

        function fillSelect(select, options, value) {
            select.replaceChildren(...options.map(([v, label]) => h("option", { value: v }, label)));
            select.value = value;
        }

        async function load() {
            const forPlayer = player, forFilter = filter.value;
            const [players, data] = await Promise.all([api("/api/players"),
                api(player ? `/api/heatmap/positions?player=${player}` : filtered("/api/heatmap/positions"))]);
            if (forPlayer !== player || forFilter !== filter.value) return; // inmiddels iets anders gekozen
            cells = data || [];
            const worlds = new Set(["world", "world_nether", "world_the_end", world, ...cells.map(c => c.world)]);
            if (document.activeElement !== worldSelect) fillSelect(worldSelect, [...worlds].map(w => [w, prettyWorld(w)]), world);
            if (document.activeElement !== playerSelect) {
                fillSelect(playerSelect, [["", "Alle getoonde spelers"],
                    ...(players || []).filter(p => inFilter(p) || p.uuid === player).map(p => [p.uuid, p.name])], player);
            }
            shown = cells.filter(c => c.world === world).sort((a, b) => a.timeMs - b.timeMs);
            none.hidden = shown.length > 0;
            const best = shown.slice(-10).reverse();
            top.replaceChildren(barList(best.map(c => ({ key: chunkLabel(c), amount: c.timeMs })), asIs, shortTime));
            canvas.setAttribute("aria-label", best.length
                ? `Heatmap van ${prettyWorld(world)}: ${shown.length} chunks bezocht, het langst bij ${chunkLabel(best[0])}.`
                : "Heatmap zonder data.");
            draw();
            status.textContent = `Bijgewerkt om ${new Date().toLocaleTimeString("nl-NL")}`;
            status.classList.remove("error");
        }

        /** Zoomt zo dat alle bezochte chunks passen, met wat ruimte eromheen. */
        function fit() {
            if (!shown.length) return { x: 0, z: 0, scale: 2 };
            const xs = shown.map(c => c.chunkX), zs = shown.map(c => c.chunkZ);
            const min = (a) => a.reduce((m, v) => Math.min(m, v)), max = (a) => a.reduce((m, v) => Math.max(m, v));
            const x0 = min(xs) * CHUNK, x1 = (max(xs) + 1) * CHUNK, z0 = min(zs) * CHUNK, z1 = (max(zs) + 1) * CHUNK;
            return {
                x: (x0 + x1) / 2, z: (z0 + z1) / 2,
                scale: Math.min(4, canvas.clientWidth / (x1 - x0 + 2 * CHUNK), canvas.clientHeight / (z1 - z0 + 2 * CHUNK)),
            };
        }

        const toScreen = (x, z) => [(x - view.x) * view.scale + canvas.clientWidth / 2, (z - view.z) * view.scale + canvas.clientHeight / 2];
        const toWorld = (px, py) => [(px - canvas.clientWidth / 2) / view.scale + view.x, (py - canvas.clientHeight / 2) / view.scale + view.z];

        function draw() {
            const width = canvas.clientWidth, height = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
            if (!width || !height) return; // nog niet op de pagina
            view ??= fit();
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const css = getComputedStyle(canvas);

            // Logaritmisch: anders zie je naast één drukke plek niks meer
            const max = Math.log1p((shown.at(-1)?.timeMs ?? 0) / 1000) || 1;
            const size = Math.max(CHUNK * view.scale, 2); // ver uitgezoomd nog steeds zichtbaar
            for (const c of shown) {
                const [px, py] = toScreen(c.chunkX * CHUNK, c.chunkZ * CHUNK);
                if (px + size < 0 || py + size < 0 || px > width || py > height) continue;
                ctx.fillStyle = heatColor(Math.log1p(c.timeMs / 1000) / max);
                ctx.fillRect(px, py, size, size);
            }

            // Rasterlijnen op een rond aantal blokken, minstens 80 px uit elkaar
            let step = CHUNK;
            while (step * view.scale < 80) step *= 2;
            ctx.font = `11px ${css.fontFamily}`;
            ctx.lineWidth = 1;
            const [left, upper] = toWorld(0, 0);
            const line = (zero, x1, y1, x2, y2) => {
                ctx.strokeStyle = css.getPropertyValue(zero ? "--muted" : "--border");
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            };
            const text = (label, x, y) => {
                ctx.lineWidth = 3;
                ctx.strokeStyle = css.getPropertyValue("--surface");
                ctx.strokeText(label, x, y);
                ctx.lineWidth = 1;
                ctx.fillStyle = css.getPropertyValue("--muted");
                ctx.fillText(label, x, y);
            };
            for (let x = Math.ceil(left / step) * step; toScreen(x, 0)[0] < width; x += step) {
                const px = Math.round(toScreen(x, 0)[0]) + .5;
                line(x === 0, px, 0, px, height);
                text(`x ${x}`, px + 4, 13);
            }
            for (let z = Math.ceil(upper / step) * step; toScreen(0, z)[1] < height; z += step) {
                const py = Math.round(toScreen(0, z)[1]) + .5;
                line(z === 0, 0, py, width, py);
                if (py > 30) text(`z ${z}`, 4, py - 4);
            }
        }

        function zoom(factor, px = canvas.clientWidth / 2, py = canvas.clientHeight / 2) {
            if (!view) return;
            const [x, z] = toWorld(px, py);
            view.scale = Math.max(0.005, Math.min(16, view.scale * factor));
            const [x2, z2] = toWorld(px, py);
            view.x += x - x2; // de plek onder de muis blijft staan
            view.z += z - z2;
            draw();
        }

        canvas.addEventListener("wheel", e => {
            e.preventDefault();
            zoom(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), e.offsetX, e.offsetY);
        }, { passive: false });
        canvas.addEventListener("pointerdown", e => {
            if (!view) return;
            drag = { px: e.clientX, py: e.clientY, x: view.x, z: view.z };
            canvas.setPointerCapture(e.pointerId);
        });
        canvas.addEventListener("pointermove", e => {
            if (!view) return;
            if (drag) {
                view.x = drag.x - (e.clientX - drag.px) / view.scale;
                view.z = drag.z - (e.clientY - drag.py) / view.scale;
                draw();
            }
            const [x, z] = toWorld(e.offsetX, e.offsetY);
            const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
            const cell = shown.find(c => c.chunkX === cx && c.chunkZ === cz);
            tip.hidden = !cell || !!drag;
            if (cell) {
                tip.textContent = `${chunkLabel(cell)} · ${shortTime(cell.timeMs)}`;
                tip.style.left = `${Math.min(e.offsetX + 14, canvas.clientWidth - 170)}px`;
                tip.style.top = `${Math.max(e.offsetY - 34, 4)}px`;
            }
        });
        for (const type of ["pointerup", "pointercancel"]) canvas.addEventListener(type, () => { drag = null; });
        canvas.addEventListener("pointerleave", () => { tip.hidden = true; });
        new ResizeObserver(draw).observe(canvas);

        await load();
        if (HEAT_ROUTE.test(location.hash)) refreshHeatmap = () => load().catch(showOffline); // niet als je al weg bent

        return [
            h("div", { class: "map-head" },
                h("div", {},
                    h("h1", {}, "Heatmap"),
                    h("p", { class: "subtitle" }, "Waar spelers hun tijd doorbrengen, per chunk (16×16 blokken). Noord is boven.")),
                h("div", { class: "legend" }, "kort", h("span", { class: "legend-bar", "aria-hidden": "true" }), "lang")),
            h("div", { class: "heat-controls" },
                h("label", {}, "Wereld ", worldSelect),
                h("label", {}, "Speler ", playerSelect),
                h("div", { class: "heat-zoom" },
                    zoomButton("Uitzoomen", "−", () => zoom(1 / 1.5)),
                    zoomButton("Inzoomen", "+", () => zoom(1.5)),
                    zoomButton("Alles tonen", "Alles tonen", () => { view = null; draw(); }))),
            h("div", { class: "heat-map" }, canvas, tip, none),
            h("div", { class: "grid" }, card("Drukste plekken", top, true)),
        ];
    }

    /** BlueMap-URL die opent boven het drukste gebied van de overworld (gewogen gemiddelde). */
    function blueMapStartUrl(baseUrl, cells) {
        const overworld = cells.filter(c => c.world === "world");
        const total = overworld.reduce((sum, c) => sum + c.count, 0);
        if (!total) return baseUrl;
        const x = Math.round(overworld.reduce((s, c) => s + (c.chunkX * 16 + 8) * c.count, 0) / total);
        const z = Math.round(overworld.reduce((s, c) => s + (c.chunkZ * 16 + 8) * c.count, 0) / total);
        // Formaat: #map:x:y:z:afstand:rotatie:hoek:tilt:ortho:modus
        return `${baseUrl.replace(/#.*$/, "")}#world:${x}:64:${z}:180:0.6:0.9:0:0:perspective`;
    }

    async function renderMap() {
        const [config, cells] = await Promise.all([api("/api/config"), api(filtered("/api/heatmap")).catch(() => [])]);
        const head = h("div", { class: "map-head" },
            h("div", {},
                h("h1", {}, "3D-kaart"),
                h("p", { class: "subtitle" }, "Waar spelers blokken breken, als kolommen op de wereld.")),
            h("div", { class: "legend" }, "weinig", h("span", { class: "legend-bar", "aria-hidden": "true" }), "veel"));

        if (!config || !config.blueMapEnabled) {
            return [h("div", { class: "map-page" }, head, h("div", { class: "card" }, empty("BlueMap staat niet aan",
                "Installeer de BlueMap-plugin (versie 5.16 voor 1.21.11) op de server om hier de 3D-kaart te zien.")))];
        }

        return [h("div", { class: "map-page" },
            head,
            h("iframe", { class: "map-frame", src: blueMapStartUrl(config.blueMapUrl, cells || []), title: "BlueMap 3D-kaart van de wereld", allowfullscreen: "" }),
            h("p", { class: "hint" },
                "Elke kolom is een chunk (16×16 blokken), van de laagste tot de hoogste plek waar gegraven is. ",
                "De heatmap wordt elke minuut bijgewerkt. Aan/uit via het lagen-menu in BlueMap (“SlopSlurper: gebroken blokken”; bots hebben een eigen laag die standaard uit staat). ",
                h("a", { href: config.blueMapUrl, target: "_blank", rel: "noopener" }, "Open de kaart los ↗"))),
        ];
    }

    // ---------- Router + verversen ----------

    let renderId = 0;
    const isMapRoute = () => location.hash === "#/kaart";

    function updateNav() {
        const active = isMapRoute() ? "map" : HEAT_ROUTE.test(location.hash) ? "heatmap" : "overview";
        document.querySelectorAll("[data-nav]").forEach(a => {
            a.classList.toggle("active", a.dataset.nav === active);
            if (a.dataset.nav === active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
        });
    }

    const PLAYER_ROUTE = /^#\/speler\/([0-9a-fA-F-]{36})(?:\/([a-z]+))?$/;

    async function render(useCache = false) {
        const id = ++renderId;
        updateNav();
        const match = location.hash.match(PLAYER_ROUTE);
        const heat = location.hash.match(HEAT_ROUTE);
        refreshHeatmap = null;
        try {
            const content = isMapRoute() ? await renderMap()
                : heat ? await renderHeatmap(heat[1], heat[2])
                : match ? await renderPlayer(match[1], match[2], useCache) : await renderOverview();
            if (id !== renderId) return; // inmiddels naar een andere pagina genavigeerd
            const focusedTab = document.activeElement?.dataset?.tab; // toetsenbordfocus niet kwijtraken
            app.replaceChildren(...content);
            if (focusedTab) app.querySelector(`[data-tab="${focusedTab}"]`)?.focus({ preventScroll: true });
            status.textContent = `Bijgewerkt om ${new Date().toLocaleTimeString("nl-NL")}`;
            status.classList.remove("error");
        } catch (err) {
            if (id !== renderId) return;
            status.textContent = "Server niet bereikbaar";
            status.classList.add("error");
            if (!app.hasChildNodes()) {
                app.replaceChildren(h("div", { class: "card" },
                    empty("Kan geen data ophalen", "Draait de Minecraft-server? Het dashboard probeert het zo opnieuw.")));
            }
        }
    }

    filter.addEventListener("change", () => {
        try {
            localStorage.setItem(FILTER_KEY, filter.value);
        } catch { /* geen opslag: keuze geldt alleen nu */ }
        const heat = location.hash.match(HEAT_ROUTE);
        if (heat?.[2]) history.replaceState(null, "", `#/heatmap/${heat[1]}`); // gekozen speler past misschien niet
        render();
    });

    window.addEventListener("hashchange", event => {
        const from = new URL(event.oldURL).hash.match(PLAYER_ROUTE);
        const to = location.hash.match(PLAYER_ROUTE);
        if (from && to && from[1] === to[1]) { // ander tabblad van dezelfde speler
            render(true);
            return;
        }
        app.replaceChildren();
        window.scrollTo(0, 0);
        render();
    });
    // De 3D-kaart niet automatisch verversen: dan zou het iframe steeds opnieuw laden
    setInterval(() => {
        if (document.hidden || isMapRoute()) return;
        if (refreshHeatmap) refreshHeatmap(); else render();
    }, REFRESH_MS);
    render();
})();
