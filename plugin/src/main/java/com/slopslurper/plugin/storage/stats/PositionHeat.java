package com.slopslurper.plugin.storage.stats;

/** Hoe lang spelers in één chunk (16x16 blokken) waren, volgens de positie-samples. */
public record PositionHeat(String world, int chunkX, int chunkZ, long timeMs) {
}
