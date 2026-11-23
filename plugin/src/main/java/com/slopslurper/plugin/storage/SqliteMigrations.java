package com.slopslurper.plugin.storage;

import java.io.File;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.logging.Logger;

/**
 * Schemamigraties voor de SQLite-database.
 *
 * Elke database onthoudt in {@code schema_version} welke migraties al gedraaid hebben.
 * Bij het opstarten worden alleen de nieuwe uitgevoerd, elk in een eigen transactie.
 * Zo werken bestaande {@code data.db}-bestanden van teamgenoten automatisch bij.
 *
 * <b>Regels:</b> pas een bestaande migratie nooit meer aan nadat hij gecommit is
 * (bij anderen heeft hij dan al gedraaid). Voeg altijd een nieuwe toe onderaan de lijst,
 * met het volgende versienummer.
 */
final class SqliteMigrations {

    @FunctionalInterface
    interface Step {
        void apply(Statement st) throws SQLException;
    }

    record Migration(int version, String description, Step step) {
    }

    static final List<Migration> MIGRATIONS = List.of(
            new Migration(1, "block_breaks-tabel (oorspronkelijk schema)", st -> {
                // Bestond al vóór er migraties waren; voor nieuwe databases hier aangemaakt,
                // zodat migratie 2 voor iedereen hetzelfde startpunt heeft.
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
            }),

            new Migration(2, "generieke events-tabel; block_breaks daarheen verhuisd", st -> {
                st.execute("""
                        CREATE TABLE events (
                            id          INTEGER PRIMARY KEY AUTOINCREMENT,
                            type        TEXT    NOT NULL,
                            player_uuid TEXT,
                            player_name TEXT,
                            subtype     TEXT,
                            world       TEXT,
                            x           INTEGER,
                            y           INTEGER,
                            z           INTEGER,
                            item        TEXT,
                            game_mode   TEXT,
                            value       REAL    NOT NULL DEFAULT 1,
                            meta        TEXT,
                            created_at  INTEGER NOT NULL
                        )""");
                st.execute("CREATE INDEX idx_events_type_player ON events(type, player_uuid, subtype)");
                st.execute("CREATE INDEX idx_events_player_time ON events(player_uuid, created_at)");
                st.execute("CREATE INDEX idx_events_time ON events(created_at)");
                st.execute("""
                        INSERT INTO events (type, player_uuid, player_name, subtype, world, x, y, z,
                                            item, game_mode, value, created_at)
                        SELECT 'block_break', player_uuid, player_name, block_type, world, x, y, z,
                               tool, game_mode, 1, broken_at
                        FROM block_breaks ORDER BY id""");
                st.execute("DROP TABLE block_breaks");
            }),

            new Migration(3, "sessions-tabel (speeltijd en AFK)", st -> {
                // Eén rij per sessie (join tot quit). last_seen_at wordt elke minuut bijgewerkt,
                // zodat na een crash bekend is tot wanneer de sessie ongeveer liep.
                st.execute("""
                        CREATE TABLE sessions (
                            id           TEXT    PRIMARY KEY,
                            player_uuid  TEXT    NOT NULL,
                            player_name  TEXT    NOT NULL,
                            started_at   INTEGER NOT NULL,
                            last_seen_at INTEGER NOT NULL,
                            ended_at     INTEGER,
                            afk_ms       INTEGER NOT NULL DEFAULT 0,
                            end_reason   TEXT
                        )""");
                st.execute("CREATE INDEX idx_sessions_player ON sessions(player_uuid, started_at)");
            }),

            new Migration(4, "position_samples-tabel (waar spelers zijn, biome, wie in de buurt)", st -> {
                // Elke paar seconden één rij per online speler. interval_ms = hoeveel speeltijd
                // de rij vertegenwoordigt, zodat SUM(interval_ms) de tijd geeft.
                // underground: 1/0, NULL in werelden zonder lucht. nearby: JSON-array met UUIDs.
                st.execute("""
                        CREATE TABLE position_samples (
                            id           INTEGER PRIMARY KEY AUTOINCREMENT,
                            player_uuid  TEXT    NOT NULL,
                            world        TEXT    NOT NULL,
                            x            INTEGER NOT NULL,
                            y            INTEGER NOT NULL,
                            z            INTEGER NOT NULL,
                            biome        TEXT,
                            underground  INTEGER,
                            vehicle      TEXT,
                            game_mode    TEXT,
                            nearby_count INTEGER NOT NULL DEFAULT 0,
                            nearby       TEXT,
                            interval_ms  INTEGER NOT NULL,
                            created_at   INTEGER NOT NULL
                        )""");
                st.execute("CREATE INDEX idx_positions_player_time ON position_samples(player_uuid, created_at)");
                st.execute("CREATE INDEX idx_positions_world ON position_samples(world, x, z)");
            })
    );

