package com.slopslurper.plugin.storage;

import java.util.List;
import java.util.UUID;

/**
 * Waar een speler op één moment was, zoals hij in de {@code position_samples}-tabel komt.
 * De {@code PositionTracker} maakt er elke paar seconden één per online speler.
 *
 * @param biome       bijv. {@code PLAINS}; {@code null} als onbekend
 * @param underground geen daglicht en een blok boven je hoofd (onder de grond of binnen
 *                    zonder ramen); {@code null} in werelden zonder lucht (Nether, End)
 * @param vehicle     waar de speler in of op zit ({@code OAK_BOAT}, {@code HORSE},
 *                    {@code MINECART}, ...), {@code ELYTRA} als hij zweeft, anders {@code null}
 * @param nearby      andere spelers binnen de ingestelde straal
 * @param intervalMs  hoeveel speeltijd dit sample vertegenwoordigt (de sample-interval);
 *                    tel deze op voor "tijd in biome X", ook als de interval later verandert
 */
public record PositionSample(
        UUID playerUuid,
        String world,
        int x,
        int y,
        int z,
        String biome,
        Boolean underground,
        String vehicle,
        String gameMode,
        List<UUID> nearby,
        long intervalMs,
        long createdAt
) {
}
