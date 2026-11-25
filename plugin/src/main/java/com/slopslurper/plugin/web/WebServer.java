package com.slopslurper.plugin.web;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.slopslurper.plugin.storage.DataStore;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Kleine webserver in de plugin: een JSON-API op /api/... en het dashboard op /.
 *
 * De API is het contract tussen data en dashboard. Als we later naar een centrale
 * opslag gaan, kan een centrale webapp dezelfde endpoints aanbieden en blijft het
 * dashboard hetzelfde.
 *
 * Endpoints:
 *   GET /api/overview              totalen, top-blokken, meest actieve spelers
 *   GET /api/players               alle spelers met hun totaal
 *   GET /api/players/{uuid}?days=N details van één speler (activiteit van de laatste N dagen)
 *   GET /api/heatmap[?player=uuid] gebroken blokken per chunk
 *   GET /api/heatmap/positions[?player=uuid&world=naam] doorgebrachte tijd per chunk
 *   GET /api/stats[?player=uuid&days=N] sessies, doden, gevecht, items en beweging (speler of hele server)
 *   GET /api/map?world=naam        instellingen van de platte kaart (404 als die er niet is)
 *   GET /api/map/tile?world=naam&lod=1&x=0&z=0  één kaarttegel als PNG
 *   GET /api/config                instellingen voor de frontend (bijv. of de 3D-kaart beschikbaar is)
 */
public final class WebServer {

    private static final int TOP_SIZE = 10;
    private static final int DEFAULT_DAYS = 14;
    private static final int MAX_DAYS = 365;

    private static final Map<String, String> STATIC_FILES = Map.of(
            "/", "index.html",
            "/index.html", "index.html",
            "/app.js", "app.js",
            "/style.css", "style.css"
    );

    private final DataStore store;
    private final Logger logger;
    private final String host;
    private final int port;
    private final String blueMapUrl; // null als BlueMap niet geïnstalleerd is
    private final MapTiles mapTiles; // null als BlueMap niet geïnstalleerd is
    private final Gson gson = new GsonBuilder().create();

    private HttpServer server;
    private ExecutorService executor;

    public WebServer(DataStore store, Logger logger, String host, int port, String blueMapUrl, MapTiles mapTiles) {
        this.store = store;
        this.logger = logger;
        this.host = host;
        this.port = port;
        this.blueMapUrl = blueMapUrl;
        this.mapTiles = mapTiles;
    }

