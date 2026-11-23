package com.slopslurper.plugin.storage;

import java.util.UUID;

/**
 * Eén vismoment, zoals het in de database komt.
 *
 * @param state    de PlayerFishEvent-state, bijv. CAUGHT_FISH, CAUGHT_ENTITY, FAILED_ATTEMPT
 * @param caught   wat er gevangen is (item of entity-type), of "NONE"
 * @param fishedAt tijdstip in epoch-milliseconden
 */
public record FishingRecord(
        UUID playerUuid,
        String playerName,
        String state,
        String caught,
        String world,
        int x,
        int y,
        int z,
        int xp,
        long fishedAt
) {
}
