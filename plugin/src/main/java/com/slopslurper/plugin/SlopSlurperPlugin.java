package com.slopslurper.plugin;

import com.slopslurper.plugin.commands.BlockStatsCommand;
import com.slopslurper.plugin.listeners.BlockBreakListener;
import com.slopslurper.plugin.listeners.FishingListener;
import com.slopslurper.plugin.listeners.PlayerJoinListener;
import com.slopslurper.plugin.storage.DataStore;
import com.slopslurper.plugin.storage.SqliteDataStore;
import com.slopslurper.plugin.web.WebServer;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.logging.Level;

public final class SlopSlurperPlugin extends JavaPlugin {

    /** Hoe vaak de wachtrij naar de database wordt geschreven (20 ticks = 1 seconde). */
    private static final long FLUSH_INTERVAL_TICKS = 20L * 5;

    private DataStore database;
    private WebServer webServer;

    @Override
    public void onEnable() {
        saveDefaultConfig();

        database = new SqliteDataStore(getDataFolder(), getLogger());
        try {
            database.open();
        } catch (Exception e) {
            getLogger().log(Level.SEVERE, "Kon de database niet openen, plugin wordt uitgeschakeld", e);
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        getServer().getPluginManager().registerEvents(new PlayerJoinListener(this), this);
        getServer().getPluginManager().registerEvents(new BlockBreakListener(database), this);
        getServer().getPluginManager().registerEvents(new FishingListener(database), this);

        BlockStatsCommand blockStats = new BlockStatsCommand(this, database);
        getCommand("blockstats").setExecutor(blockStats);
        getCommand("blockstats").setTabCompleter(blockStats);

        getServer().getScheduler().runTaskTimer(this, database::flushAsync, FLUSH_INTERVAL_TICKS, FLUSH_INTERVAL_TICKS);

        startDashboard();

        getLogger().info("SlopSlurperPlugin is aan. Klaar om spelersdata te verzamelen.");
    }

    private void startDashboard() {
        if (!getConfig().getBoolean("dashboard.enabled", true)) {
            return;
        }
        String host = getConfig().getString("dashboard.host", "127.0.0.1");
        int port = getConfig().getInt("dashboard.port", 8080);
        webServer = new WebServer(database, getLogger(), host, port);
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
        if (webServer != null) {
            webServer.stop();
        }
        if (database != null) {
            database.close();
        }
        getLogger().info("SlopSlurperPlugin is uit.");
    }
}
