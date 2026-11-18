package com.slopslurper.plugin.storage.stats;

import java.util.List;

/**
 * @param playtimeMs totale speeltijd van alle spelers samen
 * @param afkMs      waarvan AFK
 */
public record Overview(
        long totalBreaks,
        long playerCount,
        long playtimeMs,
        long afkMs,
        List<CountEntry> topBlocks,
        List<PlayerSummary> topPlayers
) {
}
