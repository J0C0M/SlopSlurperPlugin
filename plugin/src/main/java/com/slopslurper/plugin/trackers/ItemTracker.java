package com.slopslurper.plugin.trackers;

import com.slopslurper.plugin.storage.EventTypes;
import com.slopslurper.plugin.storage.GameEvent;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerItemBreakEvent;
import org.bukkit.event.player.PlayerPickupArrowEvent;
import org.bukkit.inventory.ItemStack;

/** Opgepakte en weggegooide items (opgeteld), en gereedschap en armor dat kapotgaat. */
public final class ItemTracker extends TotalsTracker {

    @Override
    public String id() {
        return "items";
    }

    @Override
    public String description() {
        return "opgepakte, weggegooide en kapotte items";
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPickup(EntityPickupItemEvent event) {
        if (!(event.getEntity() instanceof Player player)) {
            return;
        }
        ItemStack stack = event.getItem().getItemStack();
        // Past maar een deel, dan is getAmount() hier al alleen dat deel
        add(player, EventTypes.PICKUP, stack.getType().name(), null, stack.getAmount());
    }

    /** Pijlen in de grond zijn geen gewoon item en hebben een eigen event. */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPickupArrow(PlayerPickupArrowEvent event) {
        ItemStack stack = event.getItem().getItemStack();
        add(event.getPlayer(), EventTypes.PICKUP, stack.getType().name(), null, stack.getAmount());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDrop(PlayerDropItemEvent event) {
        ItemStack stack = event.getItemDrop().getItemStack();
        add(event.getPlayer(), EventTypes.DROP, stack.getType().name(), null, stack.getAmount());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onBreak(PlayerItemBreakEvent event) {
        Material item = event.getBrokenItem().getType();
        record(GameEvent.of(EventTypes.ITEM_BREAK, event.getPlayer())
                .subtype(item)
                .item(item)
                .build());
    }
}
