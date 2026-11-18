package com.slopslurper.plugin.storage;

/**
 * Alle waarden voor {@code events.type}. Eén plek, zodat queries en trackers dezelfde
 * namen gebruiken. Voeg hier een constante toe als je een nieuwe tracker bouwt.
 */
public final class EventTypes {

    /** subtype = bloktype, item = gereedschap. */
    public static final String BLOCK_BREAK = "block_break";

    /** Speler komt online. meta.session = sessie-id. */
    public static final String SESSION_START = "session_start";

    /** Speler gaat offline. value = duur in ms, subtype = reden, meta.afk_ms = AFK-tijd. */
    public static final String SESSION_END = "session_end";

    /** Speler wordt AFK. created_at = moment van de laatste input (niet pas na de time-out). */
    public static final String AFK_START = "afk_start";

    /** Speler is terug. value = AFK-duur in ms, created_at = moment van de nieuwe input. */
    public static final String AFK_END = "afk_end";

    private EventTypes() {
    }
}
