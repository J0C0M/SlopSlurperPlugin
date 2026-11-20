// SlopSlurper dashboard: haalt data op uit /api/... en tekent alles zonder externe libraries.
(() => {
    "use strict";

    const REFRESH_MS = 10_000;
    const DAYS = 14;
    const app = document.getElementById("app");
    const status = document.getElementById("status");
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
        const [overview, players] = await Promise.all([api("/api/overview"), api("/api/players")]);

        if (!overview || overview.playerCount === 0) {
            return [
                h("h1", {}, "Overzicht"),
                h("p", { class: "subtitle" }, "Wat spelers op deze server doen."),
                h("div", { class: "card" }, empty("Nog geen data",
                    "Join de server en breek een paar blokken. Dit dashboard ververst vanzelf.")),
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
                    h("td", {}, h("a", { href: `#/speler/${p.uuid}`, class: "player-cell" }, avatar(p.name), p.name)),
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

    async function renderPlayer(uuid) {
        const detail = await api(`/api/players/${encodeURIComponent(uuid)}?days=${DAYS}`);
        const back = h("a", { href: "#/", class: "back" }, "← Overzicht");

        if (!detail) {
            return [back, h("div", { class: "card" }, empty("Speler niet gevonden",
                "Er is (nog) geen data voor deze speler."))];
        }

        const p = detail.player;
        const favBlock = detail.topBlocks[0];
        const favTool = detail.tools[0];
        const topCause = detail.deathCauses[0];
        const places = detail.places;
        const hasPlaces = places && places.sampledMs > 0;

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
                kpi("Doodgegaan", nf.format(p.deaths), topCause ? `meestal: ${deathCause(topCause.key)}` : null),
                kpi("Favoriete blok", favBlock ? pretty(favBlock.key) : "–"),
                kpi("Meest gebruikt", favTool ? pretty(favTool.key) : "–")),
            h("div", { class: "grid" },
                card("Laatste sessies", sessionTable(detail.sessions || []), true),
                card(`Blokken per dag (laatste ${DAYS} dagen)`, columnChart(perDay(detail.activity, DAYS), 2), true),
                card("Wanneer speelt deze speler?", columnChart(perHourOfDay(detail.activity), 3), true),
                card("Meest gebroken blokken", barList(detail.topBlocks)),
                card("Meest geplaatste blokken", barList(detail.topPlaced)),
                card("Gereedschap", barList(detail.tools)),
                hasPlaces
                    ? card("Tijd per wereld", barList(places.worlds, prettyWorld, duration))
                    : card("Werelden (gebroken blokken)", barList(detail.worlds, prettyWorld)),
                card("Gedode mobs", barList(detail.mobKills)),
                card("Doodsoorzaken", barList(detail.deathCauses, deathCause)),
                detail.pvpVictims.length ? card("Gedode spelers", barList(detail.pvpVictims, asIs)) : null,
                ...placeCards(places)),
        ];
    }

    /** Kaarten uit de positie-samples: biomen, ondergronds, voertuigen en met wie. */
    function placeCards(places) {
        if (!places || !places.sampledMs) {
            return [card("Waar speelt deze speler?", h("p", { class: "muted" },
                "Nog geen positie-data. Zolang de speler online is, wordt elke paar seconden vastgelegd waar hij is."), true)];
        }
        const depth = [
            { key: "Ondergronds of binnen", amount: places.undergroundMs },
            { key: "Bovengronds", amount: places.surfaceMs },
        ];
        return [
            card("Biomen", barList(places.biomes, pretty, duration)),
            card("Ondergronds of bovengronds", barList(depth, asIs, duration,
                "Alleen bekend in de overworld.")),
            card("Onderweg", barList(places.vehicles, pretty, duration,
                "Nog niet in een boot, minecart, op een paard of met elytra geweest.")),
            card("Speelt het meest met", h("div", {},
                h("p", { class: "muted" },
                    `${percent(places.withOthersMs, places.sampledMs)} van de tijd met andere spelers in de buurt.`),
                barList(places.companions, asIs, duration, "Nog niet samen met anderen gespeeld."))),
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
        const [config, cells] = await Promise.all([api("/api/config"), api("/api/heatmap").catch(() => [])]);
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
                "De heatmap wordt elke minuut bijgewerkt. Aan/uit via het lagen-menu in BlueMap (“SlopSlurper: gebroken blokken”). ",
                h("a", { href: config.blueMapUrl, target: "_blank", rel: "noopener" }, "Open de kaart los ↗"))),
        ];
    }

    // ---------- Router + verversen ----------

    let renderId = 0;
    const isMapRoute = () => location.hash === "#/kaart";

    function updateNav() {
        const active = isMapRoute() ? "map" : "overview";
        document.querySelectorAll("[data-nav]").forEach(a => {
            a.classList.toggle("active", a.dataset.nav === active);
            if (a.dataset.nav === active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
        });
    }

    async function render() {
        const id = ++renderId;
        updateNav();
        const match = location.hash.match(/^#\/speler\/([0-9a-fA-F-]{36})$/);
        try {
            const content = isMapRoute() ? await renderMap()
                : match ? await renderPlayer(match[1]) : await renderOverview();
            if (id !== renderId) return; // inmiddels naar een andere pagina genavigeerd
            app.replaceChildren(...content);
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

    window.addEventListener("hashchange", () => {
        app.replaceChildren();
        window.scrollTo(0, 0);
        render();
    });
    // De 3D-kaart niet automatisch verversen: dan zou het iframe steeds opnieuw laden
    setInterval(() => { if (!document.hidden && !isMapRoute()) render(); }, REFRESH_MS);
    render();
})();
