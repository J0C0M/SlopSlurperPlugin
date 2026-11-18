package com.slopslurper.plugin.storage;

import java.util.UUID;

/**
 * Stand van één sessie (van join tot quit), zoals hij in de {@code sessions}-tabel komt.
 * Wordt meerdere keren opgeslagen met hetzelfde {@code id}: tussentijds (elke minuut)
 * en bij het afsluiten. De laatste versie wint.
 *
 * @param endedAt   {@code null} zolang de sessie nog loopt
 * @param afkMs     totale AFK-tijd binnen deze sessie tot nu toe
 * @param endReason bijv. {@code DISCONNECTED}, {@code KICKED}, {@code TIMED_OUT}, {@code SERVER_CRASH}
 */
public record SessionRecord(
        String id,
        UUID playerUuid,
        String playerName,
        long startedAt,
        long lastSeenAt,
        Long endedAt,
        long afkMs,
        String endReason
) {
}
