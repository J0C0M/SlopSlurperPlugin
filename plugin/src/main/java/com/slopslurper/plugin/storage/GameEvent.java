package com.slopslurper.plugin.storage;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Eén gebeurtenis in het spel, zoals hij in de {@code events}-tabel komt.
 *
 * Alle trackers gebruiken dit ene model. Wat er per soort event anders is, zit in
 * {@code type} (wat er gebeurde), {@code subtype} (waarmee, bijv. het bloktype of de mob)
 * en eventueel {@code meta} (extra details als JSON).
 *
 * Maak events met de builder:
 * <pre>
 * GameEvent.of(EventTypes.MOB_KILL, player)
 *         .subtype(entity.getType())
 *         .at(entity.getLocation())
 *         .meta("distance", 12.5)
 *         .build();
 * </pre>
 *
 * @param playerUuid {@code null} voor events zonder speler (bijv. servercontext)
 * @param x          blokcoördinaat, of {@code null} als het event geen plek heeft
 * @param item       item in de hand (bijv. {@code DIAMOND_PICKAXE}), {@code HAND} als die leeg was
 * @param value      hoeveelheid; 1 voor een gewone gebeurtenis, anders bijv. schade of aantal items
 * @param createdAt  tijdstip in epoch-milliseconden
 */
public record GameEvent(
        String type,
        UUID playerUuid,
        String playerName,
        String subtype,
        String world,
        Integer x,
        Integer y,
        Integer z,
        String item,
        String gameMode,
        double value,
        Map<String, Object> meta,
        long createdAt
) {

    /** Event zonder speler. */
    public static Builder of(String type) {
        return new Builder(type);
    }

    /**
     * Event van een speler. Vult alvast in: speler, wereld en positie van de speler,
     * gamemode, item in de hand en het huidige tijdstip. Alles is daarna nog te overschrijven.
     */
    public static Builder of(String type, Player player) {
        Material hand = player.getInventory().getItemInMainHand().getType();
        return new Builder(type)
                .player(player)
                .at(player.getLocation())
                .item(hand)
                .gameMode(player.getGameMode().name());
    }

    public static final class Builder {
        private final String type;
        private UUID playerUuid;
        private String playerName;
        private String subtype;
        private String world;
        private Integer x;
        private Integer y;
        private Integer z;
        private String item;
        private String gameMode;
        private double value = 1;
        private final Map<String, Object> meta = new LinkedHashMap<>();
        private long createdAt = System.currentTimeMillis();

        private Builder(String type) {
            this.type = type;
        }

        public Builder player(Player player) {
            return player(player.getUniqueId(), player.getName());
        }

        /** Voor een speler die misschien niet meer online is. */
        public Builder player(UUID uuid, String name) {
            this.playerUuid = uuid;
            this.playerName = name;
            return this;
        }

        public Builder subtype(String subtype) {
            this.subtype = subtype;
            return this;
        }

        /** Voor enums zoals {@code Material}, {@code EntityType} of {@code DamageCause}. */
        public Builder subtype(Enum<?> subtype) {
            this.subtype = subtype == null ? null : subtype.name();
            return this;
        }

        public Builder at(Location location) {
            if (location == null || location.getWorld() == null) {
                return this;
            }
            this.world = location.getWorld().getName();
            this.x = location.getBlockX();
            this.y = location.getBlockY();
            this.z = location.getBlockZ();
            return this;
        }

        public Builder at(Block block) {
            this.world = block.getWorld().getName();
            this.x = block.getX();
            this.y = block.getY();
            this.z = block.getZ();
            return this;
        }

        /** Alleen de wereld, zonder positie. */
        public Builder world(String world) {
            this.world = world;
            this.x = null;
            this.y = null;
            this.z = null;
            return this;
        }

        public Builder item(Material material) {
            this.item = material == null ? null : (material.isAir() ? "HAND" : material.name());
            return this;
        }

        public Builder item(String item) {
            this.item = item;
            return this;
        }

        public Builder gameMode(String gameMode) {
            this.gameMode = gameMode;
            return this;
        }

        public Builder value(double value) {
            this.value = value;
            return this;
        }

        /** Extra detail, opgeslagen als JSON. Waarden: tekst, getallen of booleans. */
        public Builder meta(String key, Object value) {
            if (value != null) {
                this.meta.put(key, value instanceof Enum<?> e ? e.name() : value);
            }
            return this;
        }

        public Builder time(long epochMillis) {
            this.createdAt = epochMillis;
            return this;
        }

        public GameEvent build() {
            return new GameEvent(type, playerUuid, playerName, subtype, world, x, y, z, item, gameMode, value,
                    meta.isEmpty() ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(meta)), createdAt);
        }
    }
}
