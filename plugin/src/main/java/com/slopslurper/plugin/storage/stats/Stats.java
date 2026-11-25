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
 * @param interactions gebruikte blokken met aantal keer
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
        List<Death> deaths,
        Items items,
        List<CountEntry> interactions,
        long sleeps,
        Progress progress
) {

    /** {@code broken} in aantal keer, de rest in aantal items. */
    public record Items(List<CountEntry> pickedUp, List<CountEntry> dropped, List<CountEntry> broken) {
    }

    /**
     * @param xp           verdiende XP per bron
     * @param levels       aantal keer een level omhoog (opgeteld)
     * @param advancements de laatste advancements, nieuwste eerst
     */
    public record Progress(List<CountEntry> xp, long levels, List<Advancement> advancements) {
    }

    /** @param sinceJoinMs tijd sinds de eerste join, {@code playtimeMs} alleen de speeltijd */
    public record Advancement(String player, String key, long time, long sinceJoinMs, long playtimeMs) {
    }

    public record Interval(long start, long end, long afkMs) {
    }

    /** @param hourStart begin van het uur in epoch-milliseconden (UTC) */
    public record BlockBucket(long hourStart, long broken, long placed) {
    }

    /** @param x {@code null} als de plek onbekend is (net als y en z) */
    public record Death(String player, String cause, String world, Integer x, Integer y, Integer z, long time) {
    }
}
