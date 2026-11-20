package com.slopslurper.plugin.storage.stats;

import java.util.List;

/**
 * @param playtimeMs     totale speeltijd van alle spelers samen
 * @param afkMs          waarvan AFK
 * @param topDeathCauses subtype van {@code death}: dader ({@code ZOMBIE}) of schadetype ({@code FALL})
 */
public record Overview(
        long totalBreaks,
        long totalPlaced,
        long mobKills,
        long pvpKills,
        long deaths,
        long playerCount,
        long playtimeMs,
        long afkMs,
        List<CountEntry> topBlocks,
        List<CountEntry> topPlaced,
        List<CountEntry> topMobs,
        List<CountEntry> topDeathCauses,
        List<PlayerSummary> topPlayers
) {
}
