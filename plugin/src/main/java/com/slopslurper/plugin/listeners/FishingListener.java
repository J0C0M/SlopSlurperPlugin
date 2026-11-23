package com.slopslurper.plugin.listeners;

import com.slopslurper.plugin.storage.DataStore;
import com.slopslurper.plugin.storage.FishingRecord;
import org.bukkit.Location;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Item;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerFishEvent;

/**
 * Slaat vangsten en mislukte pogingen bij het vissen op. Het uitwerpen en binnenhalen
 * zonder resultaat (FISHING, REEL_IN, IN_GROUND, BITE) slaan we over: dat is ruis.
 */
public final class FishingListener implements Listener {

    private final DataStore database;

    public FishingListener(DataStore database) {
        this.database = database;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onFish(PlayerFishEvent event) {
        PlayerFishEvent.State state = event.getState();
        if (state != PlayerFishEvent.State.CAUGHT_FISH
                && state != PlayerFishEvent.State.CAUGHT_ENTITY
                && state != PlayerFishEvent.State.FAILED_ATTEMPT) {
            return;
        }

        Player player = event.getPlayer();
        Entity caught = event.getCaught();
        String what = "NONE";
        if (caught instanceof Item item) {
            what = item.getItemStack().getType().name();
        } else if (caught != null) {
            what = caught.getType().name();
        }
        Location loc = event.getHook().getLocation();

        database.queueFishing(new FishingRecord(
                player.getUniqueId(),
                player.getName(),
                state.name(),
                what,
                loc.getWorld().getName(),
                loc.getBlockX(),
                loc.getBlockY(),
                loc.getBlockZ(),
                event.getExpToDrop(),
                System.currentTimeMillis()
        ));
    }
}
