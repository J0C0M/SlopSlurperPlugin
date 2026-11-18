package com.slopslurper.plugin;

import org.bukkit.plugin.java.JavaPlugin;

public final class SlopSlurperPlugin extends JavaPlugin {

    @Override
    public void onEnable() {
        getLogger().info("SlopSlurperPlugin is aan. Klaar om spelersdata te verzamelen.");
    }

    @Override
    public void onDisable() {
        getLogger().info("SlopSlurperPlugin is uit.");
    }
}
