package com.slopslurper.plugin.storage;

import java.util.List;

/**
 * Resultaat van een blokstatistiek-query voor één speler.
 *
 * @param total  aantal gebroken blokken
 * @param placed aantal geplaatste blokken
 * @param top    meest gebroken blokken
 */
public record BlockStats(long total, long placed, List<Entry> top) {

    public record Entry(String blockType, long amount) {
    }
}
