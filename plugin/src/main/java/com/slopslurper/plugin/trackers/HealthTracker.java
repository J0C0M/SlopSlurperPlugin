package com.slopslurper.plugin.trackers;

import com.slopslurper.plugin.storage.EventTypes;
import com.slopslurper.plugin.storage.GameEvent;
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

/**
 * Schade, genezing en eten.
 *
 * Schade en genezing komen heel vaak voor en worden daarom opgeteld. Eten is zeldzaam en
 * wordt los vastgelegd.
 *
 * Alle schade is in levenspunten (2 = één hart), na armor en dergelijke, en nooit meer dan
 * het slachtoffer nog had. Anders zou /kill of de void de totalen onbruikbaar maken.
 */
public final class HealthTracker extends TotalsTracker {

    @Override
    public String id() {
        return "health";
    }

    @Override
    public String description() {
        return "schade, genezing en eten";
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
}
