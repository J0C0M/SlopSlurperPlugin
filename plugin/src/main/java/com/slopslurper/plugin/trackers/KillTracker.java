package com.slopslurper.plugin.trackers;

import com.slopslurper.plugin.storage.EventTypes;
import com.slopslurper.plugin.storage.GameEvent;
import org.bukkit.Location;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.entity.EntityDeathEvent;

/**
 * Mobs en spelers die door een speler gedood worden.
 *
 * <ul>
 *     <li>{@code mob_kill}: subtype = mobtype, item = wapen, plek = waar de mob stierf.</li>
 *     <li>{@code pvp_kill}: subtype = naam van het slachtoffer, meta.victim = zijn UUID.</li>
 * </ul>
 * {@code getKiller()} is de speler die het slachtoffer kort voor zijn dood raakte, ook met
 * pijl en boog. Sterft een mob zonder speler (lava, een andere mob), dan is hij {@code null}
 * en tellen we niks. Armor stands en andere entities die geen mob zijn, slaan we over.
 */
public final class KillTracker extends EventTracker {

    @Override
    public String id() {
        return "kills";
    }

    @Override
    public String description() {
        return "gedode mobs en PvP";
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDeath(EntityDeathEvent event) {
        LivingEntity victim = event.getEntity();
        Player killer = victim.getKiller();
        if (killer == null) {
            return;
        }

        if (victim instanceof Player target) {
            if (target.getUniqueId().equals(killer.getUniqueId())) {
                return; // eigen pijl of TNT: dat is een dood, geen PvP-kill
            }
            record(GameEvent.of(EventTypes.PVP_KILL, killer)
                    .subtype(target.getName())
                    .at(target.getLocation())
                    .meta("victim", target.getUniqueId().toString())
                    .meta("distance", distance(killer.getLocation(), target.getLocation()))
                    .build());
        } else if (victim instanceof Mob) {
            record(GameEvent.of(EventTypes.MOB_KILL, killer)
                    .subtype(victim.getType())
                    .at(victim.getLocation())
                    .meta("distance", distance(killer.getLocation(), victim.getLocation()))
                    .build());
        }
    }

    /** Afstand op één decimaal, of {@code null} als ze in verschillende werelden zijn. */
    private static Double distance(Location a, Location b) {
        if (a.getWorld() == null || !a.getWorld().equals(b.getWorld())) {
            return null;
        }
        return Math.round(a.distance(b) * 10) / 10.0;
    }
}
