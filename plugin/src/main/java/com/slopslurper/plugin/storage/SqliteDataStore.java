package com.slopslurper.plugin.storage;

import com.google.gson.Gson;
import com.slopslurper.plugin.storage.stats.ChunkHeat;
import com.slopslurper.plugin.storage.stats.CountEntry;
import com.slopslurper.plugin.storage.stats.Overview;
import com.slopslurper.plugin.storage.stats.PlayerDetail;
import com.slopslurper.plugin.storage.stats.PlayerSummary;

import java.io.File;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Types;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Queue;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * SQLite-opslag voor spelersdata.
 *
 * Alle databasewerk draait op één eigen achtergrondthread, zodat de main thread
 * (en dus de TPS van de server) nooit op disk-I/O hoeft te wachten. Events worden
 * eerst in een wachtrij gezet en periodiek in één transactie weggeschreven.
 *
 * Bijna alles staat in één generieke {@code events}-tabel (zie {@link SqliteMigrations});
 * {@link EventTypes} bevat de mogelijke waarden van {@code type}. Sessies en positie-samples
 * hebben een eigen tabel.
 */
public final class SqliteDataStore implements DataStore {

    /** Basisfilter voor alle blokbreuk-queries. */
    private static final String BREAKS = "FROM events WHERE type = '" + EventTypes.BLOCK_BREAK + "'";

