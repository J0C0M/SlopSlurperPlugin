package com.slopslurper.plugin.storage.stats;

import java.util.List;

/**
 * @param activity aantal gebroken blokken per uur; het dashboard groepeert dit zelf
 *                 per dag of per uur van de dag, in de tijdzone van de kijker
 */
public record PlayerDetail(
        PlayerSummary player,
        List<CountEntry> topBlocks,
        List<CountEntry> tools,
        List<CountEntry> worlds,
        List<ActivityBucket> activity
) {

    /** @param hourStart begin van het uur in epoch-milliseconden (UTC) */
    public record ActivityBucket(long hourStart, long count) {
    }
}
