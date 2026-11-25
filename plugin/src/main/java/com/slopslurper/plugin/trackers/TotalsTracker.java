package com.slopslurper.plugin.trackers;

import com.slopslurper.plugin.storage.GameEvent;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.scheduler.BukkitTask;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Basis voor trackers van dingen die heel vaak gebeuren. Met {@link #add} tel je ze per speler
 * op in het geheugen; elke {@code flush-seconds} (en bij uitloggen of afsluiten) gaat er één
 * event per soort naar de opslag, met het totaal in {@code value} en het aantal keer in
 * {@code meta.count}. Zo'n totaal heeft geen plek.
 */
public abstract class TotalsTracker extends EventTracker {

    private record Key(String type, String subtype, Material item) {
    }

    private static final class Total {
        double amount;
        int count;
    }

    private final Map<UUID, Map<Key, Total>> totals = new HashMap<>();
    private BukkitTask task;

    @Override
    protected void onStart(TrackerContext context) {
        long ticks = Math.max(1, context.intSetting("flush-seconds", 60)) * 20L;
        task = Bukkit.getScheduler().runTaskTimer(context.plugin(), this::flushAll, ticks, ticks);
    }

    @Override
    protected void onStop() {
        if (task != null) {
            task.cancel();
        }
        flushAll();
    }

    /** Public, omdat Bukkit anders handlers uit een superklasse niet vindt. */
    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) {
        flush(event.getPlayer(), totals.remove(event.getPlayer().getUniqueId()));
    }

    /** @param item apart optellen per item (bijv. wapen), of {@code null} */
    protected void add(Player player, String type, String subtype, Material item, double amount) {
        Total total = totals.computeIfAbsent(player.getUniqueId(), u -> new HashMap<>())
                .computeIfAbsent(new Key(type, subtype, item), k -> new Total());
        total.amount += amount;
        total.count++;
    }

    private void flushAll() {
        for (Map.Entry<UUID, Map<Key, Total>> entry : totals.entrySet()) {
            Player player = Bukkit.getPlayer(entry.getKey());
            if (player != null) {
                flush(player, entry.getValue());
            }
        }
        totals.clear();
    }

    private void flush(Player player, Map<Key, Total> perKey) {
        if (perKey == null) {
            return;
        }
        perKey.forEach((key, total) -> record(GameEvent.of(key.type(), player)
                .subtype(key.subtype())
                .world(player.getWorld().getName())
                .item(key.item())
                .value(Math.round(total.amount * 100) / 100.0)
                .meta("count", total.count)
                .build()));
    }
}
