package com.slopslurper.plugin.storage.stats;

import java.util.List;

/**
 * Sessies, doden, gevecht, items en beweging, voor één speler of de hele server.
 *
 * @param sessions    aantal sessies (alles)
 * @param playtimeMs  totale speeltijd, waarvan {@code afkMs} AFK
 * @param intervals   sessies die in de gevraagde periode vallen; het dashboard verdeelt ze over
 *                    dagen in de tijdzone van de kijker
 * @param blocks      gebroken en geplaatste blokken per uur in de gevraagde periode
 * @param movement    geschatte afstand in blokken per manier van verplaatsen: {@code FOOT},
 *                    {@code CREATIVE} of het voertuig
 * @param deaths      de laatste doden met plek, nieuwste eerst
 */
public record Stats(
        long sessions,
        long playtimeMs,
        long afkMs,
        List<Interval> intervals,
        List<BlockBucket> blocks,
        List<CountEntry> mobKills,
        List<CountEntry> pvpVictims,
        List<CountEntry> deathCauses,
        PlayerDetail.Health health,
        PlayerDetail.Crafting crafting,
        List<CountEntry> catches,
        List<CountEntry> movement,
        List<Death> deaths
) {

    public record Interval(long start, long end, long afkMs) {
    }

    /** @param hourStart begin van het uur in epoch-milliseconden (UTC) */
    public record BlockBucket(long hourStart, long broken, long placed) {
    }

    /** @param x {@code null} als de plek onbekend is (net als y en z) */
    public record Death(String player, String cause, String world, Integer x, Integer y, Integer z, long time) {
    }
}
