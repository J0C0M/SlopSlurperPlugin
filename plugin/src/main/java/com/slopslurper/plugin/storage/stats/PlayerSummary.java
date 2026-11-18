package com.slopslurper.plugin.storage.stats;

/**
 * @param lastActive  laatste event van deze speler, in epoch-milliseconden
 * @param playtimeMs  totale speeltijd over alle sessies (inclusief AFK)
 * @param afkMs       waarvan AFK
 * @param sessions    aantal sessies
 */
public record PlayerSummary(
        String uuid,
        String name,
        long totalBreaks,
        long lastActive,
        long playtimeMs,
        long afkMs,
        long sessions
) {
}
