package com.slopslurper.plugin.trackers;

/**
 * Een tracker verzamelt één soort data, bijvoorbeeld gebroken blokken of sessies.
 *
 * Elke tracker staat in {@code config.yml} onder {@code trackers.<id>} en kan daar
 * uitgezet worden met {@code enabled: false}. Een nieuwe tracker toevoegen:
 * <ol>
 *     <li>Maak een klasse die {@link EventTracker} uitbreidt (of deze interface implementeert).</li>
 *     <li>Voeg een event type toe aan {@code EventTypes}.</li>
 *     <li>Registreer hem in {@link TrackerManager#TRACKERS}.</li>
 *     <li>Zet een standaardblok in {@code config.yml} onder {@code trackers:}.</li>
 * </ol>
 */
public interface Tracker {

    /** Naam in de config, bijv. {@code block-break}. Kleine letters met streepjes. */
    String id();

    /** Korte omschrijving voor de logs. */
    String description();

    void start(TrackerContext context);

    /** Opruimen bij afsluiten of uitzetten (taken stoppen, open sessies afsluiten, ...). */
    default void stop() {
    }
}
