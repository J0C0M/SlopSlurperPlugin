package com.slopslurper.plugin.trackers;

import com.slopslurper.plugin.storage.EventTypes;
import com.slopslurper.plugin.storage.GameEvent;
import org.bukkit.Bukkit;
import org.bukkit.Statistic;
import org.bukkit.damage.DamageSource;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.ItemStack;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Elke keer dat een speler doodgaat, met de oorzaak.
 *
 * subtype is wat je in een top-lijst wilt zien: het type van de dader als die er is
 * ({@code ZOMBIE}, {@code CREEPER}, {@code PLAYER}; ook bij een pijl van een skelet),
 * anders het schadetype ({@code FALL}, {@code LAVA}, {@code DROWN}, ...).
 * Zie {@link EventTypes#DEATH} voor de meta-velden.
 */
public final class DeathTracker extends EventTracker {

    /** Wanneer elke online speler inlogde, voor "tijd sinds inloggen". */
    private final Map<UUID, Long> joinedAt = new HashMap<>();

    @Override
    public String id() {
        return "deaths";
    }

    @Override
    public String description() {
        return "doodgaan en doodsoorzaken";
    }

    @Override
    protected void onStart(TrackerContext context) {
        long now = System.currentTimeMillis();
        for (Player player : Bukkit.getOnlinePlayers()) {
            joinedAt.put(player.getUniqueId(), now);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onJoin(PlayerJoinEvent event) {
        joinedAt.put(event.getPlayer().getUniqueId(), System.currentTimeMillis());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) {
        joinedAt.remove(event.getPlayer().getUniqueId());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDeath(PlayerDeathEvent event) {
        Player player = event.getPlayer();
        DamageSource source = event.getDamageSource();
        String damageType = source.getDamageType().getKey().getKey();
        Entity causing = source.getCausingEntity();
        boolean byOther = causing != null && !causing.getUniqueId().equals(player.getUniqueId());
        String cause = byOther ? causing.getType().name() : damageType.toUpperCase(Locale.ROOT);

        int itemsLost = event.getKeepInventory() ? 0
                : event.getDrops().stream().mapToInt(ItemStack::getAmount).sum();
        // TIME_SINCE_DEATH telt in ticks, alleen terwijl de speler online is, en wordt pas
        // na dit event op 0 gezet. Bij de eerste dood is het de speeltijd sinds de eerste join.
        long aliveMs = player.getStatistic(Statistic.TIME_SINCE_DEATH) * 50L;
        long now = System.currentTimeMillis();
        Long joined = joinedAt.get(player.getUniqueId());

        GameEvent.Builder builder = GameEvent.of(EventTypes.DEATH, player)
                .subtype(cause)
                .meta("damage_type", damageType)
                .meta("items_lost", itemsLost)
                .meta("level", player.getLevel())
                .meta("keep_inventory", event.getKeepInventory())
                .meta("alive_ms", aliveMs)
                .meta("session_ms", joined != null ? now - joined : null);
        if (byOther && causing instanceof Player killer) {
            builder.meta("killer", killer.getName()).meta("killer_uuid", killer.getUniqueId().toString());
        }
        record(builder.time(now).build());
    }
}
