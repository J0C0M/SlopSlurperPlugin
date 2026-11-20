package com.slopslurper.plugin.trackers;

import com.slopslurper.plugin.storage.EventTypes;
import com.slopslurper.plugin.storage.GameEvent;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.block.BlockPlaceEvent;

/**
 * Slaat elk blok op dat een speler plaatst, als tegenhanger van {@link BlockBreakTracker}.
 * Zo zie je naast slopen ook bouwen.
 */
public final class BlockPlaceTracker extends EventTracker {

    @Override
    public String id() {
        return "block-place";
    }

    @Override
    public String description() {
        return "geplaatste blokken";
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBlockPlace(BlockPlaceEvent event) {
        record(GameEvent.of(EventTypes.BLOCK_PLACE, event.getPlayer())
                .subtype(event.getBlockPlaced().getType())
                .at(event.getBlockPlaced())
                .build());
    }
}
