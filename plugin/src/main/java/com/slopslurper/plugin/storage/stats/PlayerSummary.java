package com.slopslurper.plugin.storage.stats;

/**
 * @param lastActive laatste gebroken blok, in epoch-milliseconden
 */
public record PlayerSummary(String uuid, String name, long totalBreaks, long lastActive) {
}
