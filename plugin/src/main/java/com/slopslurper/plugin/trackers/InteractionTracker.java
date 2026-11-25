package com.slopslurper.plugin.trackers;

import com.slopslurper.plugin.storage.EventTypes;
import com.slopslurper.plugin.storage.GameEvent;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerBedEnterEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;

import java.util.EnumSet;
import java.util.Set;

/**
 * Rechtsklikken op blokken die iets doen (deuren, knoppen, werkbanken, redstone), en slapen.
 *
 * {@code Material.isInteractable()} is te ruim (ook hekken en redstone-erts), dus we houden zelf
 * een lijst bij. Kisten en andere opslag horen bij een eigen tracker.
 */
public final class InteractionTracker extends TotalsTracker {

    private static final Set<Material> BLOCKS = blocks();

    private static Set<Material> blocks() {
        Set<Material> set = EnumSet.of(
                Material.LEVER, Material.NOTE_BLOCK, Material.REPEATER, Material.COMPARATOR,
                Material.REDSTONE_WIRE, Material.DAYLIGHT_DETECTOR, Material.JUKEBOX, Material.BELL,
                Material.CRAFTING_TABLE, Material.FURNACE, Material.BLAST_FURNACE, Material.SMOKER,
                Material.BREWING_STAND, Material.ENCHANTING_TABLE, Material.GRINDSTONE, Material.LOOM,
                Material.STONECUTTER, Material.CARTOGRAPHY_TABLE, Material.SMITHING_TABLE,
                Material.LECTERN, Material.BEACON, Material.RESPAWN_ANCHOR, Material.COMPOSTER, Material.CAKE);
        for (Tag<Material> tag : Set.of(Tag.DOORS, Tag.TRAPDOORS, Tag.FENCE_GATES, Tag.BUTTONS, Tag.BEDS, Tag.ANVIL)) {
            set.addAll(tag.getValues());
        }
        set.remove(Material.IRON_DOOR); // gaan niet met de hand open
        set.remove(Material.IRON_TRAPDOOR);
        return set;
    }

    @Override
    public String id() {
        return "interactions";
    }

    @Override
    public String description() {
        return "gebruikte blokken en slapen";
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onInteract(PlayerInteractEvent event) {
        // Alleen de hoofdhand: voor de andere hand gaat het event soms nog een keer af
        if (event.getAction() != Action.RIGHT_CLICK_BLOCK || event.getHand() != EquipmentSlot.HAND
                || event.getClickedBlock() == null) {
            return;
        }
        Player player = event.getPlayer();
        Material block = event.getClickedBlock().getType();
        if (!BLOCKS.contains(block) || player.getGameMode() == GameMode.SPECTATOR) {
            return;
        }
        // Sluipend met iets in de hand plaats of gebruik je dat item, niet het blok
        boolean holding = !player.getInventory().getItemInMainHand().isEmpty()
                || !player.getInventory().getItemInOffHand().isEmpty();
        if (player.isSneaking() && holding) {
            return;
        }
        add(player, EventTypes.INTERACT, block.name(), null, 1);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onSleep(PlayerBedEnterEvent event) {
        if (event.getBedEnterResult() != PlayerBedEnterEvent.BedEnterResult.OK) {
            return; // overdag, monsters in de buurt, ...
        }
        record(GameEvent.of(EventTypes.SLEEP, event.getPlayer())
                .subtype(event.getBed().getType())
                .at(event.getBed())
                .build());
    }
}
