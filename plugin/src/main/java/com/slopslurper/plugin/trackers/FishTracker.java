package com.slopslurper.plugin.trackers;

import com.slopslurper.plugin.storage.EventTypes;
import com.slopslurper.plugin.storage.GameEvent;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Item;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.player.PlayerFishEvent;

/**
 * Vangsten bij het vissen ({@code fish}): subtype = gevangen item of entity, plek = dobber,
 * meta.xp = verdiende XP. Uitwerpen, beet en binnenhalen zonder vangst slaan we over.
 */
public final class FishTracker extends EventTracker {

    @Override
    public String id() {
        return "fishing";
    }

    @Override
    public String description() {
        return "vangsten bij het vissen";
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onFish(PlayerFishEvent event) {
        PlayerFishEvent.State state = event.getState();
        if (state != PlayerFishEvent.State.CAUGHT_FISH && state != PlayerFishEvent.State.CAUGHT_ENTITY) {
            return;
        }
        Player player = event.getPlayer();
        Entity caught = event.getCaught();
        if (caught == null) {
            return;
        }
        record(GameEvent.of(EventTypes.FISH, player)
                .subtype(caught instanceof Item item ? item.getItemStack().getType() : caught.getType())
                .at(event.getHook().getLocation())
                .meta("xp", event.getExpToDrop())
                .build());
    }
}
