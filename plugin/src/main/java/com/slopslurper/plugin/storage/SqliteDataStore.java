package com.slopslurper.plugin.storage;

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
 */
public final class SqliteDataStore implements DataStore {

    private final File file;
    private final Logger logger;
    private final ExecutorService executor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "SlopSlurper-DB");
        t.setDaemon(true);
        return t;
    });
    private final Queue<BlockBreakRecord> pendingBreaks = new ConcurrentLinkedQueue<>();

    private Connection connection;

    public SqliteDataStore(File dataFolder, Logger logger) {
        this.file = new File(dataFolder, "data.db");
        this.logger = logger;
    }

    /** Opent de database en maakt de tabellen aan. Blokkeert tot het klaar is. */
    public void open() throws Exception {
        file.getParentFile().mkdirs();
        executor.submit(() -> {
            connection = DriverManager.getConnection("jdbc:sqlite:" + file.getAbsolutePath());
            try (Statement st = connection.createStatement()) {
                st.execute("PRAGMA journal_mode=WAL");
                st.execute("""
                        CREATE TABLE IF NOT EXISTS block_breaks (
                            id          INTEGER PRIMARY KEY AUTOINCREMENT,
                            player_uuid TEXT    NOT NULL,
                            player_name TEXT    NOT NULL,
                            block_type  TEXT    NOT NULL,
                            world       TEXT    NOT NULL,
                            x           INTEGER NOT NULL,
                            y           INTEGER NOT NULL,
                            z           INTEGER NOT NULL,
                            tool        TEXT    NOT NULL,
                            game_mode   TEXT    NOT NULL,
                            broken_at   INTEGER NOT NULL
                        )""");
                st.execute("CREATE INDEX IF NOT EXISTS idx_block_breaks_player ON block_breaks(player_uuid, block_type)");
                st.execute("CREATE INDEX IF NOT EXISTS idx_block_breaks_time ON block_breaks(broken_at)");
            }
            return null;
        }).get();
    }

    /** Zet een blokbreuk in de wachtrij. Veilig om vanaf de main thread aan te roepen. */
    public void queueBlockBreak(BlockBreakRecord record) {
        pendingBreaks.add(record);
    }

    /** Schrijft de wachtrij weg op de achtergrondthread. */
    public void flushAsync() {
        if (!pendingBreaks.isEmpty()) {
            executor.execute(this::flushNow);
        }
    }

    private void flushNow() {
        List<BlockBreakRecord> batch = new ArrayList<>();
        BlockBreakRecord r;
        while ((r = pendingBreaks.poll()) != null) {
            batch.add(r);
        }
        if (batch.isEmpty() || connection == null) {
            return;
        }

        String sql = "INSERT INTO block_breaks (player_uuid, player_name, block_type, world, x, y, z, tool, game_mode, broken_at) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        try {
            connection.setAutoCommit(false);
            try (PreparedStatement ps = connection.prepareStatement(sql)) {
                for (BlockBreakRecord b : batch) {
                    ps.setString(1, b.playerUuid().toString());
                    ps.setString(2, b.playerName());
                    ps.setString(3, b.blockType());
                    ps.setString(4, b.world());
                    ps.setInt(5, b.x());
                    ps.setInt(6, b.y());
                    ps.setInt(7, b.z());
                    ps.setString(8, b.tool());
                    ps.setString(9, b.gameMode());
                    ps.setLong(10, b.brokenAt());
                    ps.addBatch();
                }
                ps.executeBatch();
            }
            connection.commit();
        } catch (SQLException e) {
            logger.log(Level.SEVERE, "Kon " + batch.size() + " blokbreuken niet opslaan", e);
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

    /** Totaal aantal gebroken blokken plus de top N bloktypes van een speler. */
    public CompletableFuture<BlockStats> getBlockStats(UUID player, int limit) {
        return CompletableFuture.supplyAsync(() -> {
            flushNow(); // zodat net gebroken blokken ook meetellen
            try {
                long total;
                try (PreparedStatement ps = connection.prepareStatement(
                        "SELECT COUNT(*) FROM block_breaks WHERE player_uuid = ?")) {
                    ps.setString(1, player.toString());
                    try (ResultSet rs = ps.executeQuery()) {
                        total = rs.next() ? rs.getLong(1) : 0;
                    }
                }

                List<BlockStats.Entry> top = new ArrayList<>();
                try (PreparedStatement ps = connection.prepareStatement(
                        "SELECT block_type, COUNT(*) AS amount FROM block_breaks WHERE player_uuid = ? "
                                + "GROUP BY block_type ORDER BY amount DESC LIMIT ?")) {
                    ps.setString(1, player.toString());
                    ps.setInt(2, limit);
                    try (ResultSet rs = ps.executeQuery()) {
                        while (rs.next()) {
                            top.add(new BlockStats.Entry(rs.getString(1), rs.getLong(2)));
                        }
                    }
                }
                return new BlockStats(total, top);
            } catch (SQLException e) {
                throw new RuntimeException(e);
            }
        }, executor);
    }

    @Override
    public CompletableFuture<Overview> getOverview(int limit) {
        return query(() -> {
            long total;
            long players;
            try (Statement st = connection.createStatement();
                 ResultSet rs = st.executeQuery("SELECT COUNT(*), COUNT(DISTINCT player_uuid) FROM block_breaks")) {
                rs.next();
                total = rs.getLong(1);
                players = rs.getLong(2);
            }
            List<CountEntry> topBlocks = counts(
                    "SELECT block_type, COUNT(*) AS n FROM block_breaks GROUP BY block_type ORDER BY n DESC LIMIT ?",
                    limit);
            List<PlayerSummary> topPlayers = summaries(PLAYER_SUMMARY_SQL + " ORDER BY total DESC LIMIT ?", limit);
            return new Overview(total, players, topBlocks, topPlayers);
        });
    }

    @Override
    public CompletableFuture<List<PlayerSummary>> getPlayers() {
        return query(() -> summaries(PLAYER_SUMMARY_SQL + " ORDER BY total DESC"));
    }

    @Override
    public CompletableFuture<Optional<PlayerDetail>> getPlayer(UUID player, int limit, long activitySince) {
        String id = player.toString();
        return query(() -> {
            List<PlayerSummary> found = summaries(
                    "SELECT player_uuid, player_name, COUNT(*) AS total, MAX(broken_at) FROM block_breaks "
                            + "WHERE player_uuid = ? GROUP BY player_uuid", id);
            if (found.isEmpty()) {
                return Optional.empty();
            }
            List<CountEntry> blocks = counts(
                    "SELECT block_type, COUNT(*) AS n FROM block_breaks WHERE player_uuid = ? "
                            + "GROUP BY block_type ORDER BY n DESC LIMIT ?", id, limit);
            List<CountEntry> tools = counts(
                    "SELECT tool, COUNT(*) AS n FROM block_breaks WHERE player_uuid = ? "
                            + "GROUP BY tool ORDER BY n DESC LIMIT ?", id, limit);
            List<CountEntry> worlds = counts(
                    "SELECT world, COUNT(*) AS n FROM block_breaks WHERE player_uuid = ? "
                            + "GROUP BY world ORDER BY n DESC", id);

            List<PlayerDetail.ActivityBucket> activity = new ArrayList<>();
            try (PreparedStatement ps = connection.prepareStatement(
                    "SELECT (broken_at / 3600000) * 3600000 AS hour, COUNT(*) FROM block_breaks "
                            + "WHERE player_uuid = ? AND broken_at >= ? GROUP BY hour ORDER BY hour")) {
                ps.setString(1, id);
                ps.setLong(2, activitySince);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        activity.add(new PlayerDetail.ActivityBucket(rs.getLong(1), rs.getLong(2)));
                    }
                }
            }
            return Optional.of(new PlayerDetail(found.get(0), blocks, tools, worlds, activity));
        });
    }

    /**
     * Eén rij per speler. SQLite neemt bij MAX() de "kale" kolom player_name uit dezelfde rij,
     * dus dit is de naam waarmee de speler het laatst actief was.
     */
    private static final String PLAYER_SUMMARY_SQL =
            "SELECT player_uuid, player_name, COUNT(*) AS total, MAX(broken_at) FROM block_breaks GROUP BY player_uuid";

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
                result.add(new PlayerSummary(rs.getString(1), rs.getString(2), rs.getLong(3), rs.getLong(4)));
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