    public void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress(host, port), 0);
        executor = Executors.newFixedThreadPool(4, r -> {
            Thread t = new Thread(r, "SlopSlurper-Web");
            t.setDaemon(true);
            return t;
        });
        server.setExecutor(executor);
        server.createContext("/api/", this::handleApi);
        server.createContext("/", this::handleStatic);
        server.start();
    }

    public void stop() {
        if (server != null) {
            server.stop(0);
        }
        if (executor != null) {
            executor.shutdownNow();
        }
    }

    public String url() {
        String shownHost = host.equals("0.0.0.0") ? "localhost" : host;
        return "http://" + shownHost + ":" + port + "/";
    }

    private void handleApi(HttpExchange exchange) throws IOException {
        try (exchange) {
            if (!exchange.getRequestMethod().equals("GET")) {
                sendJson(exchange, 405, Map.of("error", "Alleen GET is toegestaan"));
                return;
            }

            String path = exchange.getRequestURI().getPath();
            if (path.endsWith("/") && path.length() > 1) {
                path = path.substring(0, path.length() - 1);
            }

            if (path.equals("/api/config")) {
                Map<String, Object> config = new java.util.HashMap<>();
                config.put("blueMapEnabled", blueMapUrl != null);
                config.put("blueMapUrl", blueMapUrl);
                sendJson(exchange, 200, config);
            } else if (path.equals("/api/map") || path.equals("/api/map/tile")) {
                handleMap(exchange, path.endsWith("/tile"));
            } else if (path.equals("/api/heatmap") || path.equals("/api/heatmap/positions") || path.equals("/api/stats")) {
                UUID player = null;
                String playerParam = queryParam(exchange.getRequestURI(), "player");
                if (playerParam != null) {
                    try {
                        player = UUID.fromString(playerParam);
                    } catch (IllegalArgumentException e) {
                        sendJson(exchange, 400, Map.of("error", "Ongeldige UUID"));
                        return;
                    }
                }
                if (path.equals("/api/stats")) {
                    long since = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(parseDays(exchange.getRequestURI()));
                    sendJson(exchange, 200, await(store.getStats(player, TOP_SIZE, since)));
                } else if (path.equals("/api/heatmap")) {
                    sendJson(exchange, 200, await(store.getBlockBreakHeatmap(player)));
                } else {
                    String world = queryParam(exchange.getRequestURI(), "world");
                    sendJson(exchange, 200, await(store.getPositionHeatmap(player, world)));
                }
            } else if (path.equals("/api/overview")) {
                sendJson(exchange, 200, await(store.getOverview(TOP_SIZE)));
            } else if (path.equals("/api/players")) {
                sendJson(exchange, 200, await(store.getPlayers()));
            } else if (path.startsWith("/api/players/")) {
                UUID uuid;
                try {
                    uuid = UUID.fromString(path.substring("/api/players/".length()));
                } catch (IllegalArgumentException e) {
                    sendJson(exchange, 400, Map.of("error", "Ongeldige UUID"));
                    return;
                }
                int days = parseDays(exchange.getRequestURI());
                long since = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(days);
                var detail = await(store.getPlayer(uuid, TOP_SIZE, since));
                if (detail.isPresent()) {
                    sendJson(exchange, 200, detail.get());
                } else {
                    sendJson(exchange, 404, Map.of("error", "Geen data voor deze speler"));
                }
            } else {
                sendJson(exchange, 404, Map.of("error", "Onbekend endpoint"));
            }
        } catch (Exception e) {
            logger.log(Level.WARNING, "Fout in dashboard-API", e);
            try {
                sendJson(exchange, 500, Map.of("error", "Interne fout"));
            } catch (IOException ignored) {
                // response was al (deels) verstuurd
            }
        }
    }

    private void handleStatic(HttpExchange exchange) throws IOException {
        try (exchange) {
            String file = STATIC_FILES.get(exchange.getRequestURI().getPath());
            if (file == null) {
                sendText(exchange, 404, "text/plain", "Niet gevonden".getBytes(StandardCharsets.UTF_8));
                return;
            }
            try (InputStream in = getClass().getClassLoader().getResourceAsStream("web/" + file)) {
                if (in == null) {
                    sendText(exchange, 404, "text/plain", "Niet gevonden".getBytes(StandardCharsets.UTF_8));
                    return;
                }
                sendText(exchange, 200, contentType(file), in.readAllBytes());
            }
        }
    }

    private void handleMap(HttpExchange exchange, boolean tile) throws IOException {
        URI uri = exchange.getRequestURI();
        String world = queryParam(uri, "world");
        byte[] body = null;
        try {
            if (mapTiles != null && world != null) {
                body = !tile ? mapTiles.settings(world) : mapTiles.tile(world,
                        intParam(uri, "lod"), intParam(uri, "x"), intParam(uri, "z"));
            }
        } catch (NumberFormatException e) {
            sendJson(exchange, 400, Map.of("error", "lod, x en z moeten getallen zijn"));
            return;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            // BlueMap (nog) niet bereikbaar: de heatmap werkt ook zonder kaart
            logger.log(Level.FINE, "Kaart niet opgehaald", e);
        }
        if (body == null && tile) {
            exchange.sendResponseHeaders(204, -1); // niet gerenderd; heel gewoon, dus geen fout
            return;
        }
        if (body == null) {
            sendJson(exchange, 404, Map.of("error", "Geen kaart"));
            return;
        }
        sendText(exchange, 200, tile ? "image/png" : "application/json; charset=utf-8", body);
    }

    private static int intParam(URI uri, String key) {
        return Integer.parseInt(String.valueOf(queryParam(uri, key)));
    }

    /** Waarde van een queryparameter, of {@code null} als die ontbreekt of leeg is. */
    private static String queryParam(URI uri, String key) {
        String q = uri.getRawQuery();
        if (q == null) {
            return null;
        }
        for (String part : q.split("&")) {
            if (part.startsWith(key + "=")) {
                String value = URLDecoder.decode(part.substring(key.length() + 1), StandardCharsets.UTF_8);
                return value.isEmpty() ? null : value;
            }
        }
        return null;
    }

    private static int parseDays(URI uri) {
        String q = uri.getQuery();
        if (q != null) {
            for (String part : q.split("&")) {
                if (part.startsWith("days=")) {
                    try {
                        int days = Integer.parseInt(part.substring(5));
                        return Math.max(1, Math.min(MAX_DAYS, days));
                    } catch (NumberFormatException ignored) {
                    }
                }
            }
        }
        return DEFAULT_DAYS;
    }

    private static <T> T await(CompletableFuture<T> future) throws Exception {
        return future.get(10, TimeUnit.SECONDS);
    }

    private void sendJson(HttpExchange exchange, int status, Object body) throws IOException {
        sendText(exchange, status, "application/json; charset=utf-8", gson.toJson(body).getBytes(StandardCharsets.UTF_8));
    }

    private static void sendText(HttpExchange exchange, int status, String type, byte[] body) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", type);
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, body.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(body);
        }
    }

    private static String contentType(String file) {
        if (file.endsWith(".html")) return "text/html; charset=utf-8";
        if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (file.endsWith(".css")) return "text/css; charset=utf-8";
        return "application/octet-stream";
    }
}
