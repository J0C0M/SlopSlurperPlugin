package com.slopslurper.plugin.trackers;

import com.slopslurper.plugin.storage.PositionSample;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.World;
import org.bukkit.block.Biome;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Legt elke {@code sample-seconds} per online speler vast waar hij is: wereld, positie,
 * biome, of hij onder de grond zit, in welk voertuig, en welke spelers in de buurt zijn.
 *
 * Basis voor "waar besteden spelers hun tijd" (biomen, ondergronds, per wereld),
 * een positie-heatmap en sociale statistieken ("wie speelt met wie").
 * Dit gaat naar een eigen tabel {@code position_samples} in plaats van {@code events},
 * omdat het veel rijen zijn met steeds dezelfde vaste velden.
 */
public final class PositionTracker implements Tracker {

    private TrackerContext context;
    private BukkitTask task;
    private long intervalMs;
    private double radiusSquared;

    @Override
    public String id() {
        return "positions";
    }

    @Override
    public String description() {
        return "posities, biomen en wie bij elkaar is";
    }

    @Override
    public void start(TrackerContext context) {
        this.context = context;
        long seconds = Math.max(1, context.longSetting("sample-seconds", 10));
        int radius = Math.max(0, context.intSetting("nearby-radius", 32));
        this.intervalMs = seconds * 1000L;
        this.radiusSquared = (double) radius * radius;
        long ticks = seconds * 20L;
        task = Bukkit.getScheduler().runTaskTimer(context.plugin(), this::sample, ticks, ticks);
    }

    @Override
    public void stop() {
        if (task != null) {
            task.cancel();
            task = null;
        }
    }

    private void sample() {
        long now = System.currentTimeMillis();
        List<Player> online = new ArrayList<>(Bukkit.getOnlinePlayers());
        for (Player player : online) {
            if (player.isDead()) {
                continue; // in het doodscherm is hij nergens
            }
            Location loc = player.getLocation();
            World world = loc.getWorld();
            if (world == null) {
                continue;
            }
            Block block = loc.getBlock();
            context.store().recordPosition(new PositionSample(
                    player.getUniqueId(),
                    world.getName(),
                    loc.getBlockX(), loc.getBlockY(), loc.getBlockZ(),
                    biomeName(block.getBiome()),
                    underground(world, block),
                    vehicle(player),
                    player.getGameMode().name(),
                    nearby(player, loc, online),
                    intervalMs,
                    now));
        }
    }

    /**
     * Geen daglicht en een blok boven je hoofd. In werelden zonder lucht (Nether, End)
     * betekent dat niks, dus daar {@code null}.
     */
    private static Boolean underground(World world, Block block) {
        if (!world.hasSkyLight()) {
            return null;
        }
        return block.getLightFromSky() == 0 && block.getY() < world.getHighestBlockYAt(block.getX(), block.getZ());
    }

    private static String vehicle(Player player) {
        Entity vehicle = player.getVehicle();
        if (vehicle != null) {
            return vehicle.getType().name();
        }
        return player.isGliding() ? "ELYTRA" : null;
    }

    private List<UUID> nearby(Player player, Location loc, List<Player> online) {
        List<UUID> result = new ArrayList<>();
        if (radiusSquared <= 0) {
            return result;
        }
        for (Player other : online) {
            if (other == player || other.getGameMode() == GameMode.SPECTATOR || other.isDead()) {
                continue;
            }
            Location otherLoc = other.getLocation();
            if (loc.getWorld().equals(otherLoc.getWorld()) && loc.distanceSquared(otherLoc) <= radiusSquared) {
                result.add(other.getUniqueId());
            }
        }
        return result;
    }

    /** {@code minecraft:dark_forest} -> {@code DARK_FOREST}; biomes uit datapacks houden hun namespace. */
    private static String biomeName(Biome biome) {
        try {
            NamespacedKey key = biome.getKey();
            String name = key.getNamespace().equals(NamespacedKey.MINECRAFT) ? key.getKey() : key.toString();
            return name.toUpperCase(Locale.ROOT);
        } catch (RuntimeException e) {
            return null; // bijv. Biome.CUSTOM heeft geen sleutel
        }
    }
}
