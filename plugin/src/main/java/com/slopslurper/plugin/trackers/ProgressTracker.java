package com.slopslurper.plugin.trackers;

import com.slopslurper.plugin.storage.EventTypes;
import com.slopslurper.plugin.storage.GameEvent;
import org.bukkit.NamespacedKey;
import org.bukkit.Statistic;
import org.bukkit.entity.ExperienceOrb;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.player.PlayerAdvancementDoneEvent;
import org.bukkit.event.player.PlayerExpChangeEvent;
import org.bukkit.event.player.PlayerLevelChangeEvent;

/** Verdiende XP per bron (opgeteld), gestegen levels en behaalde advancements. */
public final class ProgressTracker extends TotalsTracker {

    @Override
    public String id() {
        return "progress";
    }

    @Override
    public String description() {
        return "XP, levels en advancements";
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onExp(PlayerExpChangeEvent event) {
        if (event.getAmount() <= 0) {
            return;
        }
        String source = event.getSource() instanceof ExperienceOrb orb ? orb.getSpawnReason().name() : "UNKNOWN";
        add(event.getPlayer(), EventTypes.XP, source, null, event.getAmount());
    }

    /** Alleen omhoog: omlaag is doodgaan of enchanten, en dat staat al ergens anders. */
    @EventHandler(priority = EventPriority.MONITOR)
    public void onLevel(PlayerLevelChangeEvent event) {
        int gained = event.getNewLevel() - event.getOldLevel();
        if (gained <= 0) {
            return;
        }
        record(GameEvent.of(EventTypes.LEVEL, event.getPlayer())
                .subtype(String.valueOf(event.getNewLevel()))
                .value(gained)
                .build());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onAdvancement(PlayerAdvancementDoneEvent event) {
        NamespacedKey key = event.getAdvancement().getKey();
        // Recepten zijn technisch ook advancements, maar zonder weergave
        if (key.getKey().startsWith("recipes/") || event.getAdvancement().getDisplay() == null) {
            return;
        }
        Player player = event.getPlayer();
        long now = System.currentTimeMillis();
        record(GameEvent.of(EventTypes.ADVANCEMENT, player)
                .subtype(key.getNamespace().equals(NamespacedKey.MINECRAFT) ? key.getKey() : key.asString())
                .meta("since_join_ms", Math.max(0, now - player.getFirstPlayed()))
                .meta("playtime_ms", player.getStatistic(Statistic.PLAY_ONE_MINUTE) * 50L) // telt ticks
                .time(now)
                .build());
    }
}
