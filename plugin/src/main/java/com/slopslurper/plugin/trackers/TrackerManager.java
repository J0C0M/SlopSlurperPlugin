package com.slopslurper.plugin.trackers;

import com.slopslurper.plugin.storage.DataStore;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;
import java.util.logging.Level;

/**
 * Start en stopt alle trackers op basis van {@code config.yml}:
 * <pre>
 * trackers:
 *   block-break:
 *     enabled: true
 * </pre>
 * Een tracker die niet in de config staat, staat standaard aan.
 */
public final class TrackerManager {

    /** Alle trackers die de plugin kent. Nieuwe tracker? Hier toevoegen. */
    static final List<Supplier<Tracker>> TRACKERS = List.of(
            SessionTracker::new,
            BlockBreakTracker::new,
            BlockPlaceTracker::new,
            KillTracker::new,
            DeathTracker::new,
            FishTracker::new,
            PositionTracker::new
    );

    private final JavaPlugin plugin;
    private final DataStore store;
    private final List<Tracker> active = new ArrayList<>();

    public TrackerManager(JavaPlugin plugin, DataStore store) {
        this.plugin = plugin;
        this.store = store;
    }

    public void startAll() {
        List<String> on = new ArrayList<>();
        List<String> off = new ArrayList<>();
        for (Supplier<Tracker> factory : TRACKERS) {
            Tracker tracker = factory.get();
            String path = "trackers." + tracker.id();
            if (!plugin.getConfig().getBoolean(path + ".enabled", true)) {
                off.add(tracker.id());
                continue;
            }
            try {
                tracker.start(new TrackerContext(plugin, store, plugin.getConfig().getConfigurationSection(path)));
                active.add(tracker);
                on.add(tracker.id());
            } catch (Exception e) {
                // Eén kapotte tracker mag de rest niet tegenhouden
                plugin.getLogger().log(Level.SEVERE, "Tracker '" + tracker.id() + "' kon niet starten", e);
                off.add(tracker.id() + " (fout)");
            }
        }
        plugin.getLogger().info("Trackers aan: " + (on.isEmpty() ? "geen" : String.join(", ", on))
                + (off.isEmpty() ? "" : " | uit: " + String.join(", ", off)));
    }

    public void stopAll() {
        for (Tracker tracker : active) {
            try {
                tracker.stop();
            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING, "Tracker '" + tracker.id() + "' gaf een fout bij stoppen", e);
            }
        }
        active.clear();
    }
}
