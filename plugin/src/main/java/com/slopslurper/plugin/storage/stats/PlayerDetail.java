package com.slopslurper.plugin.storage.stats;

import java.util.List;

/**
 * @param activity aantal gebroken blokken per uur; het dashboard groepeert dit zelf
 *                 per dag of per uur van de dag, in de tijdzone van de kijker
 * @param sessions de laatste sessies, nieuwste eerst
 */
public record PlayerDetail(
        PlayerSummary player,
        List<CountEntry> topBlocks,
        List<CountEntry> tools,
        List<CountEntry> worlds,
        List<ActivityBucket> activity,
        List<SessionInfo> sessions
) {

    /** @param hourStart begin van het uur in epoch-milliseconden (UTC) */
    public record ActivityBucket(long hourStart, long count) {
    }

    /**
     * @param endedAt   {@code null} als de sessie nog loopt
     * @param durationMs duur tot het einde, of tot de laatste tussenstand als hij nog loopt
     */
    public record SessionInfo(long startedAt, Long endedAt, long durationMs, long afkMs, String endReason) {
    }
}
