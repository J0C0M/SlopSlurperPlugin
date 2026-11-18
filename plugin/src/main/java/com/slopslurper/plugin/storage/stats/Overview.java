package com.slopslurper.plugin.storage.stats;

import java.util.List;

public record Overview(
        long totalBreaks,
        long playerCount,
        List<CountEntry> topBlocks,
        List<PlayerSummary> topPlayers
) {
}
