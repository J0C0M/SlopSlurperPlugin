package com.slopslurper.plugin;

import com.slopslurper.plugin.commands.BlockStatsCommand;
import com.slopslurper.plugin.listeners.BlockBreakListener;
import com.slopslurper.plugin.listeners.PlayerJoinListener;
import com.slopslurper.plugin.storage.Database;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.logging.Level;

public final class SlopSlurperPlugin extends JavaPlugin {

    /** Hoe vaak de wachtrij naar de database wordt geschreven (20 ticks = 1 seconde). */
    private static final long FLUSH_INTERVAL_TICKS = 20L * 5;

    private Database database;

    @Override
    public void onEnable() {
        database = new Database(getDataFolder(), getLogger());
        try {
            database.open();
        } catch (Exception e) {
            getLogger().log(Level.SEVERE, "Kon de database niet openen, plugin wordt uitgeschakeld", e);
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        getServer().getPluginManager().registerEvents(new PlayerJoinListener(this), this);
        getServer().getPluginManager().registerEvents(new BlockBreakListener(database), this);

        BlockStatsCommand blockStats = new BlockStatsCommand(this, database);
        getCommand("blockstats").setExecutor(blockStats);
        getCommand("blockstats").setTabCompleter(blockStats);

        getServer().getScheduler().runTaskTimer(this, database::flushAsync, FLUSH_INTERVAL_TICKS, FLUSH_INTERVAL_TICKS);

        getLogger().info("SlopSlurperPlugin is aan. Klaar om spelersdata te verzamelen.");
    }

    @Override
    public void onDisable() {
        if (database != null) {
            database.close();
        }
        getLogger().info("SlopSlurperPlugin is uit.");
    }
}
