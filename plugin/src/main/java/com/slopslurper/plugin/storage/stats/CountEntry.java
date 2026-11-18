package com.slopslurper.plugin.storage.stats;

/** Een naam met een aantal, bijvoorbeeld een bloktype en hoe vaak het gebroken is. */
public record CountEntry(String key, long amount) {
}
