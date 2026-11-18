package com.slopslurper.plugin.integrations;

import com.flowpowered.math.vector.Vector3d;
import com.slopslurper.plugin.storage.DataStore;
import com.slopslurper.plugin.storage.stats.ChunkHeat;
import de.bluecolored.bluemap.api.BlueMapAPI;
import de.bluecolored.bluemap.api.BlueMapMap;
import de.bluecolored.bluemap.api.markers.ExtrudeMarker;
import de.bluecolored.bluemap.api.markers.MarkerSet;
import de.bluecolored.bluemap.api.math.Color;
import de.bluecolored.bluemap.api.math.Shape;
import org.bukkit.Bukkit;
import org.bukkit.World;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.logging.Level;

/**
 * Tekent de blok-heatmap als 3D-kolommen op de BlueMap-kaart.
 *
 * Elke chunk waar blokken gebroken zijn wordt een doorzichtige kolom van de laagste
 * tot de hoogste y waar gegraven is. De kleur loopt van blauw (weinig) naar rood (veel).
 *
 * Deze klasse mag alleen geladen worden als de BlueMap-plugin aanwezig is.
 */
public final class BlueMapHeatmap {

    private static final String MARKER_SET_ID = "slopslurper-heatmap";
    private static final long REFRESH_TICKS = 20L * 60; // elke minuut

    private final JavaPlugin plugin;
    private final DataStore store;
    private final Consumer<BlueMapAPI> onEnable = this::onBlueMapEnable;
    private final Consumer<BlueMapAPI> onDisable = api -> stopTask();

    private BukkitTask task;

    public BlueMapHeatmap(JavaPlugin plugin, DataStore store) {
        this.plugin = plugin;
        this.store = store;
    }

    public void start() {
        // Wordt (opnieuw) aangeroepen telkens als BlueMap start of herlaadt
        BlueMapAPI.onEnable(onEnable);
        BlueMapAPI.onDisable(onDisable);
    }

    public void stop() {
        BlueMapAPI.unregisterListener(onEnable);
        BlueMapAPI.unregisterListener(onDisable);
        stopTask();
    }

    private void onBlueMapEnable(BlueMapAPI api) {
        stopTask();
        plugin.getLogger().info("BlueMap gevonden: heatmap wordt elke minuut op de 3D-kaart bijgewerkt.");
        task = Bukkit.getScheduler().runTaskTimerAsynchronously(plugin, () -> refresh(api), 20L * 5, REFRESH_TICKS);
    }

    private void stopTask() {
        if (task != null) {
            task.cancel();
            task = null;
        }
    }

    private void refresh(BlueMapAPI api) {
        try {
            List<ChunkHeat> cells = store.getBlockBreakHeatmap(null).get();
            long max = cells.stream().mapToLong(ChunkHeat::count).max().orElse(1);

            // Groepeer per wereld en zet de markers op alle BlueMap-kaarten van die wereld
            Map<String, MarkerSet> setsPerWorld = new HashMap<>();
            for (ChunkHeat cell : cells) {
                MarkerSet set = setsPerWorld.computeIfAbsent(cell.world(), w -> newMarkerSet());
                set.getMarkers().put(cell.world() + "_" + cell.chunkX() + "_" + cell.chunkZ(), toMarker(cell, max));
            }

            for (World world : Bukkit.getWorlds()) {
                MarkerSet set = setsPerWorld.getOrDefault(world.getName(), newMarkerSet());
                api.getWorld(world).ifPresent(bmWorld -> {
                    for (BlueMapMap map : bmWorld.getMaps()) {
                        map.getMarkerSets().put(MARKER_SET_ID, set);
                    }
                });
            }
        } catch (Exception e) {
            plugin.getLogger().log(Level.WARNING, "Kon de BlueMap-heatmap niet bijwerken", e);
        }
    }

    private static MarkerSet newMarkerSet() {
        return MarkerSet.builder()
                .label("SlopSlurper: gebroken blokken")
                .toggleable(true)
                .defaultHidden(false)
                .build();
    }

    private static ExtrudeMarker toMarker(ChunkHeat cell, long max) {
        // Logaritmische schaal: anders zie je naast één drukke chunk niks meer
        double t = max <= 1 ? 1 : Math.log(cell.count()) / Math.log(max);
        int x0 = cell.chunkX() * 16;
        int z0 = cell.chunkZ() * 16;
        float minY = cell.minY();
        float maxY = Math.max(cell.maxY() + 1, cell.minY() + 2);

        return ExtrudeMarker.builder()
                .label("Chunk " + cell.chunkX() + ", " + cell.chunkZ() + ": " + cell.count() + " blokken")
                .detail("<b>" + cell.count() + "</b> blokken gebroken<br>"
                        + "y " + cell.minY() + " t/m " + cell.maxY() + "<br>"
                        + "x " + x0 + "..." + (x0 + 15) + ", z " + z0 + "..." + (z0 + 15))
                .shape(Shape.createRect(x0, z0, x0 + 16, z0 + 16), minY, maxY)
                .position(new Vector3d(x0 + 8, maxY, z0 + 8))
                .fillColor(heatColor(t, 0.25f + 0.45f * (float) t))
                .lineColor(heatColor(t, 0.9f))
                .lineWidth(2)
                .depthTestEnabled(false)
                .build();
    }

    /** 0 = blauw, 0.33 = groen, 0.66 = geel, 1 = rood. */
    private static Color heatColor(double t, float alpha) {
        double[][] stops = {{0, 80, 255}, {0, 220, 120}, {255, 230, 0}, {255, 40, 20}};
        double scaled = Math.max(0, Math.min(1, t)) * (stops.length - 1);
        int i = Math.min((int) scaled, stops.length - 2);
        double f = scaled - i;
        int r = (int) (stops[i][0] + (stops[i + 1][0] - stops[i][0]) * f);
        int g = (int) (stops[i][1] + (stops[i + 1][1] - stops[i][1]) * f);
        int b = (int) (stops[i][2] + (stops[i + 1][2] - stops[i][2]) * f);
        return new Color(r, g, b, alpha);
    }
}
