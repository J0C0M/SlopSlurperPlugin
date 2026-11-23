package com.slopslurper.plugin.trackers;

import com.slopslurper.plugin.storage.EventTypes;
import com.slopslurper.plugin.storage.GameEvent;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.block.BlockBreakEvent;

/**
 * Slaat elk blok op dat een speler breekt.
 *
 * MONITOR + ignoreCancelled: we registreren pas als alle andere plugins klaar zijn
 * en alleen als de breuk echt doorgaat (bijv. niet in spawn protection).
 */
public final class BlockBreakTracker extends EventTracker {

    @Override
    public String id() {
        return "block-break";
    }

    @Override
    public String description() {
        return "gebroken blokken";
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBlockBreak(BlockBreakEvent event) {
        record(GameEvent.of(EventTypes.BLOCK_BREAK, event.getPlayer())
                .subtype(event.getBlock().getType())
                .at(event.getBlock())
                .build());
    }
}
