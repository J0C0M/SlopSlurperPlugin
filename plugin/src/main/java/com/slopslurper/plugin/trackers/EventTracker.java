package com.slopslurper.plugin.trackers;

import com.slopslurper.plugin.storage.GameEvent;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;

/**
 * Basis voor trackers die op Bukkit-events reageren. Zet {@code @EventHandler}-methodes
 * in de subklasse; registreren en weer afmelden gaat automatisch.
 *
 * Tip: gebruik {@code @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)},
 * dan tel je alleen wat echt gebeurt nadat alle andere plugins hun zegje hebben gedaan.
 */
public abstract class EventTracker implements Tracker, Listener {

    private TrackerContext context;

    @Override
    public final void start(TrackerContext context) {
        this.context = context;
        onStart(context);
        context.plugin().getServer().getPluginManager().registerEvents(this, context.plugin());
    }

    @Override
    public final void stop() {
        HandlerList.unregisterAll(this);
        if (context != null) {
            onStop();
        }
    }

    /** Optioneel: instellingen lezen of taken starten. */
    protected void onStart(TrackerContext context) {
    }

    /** Optioneel: opruimen. */
    protected void onStop() {
    }

    protected TrackerContext context() {
        return context;
    }

    protected void record(GameEvent event) {
        context.record(event);
    }
}
