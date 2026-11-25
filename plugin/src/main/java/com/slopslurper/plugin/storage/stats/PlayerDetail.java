package com.slopslurper.plugin.storage.stats;

import java.util.List;

/**
 * @param activity aantal gebroken blokken per uur; het dashboard groepeert dit zelf
 *                 per dag of per uur van de dag, in de tijdzone van de kijker
 * @param worlds   gebroken blokken per wereld
 * @param sessions de laatste sessies, nieuwste eerst
 * @param places   waar de speler zijn tijd doorbrengt, uit de positie-samples
 */
public record PlayerDetail(
        PlayerSummary player,
        List<CountEntry> topBlocks,
        List<CountEntry> topPlaced,
        List<CountEntry> tools,
        List<CountEntry> worlds,
        List<CountEntry> mobKills,
        List<CountEntry> pvpVictims,
        List<CountEntry> deathCauses,
        List<CountEntry> catches,
        List<ActivityBucket> activity,
        List<SessionInfo> sessions,
        Places places,
        Health health,
        Crafting crafting
) {

    /** Schade en genezing in levenspunten (2 = één hart), {@code food} in aantal keer gegeten. */
    public record Health(
            List<CountEntry> damageDealt,
            List<CountEntry> damageTaken,
            List<CountEntry> healed,
            List<CountEntry> food
    ) {
    }

    /** {@code enchanted} en {@code anvil} in aantal keer, de rest in aantal items. */
    public record Crafting(
            List<CountEntry> crafted,
            List<CountEntry> smelted,
            List<CountEntry> enchanted,
            List<CountEntry> anvil,
            List<CountEntry> brewed
    ) {
    }

    /** @param hourStart begin van het uur in epoch-milliseconden (UTC) */
    public record ActivityBucket(long hourStart, long count) {
    }

    /**
     * @param endedAt   {@code null} als de sessie nog loopt
     * @param durationMs duur tot het einde, of tot de laatste tussenstand als hij nog loopt
     */
    public record SessionInfo(long startedAt, Long endedAt, long durationMs, long afkMs, String endReason) {
    }

    /**
     * Tijd volgens de positie-samples. Alle {@code amount}s in de lijsten zijn milliseconden.
     *
     * @param sampledMs     totale tijd waarvan een positie bekend is
     * @param undergroundMs waarvan onder de grond (of binnen zonder daglicht), alleen in werelden met lucht
     * @param surfaceMs     waarvan bovengronds, alleen in werelden met lucht
     * @param withOthersMs  waarvan met minstens één andere speler in de buurt
     * @param worlds        tijd per wereld
     * @param biomes        tijd per biome
     * @param vehicles      tijd per voertuig (boot, paard, minecart, elytra)
     * @param companions    met wie (naam) en hoe lang samen in de buurt
     */
    public record Places(
            long sampledMs,
            long undergroundMs,
            long surfaceMs,
            long withOthersMs,
            List<CountEntry> worlds,
            List<CountEntry> biomes,
            List<CountEntry> vehicles,
            List<CountEntry> companions
    ) {
    }
}
