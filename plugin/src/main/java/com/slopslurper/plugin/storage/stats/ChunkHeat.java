package com.slopslurper.plugin.storage.stats;

/**
 * Activiteit in één chunk (16x16 blokken): hoeveel blokken er gebroken zijn en
 * tussen welke y-hoogtes. Basis voor de heatmap.
 */
public record ChunkHeat(String world, int chunkX, int chunkZ, long count, int minY, int maxY) {
}
