package com.slopslurper.plugin.storage;

import java.util.UUID;

/**
 * Eén gebroken blok, zoals het in de database komt.
 *
 * @param tool     het item in de hand, of "HAND" als de speler niets vasthield
 * @param brokenAt tijdstip in epoch-milliseconden
 */
public record BlockBreakRecord(
        UUID playerUuid,
        String playerName,
        String blockType,
        String world,
        int x,
        int y,
        int z,
        String tool,
        String gameMode,
        long brokenAt
) {
}
