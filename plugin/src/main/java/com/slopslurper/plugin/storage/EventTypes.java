package com.slopslurper.plugin.storage;

/**
 * Alle waarden voor {@code events.type}. Eén plek, zodat queries en trackers dezelfde
 * namen gebruiken. Voeg hier een constante toe als je een nieuwe tracker bouwt.
 */
public final class EventTypes {

    /** subtype = bloktype, item = gereedschap. */
    public static final String BLOCK_BREAK = "block_break";

    /** subtype = bloktype, item = item in de hand (meestal hetzelfde blok). */
    public static final String BLOCK_PLACE = "block_place";

    /**
     * Speler doodt een mob. subtype = mobtype, item = wapen, plek = waar de mob stierf,
     * meta.distance = afstand tot de mob (handig voor pijl en boog).
     */
    public static final String MOB_KILL = "mob_kill";

    /**
     * Speler doodt een andere speler. subtype = naam van het slachtoffer, item = wapen,
     * meta.victim = UUID van het slachtoffer.
     */
    public static final String PVP_KILL = "pvp_kill";

    /**
     * Speler gaat dood. subtype = oorzaak: het type van de dader als die er is
     * ({@code ZOMBIE}, {@code PLAYER}, ...), anders het schadetype ({@code FALL}, {@code LAVA}, ...).
     * meta: damage_type, killer (naam bij PvP), items_lost, xp_lost, keep_inventory,
     * alive_ms (speeltijd sinds de vorige dood), session_ms (tijd sinds inloggen).
     */
    public static final String DEATH = "death";

    /** Vangst bij het vissen. subtype = gevangen item of entity, plek = dobber, meta.xp = XP. */
    public static final String FISH = "fish";

    /** Opgetelde schade die een speler uitdeelt. subtype = type slachtoffer, item = wapen, value = levenspunten, meta.count = treffers. */
    public static final String DAMAGE_DEALT = "damage_dealt";

    /** Opgetelde schade die een speler krijgt. subtype = oorzaak (zoals bij DEATH), value = levenspunten, meta.count = treffers. */
    public static final String DAMAGE_TAKEN = "damage_taken";

    /** Opgetelde genezing. subtype = reden (bijv. SATIATED), value = levenspunten. */
    public static final String HEAL = "heal";

    /** Speler eet iets. subtype = item, meta.food_level = honger vooraf. */
    public static final String EAT = "eat";

    /** Speler craft iets. subtype = item, value = aantal, meta.grid = table of inventory. */
    public static final String CRAFT = "craft";

    /** Speler haalt iets uit een oven. subtype = item, value = aantal, meta.station. */
    public static final String SMELT = "smelt";

    /** Enchanten aan de tafel. subtype = item, meta: enchants ("sharpness:3,..."), levels (betaald), required_level. */
    public static final String ENCHANT = "enchant";

    /** Aambeeld. subtype = RENAME, REPAIR, COMBINE of ENCHANT (boek), item = resultaat, meta: levels, renamed. */
    public static final String ANVIL = "anvil";

    /** Gebrouwen drankjes, op naam van wie de stand het laatst opende. subtype = drankje, item = soort fles, value = aantal, meta.ingredient. */
    public static final String BREW = "brew";

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
