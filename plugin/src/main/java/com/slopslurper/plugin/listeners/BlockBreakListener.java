package com.slopslurper.plugin.listeners;

import com.slopslurper.plugin.storage.BlockBreakRecord;
import com.slopslurper.plugin.storage.Database;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;

/**
 * Slaat elk blok op dat een speler breekt.
 *
 * MONITOR + ignoreCancelled: we registreren pas als alle andere plugins klaar zijn
 * en alleen als de breuk echt doorgaat (bijv. niet in spawn protection).
 */
public final class BlockBreakListener implements Listener {

    private final Database database;

    public BlockBreakListener(Database database) {
        this.database = database;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBlockBreak(BlockBreakEvent event) {
        Player player = event.getPlayer();
        Block block = event.getBlock();
        Material tool = player.getInventory().getItemInMainHand().getType();

        database.queueBlockBreak(new BlockBreakRecord(
                player.getUniqueId(),
                player.getName(),
                block.getType().name(),
                block.getWorld().getName(),
                block.getX(),
                block.getY(),
                block.getZ(),
                tool.isAir() ? "HAND" : tool.name(),
                player.getGameMode().name(),
                System.currentTimeMillis()
        ));
    }
}
