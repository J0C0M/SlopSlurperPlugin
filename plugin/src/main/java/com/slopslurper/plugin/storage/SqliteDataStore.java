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
 * Alles staat in één generieke {@code events}-tabel (zie {@link SqliteMigrations});
 * {@link EventTypes} bevat de mogelijke waarden van {@code type}.
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
    public void flushAsync() {
        if (!pending.isEmpty() || !pendingSessions.isEmpty()) {
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

    private void flushNow() {
        List<GameEvent> batch = new ArrayList<>();
        GameEvent e;
        while ((e = pending.poll()) != null) {
            batch.add(e);
        }
        List<SessionRecord> sessions = new ArrayList<>();
        SessionRecord s;
        while ((s = pendingSessions.poll()) != null) {
            sessions.add(s);
        }
        if ((batch.isEmpty() && sessions.isEmpty()) || connection == null) {
            return;
        }

        String sql = "INSERT INTO events (type, player_uuid, player_name, subtype, world, x, y, z, "
                + "item, game_mode, value, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
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
            try (PreparedStatement ps = connection.prepareStatement(sql)) {
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
            connection.commit();
        } catch (SQLException ex) {
            logger.log(Level.SEVERE, "Kon " + batch.size() + " events en " + sessions.size() + " sessies niet opslaan", ex);
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
            long total = single("SELECT COUNT(*) " + BREAKS + " AND player_uuid = ?", id);
            List<BlockStats.Entry> top = counts(
                    "SELECT subtype, COUNT(*) AS n " + BREAKS + " AND player_uuid = ? GROUP BY subtype ORDER BY n DESC LIMIT ?",
                    id, limit).stream().map(c -> new BlockStats.Entry(c.key(), c.amount())).toList();
            return new BlockStats(total, top);
        });
    }

    @Override
    public CompletableFuture<Overview> getOverview(int limit) {
        return query(() -> {
            long total = single("SELECT COUNT(*) " + BREAKS);
            long players = single("SELECT COUNT(DISTINCT player_uuid) FROM events WHERE player_uuid IS NOT NULL");
            long playtime = single("SELECT COALESCE(SUM(" + SESSION_DURATION + "), 0) FROM sessions");
            long afk = single("SELECT COALESCE(SUM(afk_ms), 0) FROM sessions");
            List<CountEntry> topBlocks = counts(
                    "SELECT subtype, COUNT(*) AS n " + BREAKS + " GROUP BY subtype ORDER BY n DESC LIMIT ?", limit);
            List<PlayerSummary> topPlayers = summaries(playerSummarySql(false) + " ORDER BY playtime DESC, total DESC LIMIT ?", limit);
            return new Overview(total, players, playtime, afk, topBlocks, topPlayers);
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
            List<CountEntry> blocks = counts(
                    "SELECT subtype, COUNT(*) AS n " + BREAKS + " AND player_uuid = ? GROUP BY subtype ORDER BY n DESC LIMIT ?",
                    id, limit);
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
            return Optional.of(new PlayerDetail(found.get(0), blocks, tools, worlds, activity, recent));
        });
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

    /**
     * Eén rij per speler: aantal gebroken blokken, het laatste event van welk type dan ook,
     * en speeltijd/AFK/sessies uit de sessions-tabel.
     * SQLite neemt bij één MAX() de "kale" kolom player_name uit dezelfde rij, dus dit is
     * de naam waarmee de speler het laatst actief was.
     */
    private static String playerSummarySql(boolean singlePlayer) {
        return "SELECT e.player_uuid, e.player_name, "
                + "SUM(CASE WHEN e.type = '" + EventTypes.BLOCK_BREAK + "' THEN 1 ELSE 0 END) AS total, "
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
                result.add(new PlayerSummary(rs.getString(1), rs.getString(2), rs.getLong(3), rs.getLong(4),
                        rs.getLong(5), rs.getLong(6), rs.getLong(7)));
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
