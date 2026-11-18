package com.slopslurper.plugin.trackers;

import com.slopslurper.plugin.storage.DataStore;
import com.slopslurper.plugin.storage.GameEvent;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Alles wat een tracker nodig heeft: de plugin, de opslag en zijn eigen config-sectie
 * ({@code trackers.<id>} in {@code config.yml}).
 */
public final class TrackerContext {

    private final JavaPlugin plugin;
    private final DataStore store;
    private final ConfigurationSection config;

    TrackerContext(JavaPlugin plugin, DataStore store, ConfigurationSection config) {
        this.plugin = plugin;
        this.store = store;
        this.config = config;
    }

    public JavaPlugin plugin() {
        return plugin;
    }

    public DataStore store() {
        return store;
    }

    /** Kortere schrijfwijze voor {@code store().recordEvent(event)}. */
    public void record(GameEvent event) {
        store.recordEvent(event);
    }

    public int intSetting(String key, int defaultValue) {
        return config == null ? defaultValue : config.getInt(key, defaultValue);
    }

    public long longSetting(String key, long defaultValue) {
        return config == null ? defaultValue : config.getLong(key, defaultValue);
    }

    public double doubleSetting(String key, double defaultValue) {
        return config == null ? defaultValue : config.getDouble(key, defaultValue);
    }

    public boolean boolSetting(String key, boolean defaultValue) {
        return config == null ? defaultValue : config.getBoolean(key, defaultValue);
    }
}
