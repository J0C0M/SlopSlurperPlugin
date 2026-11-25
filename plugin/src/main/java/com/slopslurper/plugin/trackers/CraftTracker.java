package com.slopslurper.plugin.trackers;

import com.slopslurper.plugin.storage.EventTypes;
import com.slopslurper.plugin.storage.GameEvent;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.inventory.CraftItemEvent;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.inventory.ItemStack;

/**
 * Wat spelers craften, en of dat aan een werkbank of in de inventory gebeurt.
 *
 * Het event geeft altijd maar één resultaat, ook bij shift-klik. Het echte aantal rekenen we
 * uit met de ingrediënten in het raster en de vrije ruimte in de inventory.
 */
public final class CraftTracker extends EventTracker {

    @Override
    public String id() {
        return "crafting";
    }

    @Override
    public String description() {
        return "gecrafte items";
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onCraft(CraftItemEvent event) {
        ItemStack result = event.getInventory().getResult();
        if (ResultSlots.isEmpty(result) || !(event.getWhoClicked() instanceof Player player)) {
            return;
        }
        int possible = Integer.MAX_VALUE; // elk recept gebruikt één item per slot
        for (ItemStack ingredient : event.getInventory().getMatrix()) {
            if (!ResultSlots.isEmpty(ingredient)) {
                possible = Math.min(possible, ingredient.getAmount());
            }
        }
        if (possible == Integer.MAX_VALUE) {
            return;
        }
        int times = ResultSlots.timesTaken(event, result, possible);
        if (times <= 0) {
            return;
        }
        boolean table = event.getInventory().getType() == InventoryType.WORKBENCH;
        record(GameEvent.of(EventTypes.CRAFT, player)
                .subtype(result.getType())
                .value(times * result.getAmount())
                .meta("grid", table ? "table" : "inventory")
                .build());
    }
}
