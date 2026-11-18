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

    function kpi(label, value) {
        return h("div", { class: "kpi" },
            h("div", { class: "kpi-label" }, label),
            h("div", { class: "kpi-value" }, value));
    }

    function card(title, content, wide = false) {
        return h("section", { class: wide ? "card wide" : "card" }, h("h2", {}, title), content);
    }

    function empty(title, text) {
        return h("div", { class: "empty" }, h("strong", {}, title), text);
    }

    /** Horizontale balkenlijst, bv. top-blokken. */
    function barList(entries, labelFn = pretty) {
        if (!entries.length) return h("p", { class: "muted" }, "Nog geen data.");
        const max = Math.max(...entries.map(e => e.amount));
        return h("div", { class: "bars" }, entries.map(e =>
            h("div", { class: "bar-row", title: `${labelFn(e.key)}: ${nf.format(e.amount)}` },
                h("span", { class: "bar-label" }, labelFn(e.key)),
                h("span", { class: "bar-track" },
                    h("span", { class: "bar-fill", style: `width:${(e.amount / max) * 100}%` })),
                h("span", { class: "bar-value" }, nf.format(e.amount)))));
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

        if (!overview || overview.totalBreaks === 0) {
            return [
                h("h1", {}, "Overzicht"),
                h("p", { class: "subtitle" }, "Wat spelers op deze server doen."),
                h("div", { class: "card" }, empty("Nog geen data",
                    "Join de server en breek een paar blokken. Dit dashboard ververst vanzelf.")),
            ];
        }

        const top = overview.topBlocks[0];
        const table = h("table", {},
            h("thead", {}, h("tr", {},
                h("th", {}, "Speler"),
                h("th", { class: "num" }, "Blokken gebroken"),
                h("th", { class: "num" }, "Laatst actief"))),
            h("tbody", {}, players.map(p =>
                h("tr", { onclick: () => { location.hash = `#/speler/${p.uuid}`; } },
                    h("td", {}, h("a", { href: `#/speler/${p.uuid}`, class: "player-cell" }, avatar(p.name), p.name)),
                    h("td", { class: "num" }, nf.format(p.totalBreaks)),
                    h("td", { class: "num" }, timeAgo(p.lastActive))))));

        return [
            h("h1", {}, "Overzicht"),
            h("p", { class: "subtitle" }, "Wat spelers op deze server doen."),
            h("div", { class: "kpis" },
                kpi("Blokken gebroken", nf.format(overview.totalBreaks)),
                kpi("Spelers", nf.format(overview.playerCount)),
                kpi("Meest gebroken blok", top ? pretty(top.key) : "–")),
            h("div", { class: "grid" },
                card("Meest gebroken blokken", barList(overview.topBlocks)),
                card("Spelers", h("div", { class: "table-wrap" }, table))),
        ];
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

        return [
            back,
            h("div", { class: "player-head" },
                avatar(p.name, true),
                h("div", {}, h("h1", {}, p.name), h("p", {}, `Laatst actief ${timeAgo(p.lastActive)}`))),
            h("div", { class: "kpis" },
                kpi("Blokken gebroken", nf.format(p.totalBreaks)),
                kpi("Favoriete blok", favBlock ? pretty(favBlock.key) : "–"),
                kpi("Meest gebruikt", favTool ? pretty(favTool.key) : "–")),
            h("div", { class: "grid" },
                card(`Blokken per dag (laatste ${DAYS} dagen)`, columnChart(perDay(detail.activity, DAYS), 2), true),
                card("Wanneer speelt deze speler?", columnChart(perHourOfDay(detail.activity), 3), true),
                card("Meest gebroken blokken", barList(detail.topBlocks)),
                card("Gereedschap", barList(detail.tools)),
                card("Werelden", barList(detail.worlds, prettyWorld))),
        ];
    }

    // ---------- Router + verversen ----------

    let renderId = 0;

    async function render() {
        const id = ++renderId;
        const match = location.hash.match(/^#\/speler\/([0-9a-fA-F-]{36})$/);
        try {
            const content = match ? await renderPlayer(match[1]) : await renderOverview();
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
    setInterval(() => { if (!document.hidden) render(); }, REFRESH_MS);
    render();
})();
