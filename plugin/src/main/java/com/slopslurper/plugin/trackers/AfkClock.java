package com.slopslurper.plugin.trackers;

/**
 * Houdt per speler bij of hij AFK is, los van Bukkit (dus goed te testen).
 *
 * Werking:
 * <ul>
 *     <li>{@link #input(long)} bij elke echte input (bewegen, klikken, chatten, ...).</li>
 *     <li>{@link #tick(long)} regelmatig aanroepen; geeft een {@link Change} als de speler
 *         AFK wordt of terug is.</li>
 * </ul>
 * AFK telt terug vanaf de laatste input: na een time-out van 3 minuten begint de AFK-periode
 * op het moment dat de speler stopte, niet pas na die 3 minuten. Terugkomen telt vanaf het
 * moment van de nieuwe input, ongeacht hoe vaak {@code tick} draait.
 */
final class AfkClock {

    /** Overgang van actief naar AFK of terug. */
    record Change(boolean nowAfk, long at, long afkDurationMs) {
    }

    private final long timeoutMs;
    private long lastInput;
    private Long afkSince;
    private long afkMs;

    /** @param timeoutMs na hoeveel ms zonder input iemand AFK is; 0 of minder = nooit AFK */
    AfkClock(long now, long timeoutMs) {
        this.timeoutMs = timeoutMs;
        this.lastInput = now;
    }

    void input(long now) {
        if (now > lastInput) {
            lastInput = now;
        }
    }

    Change tick(long now) {
        if (afkSince != null && lastInput > afkSince) {
            long duration = lastInput - afkSince;
            afkMs += duration;
            afkSince = null;
            return new Change(false, lastInput, duration);
        }
        if (afkSince == null && timeoutMs > 0 && now - lastInput >= timeoutMs) {
            afkSince = lastInput;
            return new Change(true, afkSince, 0);
        }
        return null;
    }

    boolean isAfk() {
        return afkSince != null;
    }

    /** Totale AFK-tijd tot {@code now}, inclusief een lopende AFK-periode. */
    long afkMs(long now) {
        return afkMs + (afkSince != null ? Math.max(0, now - afkSince) : 0);
    }

    /** Duur van de huidige AFK-periode tot {@code now}, of 0 als de speler niet AFK is. */
    long currentAfkMs(long now) {
        return afkSince != null ? Math.max(0, now - afkSince) : 0;
    }

    /** Laatste moment van echte input. */
    long lastInput() {
        return lastInput;
    }
}