    private final File file;
    private final Logger logger;
    private final Gson gson = new Gson();
    private final ExecutorService executor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "SlopSlurper-DB");
        t.setDaemon(true);
        return t;
    });
    private final Queue<GameEvent> pending = new ConcurrentLinkedQueue<>();
    private final Queue<SessionRecord> pendingSessions = new ConcurrentLinkedQueue<>();
    private final Queue<PositionSample> pendingPositions = new ConcurrentLinkedQueue<>();

    private Connection connection;

    public SqliteDataStore(File dataFolder, Logger logger) {
        this.file = new File(dataFolder, "data.db");
        this.logger = logger;
    }

    /** Opent de database en voert openstaande migraties uit. Blokkeert tot het klaar is. */
    @Override
    public void open() throws Exception {
        file.getParentFile().mkdirs();
        executor.submit(() -> {
            connection = DriverManager.getConnection("jdbc:sqlite:" + file.getAbsolutePath());
            try (Statement st = connection.createStatement()) {
                st.execute("PRAGMA journal_mode=WAL");
            }
            SqliteMigrations.migrate(connection, file, logger);
            closeDanglingSessions();
            return null;
        }).get();
    }

    /**
     * Sessies zonder einde komen van een crash of een harde stop (de quit is nooit verwerkt).
     * Die sluiten we af op het laatste tussentijdse moment dat we ze zagen.
     */
    private void closeDanglingSessions() throws SQLException {
        try (Statement st = connection.createStatement()) {
            int n = st.executeUpdate("UPDATE sessions SET ended_at = last_seen_at, end_reason = 'SERVER_CRASH' "
                    + "WHERE ended_at IS NULL");
            if (n > 0) {
                logger.info(n + " sessie(s) van een vorige crash afgesloten op hun laatst bekende tijd.");
            }
        }
    }

    @Override
    public void recordEvent(GameEvent event) {
        pending.add(event);
    }

    @Override
    public void saveSession(SessionRecord session) {
        pendingSessions.add(session);
    }

    @Override
    public void recordPosition(PositionSample sample) {
        pendingPositions.add(sample);
    }

    @Override
    public void flushAsync() {
        if (!pending.isEmpty() || !pendingSessions.isEmpty() || !pendingPositions.isEmpty()) {
            executor.execute(this::flushNow);
        }
    }

    private static final String SESSION_UPSERT = """
            INSERT INTO sessions (id, player_uuid, player_name, started_at, last_seen_at, ended_at, afk_ms, end_reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                player_name  = excluded.player_name,
                last_seen_at = excluded.last_seen_at,
                ended_at     = excluded.ended_at,
                afk_ms       = excluded.afk_ms,
                end_reason   = excluded.end_reason""";

    private static final String EVENT_INSERT = "INSERT INTO events (type, player_uuid, player_name, subtype, world, "
            + "x, y, z, item, game_mode, value, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

    private static final String POSITION_INSERT = "INSERT INTO position_samples (player_uuid, world, x, y, z, "
            + "biome, underground, vehicle, game_mode, nearby_count, nearby, interval_ms, created_at) "
            + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

    private static <T> List<T> drain(Queue<T> queue) {
        List<T> result = new ArrayList<>();
        T item;
        while ((item = queue.poll()) != null) {
            result.add(item);
        }
        return result;
    }

    private void flushNow() {
        if (connection == null) {
            return;
        }
        List<GameEvent> batch = drain(pending);
        List<SessionRecord> sessions = drain(pendingSessions);
        List<PositionSample> positions = drain(pendingPositions);
        if (batch.isEmpty() && sessions.isEmpty() && positions.isEmpty()) {
            return;
        }

        try {
            connection.setAutoCommit(false);
            // Sessies in volgorde van binnenkomst, zodat de nieuwste stand als laatste wint
            try (PreparedStatement ps = connection.prepareStatement(SESSION_UPSERT)) {
                for (SessionRecord rec : sessions) {
                    ps.setString(1, rec.id());
                    ps.setString(2, rec.playerUuid().toString());
                    ps.setString(3, rec.playerName());
                    ps.setLong(4, rec.startedAt());
                    ps.setLong(5, rec.lastSeenAt());
                    if (rec.endedAt() == null) {
                        ps.setNull(6, Types.INTEGER);
                    } else {
                        ps.setLong(6, rec.endedAt());
                    }
                    ps.setLong(7, rec.afkMs());
                    ps.setString(8, rec.endReason());
                    ps.executeUpdate();
                }
            }
            try (PreparedStatement ps = connection.prepareStatement(EVENT_INSERT)) {
                for (GameEvent ev : batch) {
                    ps.setString(1, ev.type());
                    ps.setString(2, ev.playerUuid() == null ? null : ev.playerUuid().toString());
                    ps.setString(3, ev.playerName());
                    ps.setString(4, ev.subtype());
                    ps.setString(5, ev.world());
                    setInt(ps, 6, ev.x());
                    setInt(ps, 7, ev.y());
                    setInt(ps, 8, ev.z());
                    ps.setString(9, ev.item());
                    ps.setString(10, ev.gameMode());
                    ps.setDouble(11, ev.value());
                    ps.setString(12, ev.meta().isEmpty() ? null : gson.toJson(ev.meta()));
                    ps.setLong(13, ev.createdAt());
                    ps.addBatch();
                }
                ps.executeBatch();
            }
            try (PreparedStatement ps = connection.prepareStatement(POSITION_INSERT)) {
                for (PositionSample p : positions) {
                    ps.setString(1, p.playerUuid().toString());
                    ps.setString(2, p.world());
                    ps.setInt(3, p.x());
                    ps.setInt(4, p.y());
                    ps.setInt(5, p.z());
                    ps.setString(6, p.biome());
                    setInt(ps, 7, p.underground() == null ? null : (p.underground() ? 1 : 0));
                    ps.setString(8, p.vehicle());
                    ps.setString(9, p.gameMode());
                    ps.setInt(10, p.nearby().size());
                    ps.setString(11, p.nearby().isEmpty() ? null
                            : gson.toJson(p.nearby().stream().map(UUID::toString).toList()));
                    ps.setLong(12, p.intervalMs());
                    ps.setLong(13, p.createdAt());
                    ps.addBatch();
                }
                ps.executeBatch();
            }
            connection.commit();
        } catch (SQLException ex) {
            logger.log(Level.SEVERE, "Kon " + batch.size() + " events, " + sessions.size() + " sessies en "
                    + positions.size() + " posities niet opslaan", ex);
            try {
                connection.rollback();
            } catch (SQLException ignored) {
            }
        } finally {
            try {
                connection.setAutoCommit(true);
            } catch (SQLException ignored) {
            }
        }
    }

    private static void setInt(PreparedStatement ps, int index, Integer value) throws SQLException {
        if (value == null) {
            ps.setNull(index, Types.INTEGER);
        } else {
            ps.setInt(index, value);
        }
    }

    // ---------- Queries ----------

    @Override
    public CompletableFuture<BlockStats> getBlockStats(UUID player, int limit) {
        String id = player.toString();
        return query(() -> {
            long total = countOf(EventTypes.BLOCK_BREAK, id);
            long placed = countOf(EventTypes.BLOCK_PLACE, id);
            List<BlockStats.Entry> top = topSubtypes(EventTypes.BLOCK_BREAK, id, limit).stream()
                    .map(c -> new BlockStats.Entry(c.key(), c.amount())).toList();
            return new BlockStats(total, placed, top);
        });
    }

    @Override
    public CompletableFuture<Overview> getOverview(int limit) {
        return query(() -> {
            long players = single("SELECT COUNT(DISTINCT player_uuid) FROM events WHERE player_uuid IS NOT NULL");
            long playtime = single("SELECT COALESCE(SUM(" + SESSION_DURATION + "), 0) FROM sessions");
            long afk = single("SELECT COALESCE(SUM(afk_ms), 0) FROM sessions");
            List<PlayerSummary> topPlayers = summaries(playerSummarySql(false) + " ORDER BY playtime DESC, total DESC LIMIT ?", limit);
            return new Overview(
                    countOf(EventTypes.BLOCK_BREAK, null),
                    countOf(EventTypes.BLOCK_PLACE, null),
                    countOf(EventTypes.MOB_KILL, null),
                    countOf(EventTypes.PVP_KILL, null),
                    countOf(EventTypes.DEATH, null),
                    players, playtime, afk,
                    topSubtypes(EventTypes.BLOCK_BREAK, null, limit),
                    topSubtypes(EventTypes.BLOCK_PLACE, null, limit),
                    topSubtypes(EventTypes.MOB_KILL, null, limit),
                    topSubtypes(EventTypes.DEATH, null, limit),
                    topPlayers);
        });
    }

    @Override
    public CompletableFuture<List<PlayerSummary>> getPlayers() {
        return query(() -> summaries(playerSummarySql(false) + " ORDER BY playtime DESC, total DESC"));
    }

    @Override
    public CompletableFuture<Optional<PlayerDetail>> getPlayer(UUID player, int limit, long activitySince) {
        String id = player.toString();
        return query(() -> {
            List<PlayerSummary> found = summaries(playerSummarySql(true), id);
            if (found.isEmpty()) {
                return Optional.empty();
            }
            List<CountEntry> tools = counts(
                    "SELECT item, COUNT(*) AS n " + BREAKS + " AND player_uuid = ? GROUP BY item ORDER BY n DESC LIMIT ?",
                    id, limit);
            List<CountEntry> worlds = counts(
                    "SELECT world, COUNT(*) AS n " + BREAKS + " AND player_uuid = ? GROUP BY world ORDER BY n DESC", id);

            List<PlayerDetail.ActivityBucket> activity = new ArrayList<>();
            try (PreparedStatement ps = prepare(
                    "SELECT (created_at / 3600000) * 3600000 AS hour, COUNT(*) " + BREAKS
                            + " AND player_uuid = ? AND created_at >= ? GROUP BY hour ORDER BY hour", id, activitySince);
                 ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    activity.add(new PlayerDetail.ActivityBucket(rs.getLong(1), rs.getLong(2)));
                }
            }
            List<PlayerDetail.SessionInfo> recent = new ArrayList<>();
            try (PreparedStatement ps = prepare(
                    "SELECT started_at, ended_at, " + SESSION_DURATION + ", afk_ms, end_reason FROM sessions "
                            + "WHERE player_uuid = ? ORDER BY started_at DESC LIMIT ?", id, limit);
                 ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    long ended = rs.getLong(2);
                    Long endedAt = rs.wasNull() ? null : ended; // direct na getLong(2) controleren
                    recent.add(new PlayerDetail.SessionInfo(rs.getLong(1), endedAt,
                            rs.getLong(3), rs.getLong(4), rs.getString(5)));
                }
            }
            return Optional.of(new PlayerDetail(found.get(0),
                    topSubtypes(EventTypes.BLOCK_BREAK, id, limit),
                    topSubtypes(EventTypes.BLOCK_PLACE, id, limit),
                    tools, worlds,
                    topSubtypes(EventTypes.MOB_KILL, id, limit),
                    topSubtypes(EventTypes.PVP_KILL, id, limit),
                    topSubtypes(EventTypes.DEATH, id, limit),
                    topSubtypes(EventTypes.FISH, id, limit),
                    activity, recent, places(id, limit),
                    health(id, limit), crafting(id, limit)));
        });
    }

    private PlayerDetail.Health health(String id, int limit) throws SQLException {
        return new PlayerDetail.Health(
                topValues(EventTypes.DAMAGE_DEALT, id, limit),
                topValues(EventTypes.DAMAGE_TAKEN, id, limit),
                topValues(EventTypes.HEAL, id, limit),
                topSubtypes(EventTypes.EAT, id, limit));
    }

    private PlayerDetail.Crafting crafting(String id, int limit) throws SQLException {
        return new PlayerDetail.Crafting(
                topValues(EventTypes.CRAFT, id, limit),
                topValues(EventTypes.SMELT, id, limit),
                topSubtypes(EventTypes.ENCHANT, id, limit),
                topSubtypes(EventTypes.ANVIL, id, limit),
                topValues(EventTypes.BREW, id, limit));
    }

    /** Waar de speler zijn tijd doorbrengt, uit {@code position_samples}. */
    private PlayerDetail.Places places(String id, int limit) throws SQLException {
        long sampled = 0, underground = 0, surface = 0, withOthers = 0;
        try (PreparedStatement ps = prepare("SELECT COALESCE(SUM(interval_ms), 0), "
                + "COALESCE(SUM(CASE WHEN underground = 1 THEN interval_ms END), 0), "
                + "COALESCE(SUM(CASE WHEN underground = 0 THEN interval_ms END), 0), "
                + "COALESCE(SUM(CASE WHEN nearby_count > 0 THEN interval_ms END), 0) "
                + "FROM position_samples WHERE player_uuid = ?", id);
             ResultSet rs = ps.executeQuery()) {
            if (rs.next()) {
                sampled = rs.getLong(1);
                underground = rs.getLong(2);
                surface = rs.getLong(3);
                withOthers = rs.getLong(4);
            }
        }
        String time = "SUM(interval_ms) AS t FROM position_samples WHERE player_uuid = ?";
        List<CountEntry> worlds = counts("SELECT world, " + time + " GROUP BY world ORDER BY t DESC", id);
        List<CountEntry> biomes = counts("SELECT biome, " + time
                + " AND biome IS NOT NULL GROUP BY biome ORDER BY t DESC LIMIT ?", id, limit);
        List<CountEntry> vehicles = counts("SELECT vehicle, " + time
                + " AND vehicle IS NOT NULL GROUP BY vehicle ORDER BY t DESC LIMIT ?", id, limit);
        // nearby is een JSON-array met UUIDs; de naam is die van het laatste event van die speler
        List<CountEntry> companions = counts("""
                SELECT COALESCE((SELECT e.player_name FROM events e WHERE e.player_uuid = j.value
                                 ORDER BY e.created_at DESC LIMIT 1), j.value) AS name,
                       SUM(p.interval_ms) AS t
                FROM position_samples p, json_each(p.nearby) j
                WHERE p.player_uuid = ? AND p.nearby IS NOT NULL
                GROUP BY j.value ORDER BY t DESC LIMIT ?""", id, limit);
        return new PlayerDetail.Places(sampled, underground, surface, withOthers, worlds, biomes, vehicles, companions);
    }

    @Override
    public CompletableFuture<List<ChunkHeat>> getBlockBreakHeatmap(UUID player) {
        // Chunk = floor(x / 16). Met pure integer-rekenkunde, zodat negatieve
        // coördinaten ook goed gaan (SQLite deelt richting nul af).
        String chunkX = "((x - (((x % 16) + 16) % 16)) / 16)";
        String chunkZ = "((z - (((z % 16) + 16) % 16)) / 16)";
        String sql = "SELECT world, " + chunkX + " AS cx, " + chunkZ + " AS cz, COUNT(*), MIN(y), MAX(y) "
                + BREAKS + " AND x IS NOT NULL" + (player != null ? " AND player_uuid = ?" : "")
                + " GROUP BY world, cx, cz";
        return query(() -> {
            List<ChunkHeat> result = new ArrayList<>();
            try (PreparedStatement ps = player != null ? prepare(sql, player.toString()) : prepare(sql);
                 ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    result.add(new ChunkHeat(rs.getString(1), rs.getInt(2), rs.getInt(3),
                            rs.getLong(4), rs.getInt(5), rs.getInt(6)));
                }
            }
            return result;
        });
    }

    /** Duur van een sessie; bij een lopende sessie tot de laatste tussenstand. */
    private static final String SESSION_DURATION = "(COALESCE(ended_at, last_seen_at) - started_at)";

    /** {@code SUM(CASE ...)} die events van één type telt. */
    private static String countType(String type, String alias) {
        return "SUM(CASE WHEN e.type = '" + type + "' THEN 1 ELSE 0 END) AS " + alias;
    }

    /**
     * Eén rij per speler: aantallen per soort event, het laatste event van welk type dan ook,
     * en speeltijd/AFK/sessies uit de sessions-tabel.
     * SQLite neemt bij één MAX() de "kale" kolom player_name uit dezelfde rij, dus dit is
     * de naam waarmee de speler het laatst actief was.
     */
    private static String playerSummarySql(boolean singlePlayer) {
        return "SELECT e.player_uuid, e.player_name, "
                + countType(EventTypes.BLOCK_BREAK, "total") + ", "
                + countType(EventTypes.BLOCK_PLACE, "placed") + ", "
                + countType(EventTypes.MOB_KILL, "mob_kills") + ", "
                + countType(EventTypes.PVP_KILL, "pvp_kills") + ", "
                + countType(EventTypes.DEATH, "deaths") + ", "
                + "MAX(e.created_at), "
                + "COALESCE(s.playtime, 0) AS playtime, COALESCE(s.afk, 0), COALESCE(s.cnt, 0) "
                + "FROM events e LEFT JOIN ("
                + "  SELECT player_uuid, SUM(" + SESSION_DURATION + ") AS playtime, SUM(afk_ms) AS afk, COUNT(*) AS cnt "
                + "  FROM sessions GROUP BY player_uuid"
                + ") s ON s.player_uuid = e.player_uuid "
                + "WHERE e.player_uuid IS NOT NULL"
                + (singlePlayer ? " AND e.player_uuid = ?" : "")
                + " GROUP BY e.player_uuid";
    }

    // ---------- Hulpmethodes ----------

    @FunctionalInterface
    private interface SqlWork<T> {
        T run() throws SQLException;
    }

    /** Voert een leesquery uit op de DB-thread, na het wegschrijven van de wachtrij. */
    private <T> CompletableFuture<T> query(SqlWork<T> work) {
        return CompletableFuture.supplyAsync(() -> {
            flushNow();
            try {
                return work.run();
            } catch (SQLException e) {
                throw new RuntimeException(e);
            }
        }, executor);
    }

    /** Aantal events van een type, voor één speler of ({@code player == null}) iedereen. */
    private long countOf(String type, String player) throws SQLException {
        return player == null
                ? single("SELECT COUNT(*) FROM events WHERE type = ?", type)
                : single("SELECT COUNT(*) FROM events WHERE type = ? AND player_uuid = ?", type, player);
    }

    /** Meest voorkomende subtypes van een type, voor één speler of ({@code player == null}) iedereen. */
    private List<CountEntry> topSubtypes(String type, String player, int limit) throws SQLException {
        return player == null
                ? counts("SELECT subtype, COUNT(*) AS n FROM events WHERE type = ? "
                        + "GROUP BY subtype ORDER BY n DESC LIMIT ?", type, limit)
                : counts("SELECT subtype, COUNT(*) AS n FROM events WHERE type = ? AND player_uuid = ? "
                        + "GROUP BY subtype ORDER BY n DESC LIMIT ?", type, player, limit);
    }

    /** Als {@link #topSubtypes}, maar telt {@code value} op (aantal items, levenspunten) in plaats van rijen. */
    private List<CountEntry> topValues(String type, String player, int limit) throws SQLException {
        return counts("SELECT subtype, ROUND(SUM(value)) AS n FROM events WHERE type = ? AND player_uuid = ? "
                + "GROUP BY subtype ORDER BY n DESC LIMIT ?", type, player, limit);
    }

    private long single(String sql, Object... params) throws SQLException {
        try (PreparedStatement ps = prepare(sql, params); ResultSet rs = ps.executeQuery()) {
            return rs.next() ? rs.getLong(1) : 0;
        }
    }

    private List<CountEntry> counts(String sql, Object... params) throws SQLException {
        List<CountEntry> result = new ArrayList<>();
        try (PreparedStatement ps = prepare(sql, params); ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                result.add(new CountEntry(rs.getString(1), rs.getLong(2)));
            }
        }
        return result;
    }

    private List<PlayerSummary> summaries(String sql, Object... params) throws SQLException {
        List<PlayerSummary> result = new ArrayList<>();
        try (PreparedStatement ps = prepare(sql, params); ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                result.add(new PlayerSummary(rs.getString(1), rs.getString(2),
                        rs.getLong(3), rs.getLong(4), rs.getLong(5), rs.getLong(6), rs.getLong(7),
                        rs.getLong(8), rs.getLong(9), rs.getLong(10), rs.getLong(11)));
            }
        }
        return result;
    }

    private PreparedStatement prepare(String sql, Object... params) throws SQLException {
        PreparedStatement ps = connection.prepareStatement(sql);
        for (int i = 0; i < params.length; i++) {
            ps.setObject(i + 1, params[i]);
        }
        return ps;
    }

    /** Schrijft alles weg en sluit de database. Blokkeert maximaal 10 seconden. */
    @Override
    public void close() {
        executor.execute(() -> {
            flushNow();
            try {
                if (connection != null) {
                    connection.close();
                }
            } catch (SQLException e) {
                logger.log(Level.WARNING, "Fout bij sluiten van de database", e);
            }
        });
        executor.shutdown();
        try {
            if (!executor.awaitTermination(10, TimeUnit.SECONDS)) {
                logger.warning("Database sloot niet binnen 10 seconden; mogelijk is er data verloren.");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
