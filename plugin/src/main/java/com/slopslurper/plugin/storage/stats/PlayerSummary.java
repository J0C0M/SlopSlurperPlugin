package com.slopslurper.plugin.storage.stats;

/**
 * @param totalBreaks aantal gebroken blokken
 * @param totalPlaced aantal geplaatste blokken
 * @param mobKills    gedode mobs
 * @param pvpKills    gedode spelers
 * @param deaths      hoe vaak de speler doodging
 * @param lastActive  laatste event van deze speler, in epoch-milliseconden
 * @param playtimeMs  totale speeltijd over alle sessies (inclusief AFK)
 * @param afkMs       waarvan AFK
 * @param sessions    aantal sessies
 * @param bot         of dit een testbot is (geen Minecraft-account, zie PlayerFilter)
 */
public record PlayerSummary(
        String uuid,
        String name,
        long totalBreaks,
        long totalPlaced,
        long mobKills,
        long pvpKills,
        long deaths,
        long lastActive,
        long playtimeMs,
        long afkMs,
        long sessions,
        boolean bot
) {
}
