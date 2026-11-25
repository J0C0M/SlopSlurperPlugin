package com.slopslurper.plugin.trackers;

import com.slopslurper.plugin.storage.EventTypes;
import com.slopslurper.plugin.storage.GameEvent;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeInstance;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityRegainHealthEvent;
import org.bukkit.event.player.PlayerItemConsumeEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.scheduler.BukkitTask;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Schade, genezing en eten.
 *
 * Schade en genezing komen heel vaak voor. Daarom tellen we ze per speler op in het geheugen
 * en schrijven we elke {@code flush-seconds} (en bij uitloggen of afsluiten) één totaal per
 * soort weg. Eten is zeldzaam en wordt los vastgelegd.
 *
 * Alle schade is in levenspunten (2 = één hart), na armor en dergelijke, en nooit meer dan
 * het slachtoffer nog had. Anders zou /kill of de void de totalen onbruikbaar maken.
 */
public final class HealthTracker extends EventTracker {

    private record Key(String type, String subtype, Material item) {
    }

    private static final class Total {
        double amount;
        int count;
    }

    private final Map<UUID, Map<Key, Total>> totals = new HashMap<>();
    private BukkitTask task;

    @Override
    public String id() {
        return "health";
    }

    @Override
    public String description() {
        return "schade, genezing en eten";
    }

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

    /** Vangt ook EntityDamageByEntityEvent: die gebruikt dezelfde handlers. */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDamage(EntityDamageEvent event) {
        if (!(event.getEntity() instanceof LivingEntity victim)) {
            return;
        }
        double damage = Math.min(event.getFinalDamage(), victim.getHealth());
        if (damage <= 0) {
            return; // bijv. met een schild geblokt
        }
        if (victim instanceof Player player) {
            add(player, EventTypes.DAMAGE_TAKEN, DeathTracker.causeOf(event.getDamageSource(), player), null, damage);
        }
        // De causing entity is ook bij een pijl of TNT de speler zelf
        if ((victim instanceof Mob || victim instanceof Player)
                && event.getDamageSource().getCausingEntity() instanceof Player attacker
                && !attacker.getUniqueId().equals(victim.getUniqueId())) {
            add(attacker, EventTypes.DAMAGE_DEALT, victim.getType().name(),
                    attacker.getInventory().getItemInMainHand().getType(), damage);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onRegain(EntityRegainHealthEvent event) {
        if (!(event.getEntity() instanceof Player player)) {
            return;
        }
        AttributeInstance max = player.getAttribute(Attribute.MAX_HEALTH);
        double room = max == null ? event.getAmount() : max.getValue() - player.getHealth();
        double healed = Math.min(event.getAmount(), room);
        if (healed > 0) {
            add(player, EventTypes.HEAL, event.getRegainReason().name(), null, healed);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onConsume(PlayerItemConsumeEvent event) {
        Material food = event.getItem().getType();
        if (!food.isEdible()) {
            return; // drankjes en melk
        }
        Player player = event.getPlayer();
        record(GameEvent.of(EventTypes.EAT, player)
                .subtype(food)
                .item(food)
                .meta("food_level", player.getFoodLevel())
                .build());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) {
        flush(event.getPlayer(), totals.remove(event.getPlayer().getUniqueId()));
    }

    private void add(Player player, String type, String subtype, Material item, double amount) {
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
                .world(player.getWorld().getName()) // een totaal heeft geen plek
                .item(key.item())
                .value(Math.round(total.amount * 100) / 100.0)
                .meta("count", total.count)
                .build()));
    }
}