    private SqliteMigrations() {
    }

    /** Voert alle nog niet gedraaide migraties uit. */
    static void migrate(Connection connection, File dbFile, Logger logger) throws SQLException {
        try (Statement st = connection.createStatement()) {
            st.execute("""
                    CREATE TABLE IF NOT EXISTS schema_version (
                        version     INTEGER PRIMARY KEY,
                        description TEXT    NOT NULL,
                        applied_at  INTEGER NOT NULL
                    )""");
        }

        int current = currentVersion(connection);
        List<Migration> pending = MIGRATIONS.stream().filter(m -> m.version() > current).toList();
        if (pending.isEmpty()) {
            return;
        }

        if (hasUserData(connection)) {
            backup(connection, dbFile, current, logger);
        }

        for (Migration m : pending) {
            logger.info("Database-migratie " + m.version() + ": " + m.description());
            connection.setAutoCommit(false);
            try (Statement st = connection.createStatement()) {
                m.step().apply(st);
                try (PreparedStatement ps = connection.prepareStatement(
                        "INSERT INTO schema_version (version, description, applied_at) VALUES (?, ?, ?)")) {
                    ps.setInt(1, m.version());
                    ps.setString(2, m.description());
                    ps.setLong(3, System.currentTimeMillis());
                    ps.executeUpdate();
                }
                connection.commit();
            } catch (SQLException e) {
                connection.rollback();
                throw new SQLException("Migratie " + m.version() + " mislukt, database is ongewijzigd", e);
            } finally {
                connection.setAutoCommit(true);
            }
        }
    }

    private static int currentVersion(Connection connection) throws SQLException {
        try (Statement st = connection.createStatement();
             ResultSet rs = st.executeQuery("SELECT COALESCE(MAX(version), 0) FROM schema_version")) {
            return rs.next() ? rs.getInt(1) : 0;
        }
    }

    /** Staat er al data in (andere tabellen dan de interne)? Dan eerst een backup. */
    private static boolean hasUserData(Connection connection) throws SQLException {
        try (Statement st = connection.createStatement();
             ResultSet rs = st.executeQuery("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' "
                     + "AND name NOT IN ('schema_version', 'sqlite_sequence')")) {
            return rs.next() && rs.getInt(1) > 0;
        }
    }

    /** Consistente kopie via VACUUM INTO, bijv. data.db.backup-v0. */
    private static void backup(Connection connection, File dbFile, int version, Logger logger) throws SQLException {
        File target = new File(dbFile.getParentFile(), dbFile.getName() + ".backup-v" + version);
        if (target.exists()) {
            target = new File(dbFile.getParentFile(), dbFile.getName() + ".backup-v" + version + "-" + System.currentTimeMillis());
        }
        try (PreparedStatement ps = connection.prepareStatement("VACUUM INTO ?")) {
            ps.setString(1, target.getAbsolutePath());
            ps.execute();
        }
        logger.info("Backup van de database vóór migratie: " + target.getName());
    }
}
