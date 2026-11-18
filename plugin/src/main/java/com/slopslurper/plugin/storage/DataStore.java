package com.slopslurper.plugin.storage;

import com.slopslurper.plugin.storage.stats.ChunkHeat;
import com.slopslurper.plugin.storage.stats.Overview;
import com.slopslurper.plugin.storage.stats.PlayerDetail;
import com.slopslurper.plugin.storage.stats.PlayerSummary;

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

    /** Zet een blokbreuk in de wachtrij. Veilig om vanaf de main thread aan te roepen. */
    void queueBlockBreak(BlockBreakRecord record);

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
}
