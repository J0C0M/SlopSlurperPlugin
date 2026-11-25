package com.slopslurper.plugin.storage;

import com.slopslurper.plugin.storage.stats.ChunkHeat;
import com.slopslurper.plugin.storage.stats.Overview;
import com.slopslurper.plugin.storage.stats.PlayerDetail;
import com.slopslurper.plugin.storage.stats.PlayerSummary;
import com.slopslurper.plugin.storage.stats.PositionHeat;
import com.slopslurper.plugin.storage.stats.Stats;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Opslag voor spelersdata. Listeners, commando's en het dashboard praten alleen met deze
 * interface, zodat we later een centrale opslag (MySQL, of een centrale API) kunnen
 * toevoegen naast {@link SqliteDataStore} zonder de rest van de plugin aan te passen.
 *
 * Alle query-methodes zijn asynchroon: ze draaien nooit op de main thread.
 */
public interface DataStore {

    void open() throws Exception;

    void close();

    /**
     * Zet een event in de wachtrij; het wordt binnen een paar seconden gebundeld weggeschreven.
     * Veilig en goedkoop om vanaf de main thread (bijv. in een event listener) aan te roepen.
     */
    void recordEvent(GameEvent event);

    /**
     * Slaat de stand van een sessie op (nieuw of bijgewerkt, op basis van het id).
     * Gaat via dezelfde wachtrij als events, dus ook goedkoop vanaf de main thread.
     */
    void saveSession(SessionRecord session);

    /** Zet een positie-sample in de wachtrij. Net als events goedkoop vanaf de main thread. */
    void recordPosition(PositionSample sample);

    /** Schrijft de wachtrij weg op de achtergrond. */
    void flushAsync();

    CompletableFuture<BlockStats> getBlockStats(UUID player, int limit);

    /** Server-breed overzicht: totalen, top-blokken en meest actieve spelers. */
    CompletableFuture<Overview> getOverview(int limit);

    /** Alle spelers waarvan data bestaat, meest actief eerst. */
    CompletableFuture<List<PlayerSummary>> getPlayers();

    /**
     * Details van één speler.
     *
     * @param activitySince alleen activiteit vanaf dit tijdstip (epoch ms) meenemen
     */
    CompletableFuture<Optional<PlayerDetail>> getPlayer(UUID player, int limit, long activitySince);

    /**
     * Gebroken blokken per chunk, voor de heatmap.
     *
     * @param player alleen deze speler, of {@code null} voor iedereen
     */
    CompletableFuture<List<ChunkHeat>> getBlockBreakHeatmap(UUID player);

    /**
     * Doorgebrachte tijd per chunk, uit de positie-samples.
     *
     * @param player alleen deze speler, of {@code null} voor iedereen
     * @param world  alleen deze wereld, of {@code null} voor alle werelden
     */
    CompletableFuture<List<PositionHeat>> getPositionHeatmap(UUID player, String world);

    /**
     * Sessies, doden, gevecht, items en beweging.
     *
     * @param player alleen deze speler, of {@code null} voor de hele server
     * @param since  begin van de periode voor de gegevens per dag (epoch ms)
     */
    CompletableFuture<Stats> getStats(UUID player, int limit, long since);
}
