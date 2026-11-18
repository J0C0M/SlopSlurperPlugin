package com.slopslurper.plugin;

import com.slopslurper.plugin.commands.BlockStatsCommand;
import com.slopslurper.plugin.integrations.BlueMapHeatmap;
import com.slopslurper.plugin.listeners.PlayerJoinListener;
import com.slopslurper.plugin.storage.DataStore;
import com.slopslurper.plugin.storage.SqliteDataStore;
import com.slopslurper.plugin.trackers.TrackerManager;
import com.slopslurper.plugin.web.WebServer;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.logging.Level;

public final class SlopSlurperPlugin extends JavaPlugin {

    /** Hoe vaak de wachtrij naar de database wordt geschreven (20 ticks = 1 seconde). */
    private static final long FLUSH_INTERVAL_TICKS = 20L * 5;

    private DataStore database;
    private TrackerManager trackers;
    private WebServer webServer;
    private BlueMapHeatmap blueMapHeatmap;
    private boolean blueMapPresent;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        // Nieuwe instellingen (bijv. van een nieuwe tracker) aanvullen in een bestaande config.yml
        getConfig().options().copyDefaults(true);
        saveConfig();

        database = new SqliteDataStore(getDataFolder(), getLogger());
        try {
            database.open();
        } catch (Exception e) {
            getLogger().log(Level.SEVERE, "Kon de database niet openen, plugin wordt uitgeschakeld", e);
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        getServer().getPluginManager().registerEvents(new PlayerJoinListener(this), this);

        trackers = new TrackerManager(this, database);
        trackers.startAll();

        BlockStatsCommand blockStats = new BlockStatsCommand(this, database);
        getCommand("blockstats").setExecutor(blockStats);
        getCommand("blockstats").setTabCompleter(blockStats);

        getServer().getScheduler().runTaskTimer(this, database::flushAsync, FLUSH_INTERVAL_TICKS, FLUSH_INTERVAL_TICKS);

        // BlueMap is optioneel. BlueMapHeatmap pas aanmaken (en dus de klasse laden)
        // als de plugin er echt is, anders krijg je een NoClassDefFoundError.
        blueMapPresent = getServer().getPluginManager().getPlugin("BlueMap") != null;
        if (blueMapPresent) {
            blueMapHeatmap = new BlueMapHeatmap(this, database);
            blueMapHeatmap.start();
        }

        startDashboard();

        getLogger().info("SlopSlurperPlugin is aan. Klaar om spelersdata te verzamelen.");
    }

    private void startDashboard() {
        if (!getConfig().getBoolean("dashboard.enabled", true)) {
            return;
        }
        String host = getConfig().getString("dashboard.host", "127.0.0.1");
        int port = getConfig().getInt("dashboard.port", 8080);
        String blueMapUrl = blueMapPresent ? getConfig().getString("dashboard.bluemap-url", "http://localhost:8100/") : null;
        webServer = new WebServer(database, getLogger(), host, port, blueMapUrl);
        try {
            webServer.start();
            getLogger().info("Dashboard draait op " + webServer.url());
        } catch (Exception e) {
            // De plugin blijft werken; alleen het dashboard is dan niet beschikbaar
            getLogger().log(Level.SEVERE, "Kon het dashboard niet starten op " + host + ":" + port
                    + " (is de poort al in gebruik? Pas dashboard.port aan in config.yml)", e);
            webServer = null;
        }
    }

    @Override
    public void onDisable() {
        // Eerst trackers stoppen (die kunnen nog laatste events wegschrijven), dan pas de database
        if (trackers != null) {
            trackers.stopAll();
        }
        if (webServer != null) {
            webServer.stop();
        }
        if (blueMapHeatmap != null) {
            blueMapHeatmap.stop();
        }
        if (database != null) {
            database.close();
        }
        getLogger().info("SlopSlurperPlugin is uit.");
    }
}
