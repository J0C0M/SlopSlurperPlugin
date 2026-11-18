package com.slopslurper.plugin.listeners;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Eerste stap richting spelersdata: logt wie er joint en begroet de speler.
 */
public final class PlayerJoinListener implements Listener {

    private final JavaPlugin plugin;

    public PlayerJoinListener(JavaPlugin plugin) {
        this.plugin = plugin;
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();

        plugin.getLogger().info(player.getName() + " (" + player.getUniqueId() + ") is gejoind"
                + (player.hasPlayedBefore() ? "." : " voor het eerst."));

        player.sendMessage(Component.text("Welkom, " + player.getName() + "! SlopSlurper houdt bij waar je je tijd aan besteedt.",
                NamedTextColor.GOLD));
    }
}
