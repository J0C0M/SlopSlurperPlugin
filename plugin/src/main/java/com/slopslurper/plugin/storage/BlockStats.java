package com.slopslurper.plugin.storage;

import java.util.List;

/** Resultaat van een blokstatistiek-query voor één speler. */
public record BlockStats(long total, List<Entry> top) {

    public record Entry(String blockType, long amount) {
    }
}
