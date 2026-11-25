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

    function movementType(key) {
        return { FOOT: "Te voet", CREATIVE: "Creative of spectator" }[key] ?? pretty(key);
    }

    function xpSource(key) {
        return {
            ENTITY_DEATH: "Mobs", BLOCK_BREAK: "Blokken breken", FURNACE: "Smelten", BREED: "Fokken",
            VILLAGER_TRADE: "Handelen", FISHING: "Vissen", EXP_BOTTLE: "XP-flesje",
            GRINDSTONE: "Slijpsteen", PLAYER_DEATH: "Teruggehaald na dood",
            UNKNOWN: "Onbekend", CUSTOM: "Anders",
        }[key] ?? pretty(key);
    }

    /** 3 dagen of meer in dagen, anders als duur */
    const longTime = ms => ms >= 3 * 86_400_000 ? `${Math.floor(ms / 86_400_000)} dagen` : duration(ms);

    function advancementTable(advancements, showPlayer) {
        return h("div", { class: "table-wrap" }, h("table", { class: "static" },
            h("thead", {}, h("tr", {},
                showPlayer ? h("th", {}, "Speler") : null,
                h("th", {}, "Advancement"), h("th", {}, "Behaald"),
                h("th", { class: "num" }, "Na eerste join"), h("th", { class: "num" }, "Na speeltijd"))),
            h("tbody", {}, advancements.map(a => h("tr", {},
                showPlayer ? h("td", {}, a.player ?? "–") : null,
                h("td", { title: a.key }, pretty(a.key.split("/").pop())), // story/mine_stone -> "Mine stone"
                h("td", {}, dateTimeFmt.format(new Date(a.time))),
                h("td", { class: "num" }, longTime(a.sinceJoinMs)),
                h("td", { class: "num" }, duration(a.playtimeMs)))))));
    }

    /** 1500 -> "1,5 km" (één blok is één meter) */
    const blockDistance = m => m < 1000 ? `${nf.format(m)} m` : `${nf.format(Math.round(m / 100) / 10)} km`;

    /** Laatste doden met de plek; op het serveroverzicht ook wie. */
    function deathTable(deaths, showPlayer) {
        return h("div", { class: "table-wrap" }, h("table", { class: "static" },
            h("thead", {}, h("tr", {},
                showPlayer ? h("th", {}, "Speler") : null,
                h("th", {}, "Oorzaak"), h("th", {}, "Wereld"), h("th", {}, "Plek (x, y, z)"), h("th", {}, "Wanneer"))),
            h("tbody", {}, deaths.map(d => h("tr", {},
                showPlayer ? h("td", {}, d.player ?? "–") : null,
                h("td", {}, deathCause(d.cause)),
                h("td", {}, d.world ? prettyWorld(d.world) : "–"),
                h("td", {}, d.x == null ? "–" : `${d.x}, ${d.y}, ${d.z}`),
                h("td", {}, dateTimeFmt.format(new Date(d.time))))))));
    }

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

    /** Gestapelde kolommen. points: [{label, values, title}], series: namen in dezelfde volgorde als values. */
    function stackedChart(points, series, labelEvery = 1) {
        const max = Math.max(1, ...points.map(p => p.values[0] + p.values[1]));
        return h("div", {},
            h("div", { class: "series-legend" }, series.map((name, i) =>
                h("span", {}, h("i", { class: `series-${i}`, "aria-hidden": "true" }), name))),
            h("div", { class: "columns", role: "img", "aria-label": points.map(p => p.title).join(", ") },
                points.map(p => h("div", { class: "column stacked", title: p.title },
                    p.values.map((v, i) => v > 0
                        ? h("div", { class: `column-fill series-${i}`, style: `height:${(v / max) * 100}%` }) : null)))),
            h("div", { class: "column-labels", "aria-hidden": "true" },
                points.map((p, i) => h("span", {}, i % labelEvery === 0 ? p.label : ""))));
    }

    /** De laatste N dagen als [{start, end, label, values: [0, 0]}], in de tijdzone van de kijker. */
    function lastDays(days) {
        const fmt = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" });
        const today = new Date();
        return Array.from({ length: days }, (_, i) => {
            // via Date, zodat dagen met wintertijd of zomertijd (23 of 25 uur) kloppen
            const at = offset => new Date(today.getFullYear(), today.getMonth(), today.getDate() - days + 1 + i + offset);
            return { start: +at(0), end: +at(1), label: fmt.format(at(0)), values: [0, 0] };
        });
    }

    /** Speeltijd per dag, gesplitst in actief en AFK. Een sessie over middernacht telt op beide dagen. */
    function playtimePerDay(intervals, days) {
        const points = lastDays(days);
        for (const s of intervals) {
            const length = s.end - s.start;
            if (length <= 0) continue;
            for (const day of points) {
                const part = Math.max(0, Math.min(s.end, day.end) - Math.max(s.start, day.start));
                // Wanneer iemand AFK was weten we hier niet, dus naar verhouding verdelen
                const afk = part * Math.min(1, s.afkMs / length);
                day.values[0] += part - afk;
                day.values[1] += afk;
            }
        }
        return points.map(p => ({ ...p, title: `${p.label}: ${duration(p.values[0])} actief, ${duration(p.values[1])} AFK` }));
    }

    function blocksPerDay(buckets, days) {
        const points = lastDays(days);
        for (const b of buckets) {
            const day = points.find(p => b.hourStart >= p.start && b.hourStart < p.end);
            if (!day) continue;
            day.values[0] += b.broken;
            day.values[1] += b.placed;
        }
        return points.map(p => ({ ...p, title: `${p.label}: ${nf.format(p.values[0])} gebroken, ${nf.format(p.values[1])} geplaatst` }));
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

    function playerTable(players) {
        return h("div", { class: "table-wrap" }, h("table", {},
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
                    h("td", { class: "num" }, timeAgo(p.lastActive)))))));
    }

    /** Tabbladen van het overzicht. Net als bij een speler, maar zonder detail: het gaat om de hele server. */
    const OVERVIEW_TABS = [
        { id: "spelers", label: "Spelers", blocks: ({ players }) => [{ title: "Spelers", content: playerTable(players), wide: true }] },
        { id: "activiteit", label: "Activiteit", blocks: ({ stats }) => {
            const [perDay, afk] = playtimeBlocks(stats);
            return [{ ...perDay, wide: true }, afk, movementBlock(stats)];
        } },
        { id: "blokken", label: "Blokken", blocks: ({ overview, stats }) => [
            blocksPerDayBlock(stats),
            bars("Meest gebroken blokken", overview.topBlocks),
            bars("Meest geplaatste blokken", overview.topPlaced),
            usedBlock(stats)] },
        { id: "gevecht", label: "Gevecht", blocks: ({ stats }) => combatBlocks({ stats }) },
        { id: "items", label: "Items", blocks: ({ stats }) => itemBlocks({ stats }) },
        { id: "crafting", label: "Crafting", blocks: ({ stats }) => craftingBlocks({ stats }) },
        { id: "voortgang", label: "Voortgang", blocks: ({ stats }) => progressBlocks({ stats }) },
    ];

    async function renderOverview(tabId, useCache) {
        const data = await pageData(`overview-${filter.value}`, useCache, async () => {
            const [overview, players, stats] = await Promise.all([
                api(filtered("/api/overview")), api(filtered("/api/players")), api(`${filtered("/api/stats")}&days=${DAYS}`)]);
            return { overview, players, stats };
        });
        const { overview, stats } = data;
        const active = OVERVIEW_TABS.find(t => t.id === tabId) ?? OVERVIEW_TABS[0];

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

        const topCause = overview.topDeathCauses[0];
        return [
            h("h1", {}, "Overzicht"),
            h("p", { class: "subtitle" }, "Wat spelers op deze server doen."),
            h("div", { class: "kpis" },
                kpi("Speeltijd (totaal)", duration(overview.playtimeMs), afkShare(overview.afkMs, overview.playtimeMs)),
                kpi("Blokken gebroken", nf.format(overview.totalBreaks), `${nf.format(overview.totalPlaced)} geplaatst`),
                kpi("Mobs gedood", nf.format(overview.mobKills),
                    overview.pvpKills ? `en ${nf.format(overview.pvpKills)} spelers` : null),
                kpi("Doodgegaan", nf.format(overview.deaths), topCause ? `meestal: ${deathCause(topCause.key)}` : null),
                kpi("Spelers", nf.format(overview.playerCount),
                    stats.sessions ? `${nf.format(stats.sessions)} sessies, gem. ${duration(stats.playtimeMs / stats.sessions)}` : null)),
            tabBar("Gegevens van de server", OVERVIEW_TABS, active, "#/overzicht"),
            ...blockGrid(active.blocks(data)),
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

    /** Laatst opgehaalde data per pagina, zodat wisselen van tabblad niet op de server hoeft te wachten. */
    let cachedPage = { key: null, data: null };

    async function pageData(key, useCache, load) {
        if (!useCache || cachedPage.key !== key) {
            const data = await load(); // eerst laden: bij een fout blijft de oude cache kloppen
            cachedPage = { key, data };
        }
        return cachedPage.data;
    }

    function tabBar(label, tabs, active, base) {
        return h("nav", { class: "tabs", "aria-label": label }, tabs.map(t =>
            h("a", {
                href: `${base}/${t.id}`,
                class: t === active ? "active" : null,
                "aria-current": t === active ? "page" : null,
                "data-tab": t.id,
            }, t.label)));
    }

    /** Tabbladen van de spelerspagina. Elk maakt van {detail, stats} blokken {title, content, wide?, empty?}. */
    const PLAYER_TABS = [
        { id: "activiteit", label: "Activiteit", blocks: activityBlocks },
        { id: "blokken", label: "Blokken", blocks: blockBlocks },
        { id: "gevecht", label: "Gevecht", blocks: combatBlocks },
        { id: "items", label: "Items", blocks: itemBlocks },
        { id: "crafting", label: "Crafting", blocks: craftingBlocks },
        { id: "voortgang", label: "Voortgang", blocks: progressBlocks },
        { id: "locaties", label: "Locaties", blocks: placeBlocks },
    ];

    async function renderPlayer(uuid, tabId, useCache) {
        const { detail, stats } = await pageData(uuid, useCache, async () => {
            const [detail, stats] = await Promise.all([
                api(`/api/players/${encodeURIComponent(uuid)}?days=${DAYS}`),
                api(`/api/stats?player=${encodeURIComponent(uuid)}&days=${DAYS}`)]);
            return { detail, stats };
        });
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
            tabBar("Gegevens van deze speler", PLAYER_TABS, active, `#/speler/${uuid}`),
            ...blockGrid(active.blocks({ detail, stats })),
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

    function playtimeBlocks(stats) {
        return [
            { title: `Speeltijd per dag (laatste ${DAYS} dagen)`,
                content: stackedChart(playtimePerDay(stats.intervals, DAYS), ["Actief", "AFK"], 2) },
            bars("Actief of AFK", [
                { key: "Actief", amount: Math.max(0, stats.playtimeMs - stats.afkMs) },
                { key: "AFK", amount: stats.afkMs },
            ], asIs, duration),
        ];
    }

    function blocksPerDayBlock(stats) {
        return { title: `Gebroken en geplaatst per dag (laatste ${DAYS} dagen)`, wide: true,
            content: stackedChart(blocksPerDay(stats.blocks, DAYS), ["Gebroken", "Geplaatst"], 2) };
    }

    function movementBlock(stats) {
        return bars("Afgelegde afstand (geschat)", stats.movement, movementType, blockDistance);
    }

    function activityBlocks({ detail, stats }) {
        const [perDayBlock, afkBlock] = playtimeBlocks(stats);
        return [
            perDayBlock,
            { title: "Wanneer speelt deze speler?", content: columnChart(perHourOfDay(detail.activity), 3) },
            afkBlock,
            movementBlock(stats),
            { title: "Laatste sessies", content: sessionTable(detail.sessions || []), wide: true },
        ];
    }

    function blockBlocks({ detail: d, stats }) {
        return [
            blocksPerDayBlock(stats),
            bars("Meest gebroken blokken", d.topBlocks),
            bars("Meest geplaatste blokken", d.topPlaced),
            bars("Gereedschap", d.tools),
            usedBlock(stats),
            bars("Gebroken per wereld", d.worlds, prettyWorld),
        ];
    }

    function usedBlock(stats) {
        const used = [...stats.interactions, { key: "SLEEP", amount: stats.sleeps }].sort((a, b) => b.amount - a.amount);
        return bars("Gebruikte blokken", used, key => key === "SLEEP" ? "Geslapen" : pretty(key));
    }

    function progressBlocks({ detail, stats }) {
        const { xp, levels, advancements } = stats.progress;
        const xpBlock = bars("Verdiende XP", xp, xpSource);
        if (levels) xpBlock.content = h("div", {}, h("p", { class: "muted" }, `Levels gestegen: ${nf.format(levels)}`), xpBlock.content);
        return [
            { ...xpBlock, wide: true },
            { title: "Laatste advancements", wide: true, empty: !advancements.length, content: advancementTable(advancements, !detail) },
        ];
    }

    function combatBlocks({ detail, stats }) {
        return [
            bars("Gedode mobs", stats.mobKills),
            bars("Gedode spelers", stats.pvpVictims, asIs),
            bars("Doodsoorzaken", stats.deathCauses, deathCause),
            bars("Schade uitgedeeld", stats.health.damageDealt, pretty, hearts),
            bars("Schade gekregen", stats.health.damageTaken, deathCause, hearts),
            bars("Genezing", stats.health.healed, healReason, hearts),
            { title: "Laatste doden", wide: true, empty: !stats.deaths.length, content: deathTable(stats.deaths, !detail) },
        ];
    }

    function itemBlocks({ stats }) {
        return [
            bars("Opgepakt", stats.items.pickedUp),
            bars("Weggegooid", stats.items.dropped),
            bars("Kapotgegaan", stats.items.broken),
            bars("Gegeten", stats.health.food),
            bars("Gevangen bij het vissen", stats.catches),
        ];
    }

    function craftingBlocks({ stats }) {
        return [
            bars("Gecraft", stats.crafting.crafted),
            bars("Gesmolten", stats.crafting.smelted),
            bars("Geënchant", stats.crafting.enchanted),
            bars("Aambeeld", stats.crafting.anvil, anvilOperation),
            bars("Gebrouwen", stats.crafting.brewed),
        ];
    }

    /** Uit de positie-samples: werelden, biomen, ondergronds, voertuigen en met wie. */
    function placeBlocks({ detail: { player, places } }) {
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

    const MAP_REFRESH_MS = 60_000;

    /**
     * Platte wereldkaart voor onder de heatmap, uit de "lowres"-tegels van BlueMap.
     * onTile wordt aangeroepen als er een tegel klaar is om te tekenen.
     */
    function worldMap(world, onTile) {
        const tiles = new Map(); // "lod/x/z" -> {image, loadedAt, loading}
        let settings = null;

        async function load() {
            const json = await api(`/api/map?world=${encodeURIComponent(world)}`);
            settings = json?.lowres ?? null;
            return settings != null;
        }

        async function loadTile(key, lod, x, z) {
            const entry = tiles.get(key) ?? { image: null };
            tiles.set(key, entry);
            entry.loading = true;
            try {
                const res = await fetch(`/api/map/tile?world=${encodeURIComponent(world)}&lod=${lod}&x=${x}&z=${z}`, { cache: "no-store" });
                if (res.status === 200) entry.image = shadeTile(await createImageBitmap(await res.blob(),
                    { premultiplyAlpha: "none", colorSpaceConversion: "none" }), lod);
            } catch {
                // geen tegel: dan blijft die plek leeg (of de oude tegel staan)
            }
            entry.loading = false;
            entry.loadedAt = Date.now();
            if (entry.image) onTile();
        }

        /** Bovenste helft is kleur, onderste helft hoogte. Hellingen krijgen schaduw, net als in BlueMap. */
        function shadeTile(bitmap, lod) {
            const [w, d] = settings.tileSize;
            const full = w + 1; // één extra rij en kolom, van de buurtegel
            const source = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d", { willReadFrequently: true });
            source.drawImage(bitmap, 0, 0);
            const data = source.getImageData(0, 0, bitmap.width, bitmap.height).data;
            const out = new OffscreenCanvas(w, d);
            const target = out.getContext("2d");
            const image = target.createImageData(w, d);
            const height = (x, z) => {
                const i = ((z + d + 1) * full + x) * 4;
                const v = data[i + 1] * 256 + data[i + 2];
                return v >= 32768 ? v - 65535 : v;
            };
            const lodScale = settings.lodFactor ** (lod - 1);
            for (let z = 0; z < d; z++) {
                for (let x = 0; x < w; x++) {
                    const from = (z * full + x) * 4, to = (z * w + x) * 4;
                    if (!data[from + 3]) continue;
                    const here = height(x, z);
                    const slope = ((here - height(x + 1, z)) + (here - height(x, z + 1))) / lodScale;
                    const shade = Math.max(-0.2, Math.min(0.04, slope * 0.06)) * 255;
                    for (let c = 0; c < 3; c++) image.data[to + c] = data[from + c] + shade;
                    image.data[to + 3] = 255;
                }
            }
            target.putImageData(image, 0, 0);
            return out;
        }

        /** Tekent de zichtbare tegels; wat nog niet geladen of verouderd is, wordt opgehaald. */
        function draw(ctx, width, height, scale, toScreen, toWorld) {
            if (!settings) return;
            const { tileSize: [w, d], lodFactor, lodCount } = settings;
            let lod = 1; // het grofste niveau dat nog scherp is
            while (lod < lodCount && lodFactor ** lod * scale <= 1.5) lod++;
            const blocks = lodFactor ** (lod - 1);
            const [x0, z0] = toWorld(0, 0), [x1, z1] = toWorld(width, height);
            ctx.imageSmoothingEnabled = blocks * scale < 1;
            for (let tz = Math.floor(z0 / (d * blocks)); tz * d * blocks < z1; tz++) {
                for (let tx = Math.floor(x0 / (w * blocks)); tx * w * blocks < x1; tx++) {
                    const key = `${lod}/${tx}/${tz}`;
                    const entry = tiles.get(key);
                    if (!entry || (!entry.loading && Date.now() - entry.loadedAt > MAP_REFRESH_MS)) loadTile(key, lod, tx, tz);
                    if (!entry?.image) continue;
                    // op hele pixels, anders zie je naden tussen de tegels
                    const [px, py] = toScreen(tx * w * blocks, tz * d * blocks).map(Math.round);
                    const [qx, qy] = toScreen((tx + 1) * w * blocks, (tz + 1) * d * blocks).map(Math.round);
                    ctx.drawImage(entry.image, px, py, qx - px, qy - py);
                }
            }
        }

        return { world, load, draw, get ready() { return settings != null; } };
    }

    async function renderHeatmap(worldParam, playerParam) {
        let world = worldParam ? decodeURIComponent(worldParam) : "world";
        let player = playerParam ?? "";
        let cells = []; // alle werelden van de gekozen speler
        let shown = [];
        let view = null; // midden (in blokken) en scale (pixels per blok)
        let drag = null;
        let map = null; // platte kaart van de gekozen wereld
        let showMap = true;

        const mapToggle = h("input", { type: "checkbox", checked: "", onchange: () => { showMap = mapToggle.checked; draw(); } });
        const mapHint = h("p", { class: "hint heat-hint", hidden: "" },
            "Geen kaart van deze wereld. Die komt van BlueMap: controleer of de plugin draait en de wereld gerenderd is (zie README).");
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

        async function loadMap() {
            if (map?.world !== world) map = worldMap(world, () => { if (canvas.isConnected) draw(); });
            const current = map;
            if (!current.ready) await current.load().catch(() => false); // BlueMap kan later klaar zijn: elke keer opnieuw proberen
            if (current === map) {
                mapHint.hidden = map.ready;
                draw();
            }
        }

        async function load() {
            loadMap(); // niet op wachten: de heatmap werkt ook zonder kaart
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
            const withMap = showMap && map?.ready && map.world === world;
            if (withMap) map.draw(ctx, width, height, view.scale, toScreen, toWorld);
            ctx.globalAlpha = withMap ? 0.6 : 1; // de kaart blijft eronder zichtbaar
            for (const c of shown) {
                const [px, py] = toScreen(c.chunkX * CHUNK, c.chunkZ * CHUNK);
                if (px + size < 0 || py + size < 0 || px > width || py > height) continue;
                ctx.fillStyle = heatColor(Math.log1p(c.timeMs / 1000) / max);
                ctx.fillRect(px, py, size, size);
            }

            ctx.globalAlpha = 1;

            // Rasterlijnen op een rond aantal blokken, minstens 80 px uit elkaar
            let step = CHUNK;
            while (step * view.scale < 80) step *= 2;
            ctx.font = `11px ${css.fontFamily}`;
            ctx.lineWidth = 1;
            const [left, upper] = toWorld(0, 0);
            const line = (zero, x1, y1, x2, y2) => {
                ctx.strokeStyle = withMap ? `rgba(255, 255, 255, ${zero ? .7 : .2})` : css.getPropertyValue(zero ? "--muted" : "--border");
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
                ctx.fillStyle = css.getPropertyValue("--text");
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
                h("label", {}, mapToggle, " Kaart tonen"),
                h("div", { class: "heat-zoom" },
                    zoomButton("Uitzoomen", "−", () => zoom(1 / 1.5)),
                    zoomButton("Inzoomen", "+", () => zoom(1.5)),
                    zoomButton("Alles tonen", "Alles tonen", () => { view = null; draw(); }))),
            h("div", { class: "heat-map" }, canvas, tip, none),
            mapHint,
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

    const OVERVIEW_ROUTE = /^(?:#\/?|)(?:#\/overzicht\/([a-z]+))?$/;

    /** Wat dezelfde pagina is, ook met een ander tabblad. */
    function pageKey(hash) {
        return hash.match(PLAYER_ROUTE)?.[1] ?? (OVERVIEW_ROUTE.test(hash) ? "overview" : null);
    }

    async function render(useCache = false) {
        const id = ++renderId;
        updateNav();
        const match = location.hash.match(PLAYER_ROUTE);
        const heat = location.hash.match(HEAT_ROUTE);
        refreshHeatmap = null;
        try {
            const content = isMapRoute() ? await renderMap()
                : heat ? await renderHeatmap(heat[1], heat[2])
                : match ? await renderPlayer(match[1], match[2], useCache) : await renderOverview(location.hash.match(OVERVIEW_ROUTE)?.[1], useCache);
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
        const key = pageKey(location.hash);
        if (key && key === pageKey(new URL(event.oldURL).hash)) { // ander tabblad van dezelfde pagina
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
