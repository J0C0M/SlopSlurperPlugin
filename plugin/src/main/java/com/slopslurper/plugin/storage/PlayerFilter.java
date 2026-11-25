package com.slopslurper.plugin.storage;

import java.util.Locale;
import java.util.UUID;

/**
 * Van welke spelers de data meetelt: iedereen, alleen echte spelers of alleen testbots.
 *
 * Bots hebben geen Minecraft-account en loggen in op een server in offline mode. Zo'n server
 * geeft een UUID van versie 3 (afgeleid van de naam); een echt account heeft versie 4. Daardoor
 * werkt dit ook voor bestaande data en voor bots met een andere naam. Wie zelf inlogt in
 * botmodus, krijgt ook een versie 3 en telt dus als bot.
 */
public enum PlayerFilter {
    ALL, REAL, BOTS;

    /** Positie (vanaf 1) van het versiecijfer in de tekstvorm van een UUID. */
    private static final int VERSION_POSITION = 15;

    /** Queryparameter van de API; ontbreekt die, dan iedereen. */
    public static PlayerFilter parse(String value) {
        return value == null ? ALL : valueOf(value.toUpperCase(Locale.ROOT));
    }

    public static boolean isBot(UUID uuid) {
        return uuid.version() == 3;
    }

    /** SQL-voorwaarde, inclusief voorafgaande {@code AND}; leeg als iedereen meetelt. */
    String and(String uuidColumn) {
        String version = " AND substr(" + uuidColumn + ", " + VERSION_POSITION + ", 1)";
        return switch (this) {
            case ALL -> "";
            case REAL -> version + " <> '3'";
            case BOTS -> version + " = '3'";
        };
    }
}
