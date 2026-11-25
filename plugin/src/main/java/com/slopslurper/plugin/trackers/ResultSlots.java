package com.slopslurper.plugin.trackers;

import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;

/** Rekent uit of en hoe vaak een klik op een resultaatslot (crafting, anvil) iets oplevert. */
final class ResultSlots {

    private ResultSlots() {
    }

    /**
     * Hoe vaak het resultaat met deze klik gepakt wordt.
     *
     * @param max hoe vaak het met de aanwezige ingrediënten kan
     * @return 0 als de klik niks doet (volle inventory, iets anders op de cursor, ...)
     */
    static int timesTaken(InventoryClickEvent event, ItemStack result, int max) {
        PlayerInventory inventory = event.getWhoClicked().getInventory();
        ItemStack cursor = event.getCursor();
        return switch (event.getClick()) {
            // Past een resultaat maar deels, dan maakt Minecraft het toch en valt de rest op de grond
            case SHIFT_LEFT, SHIFT_RIGHT -> {
                int per = result.getAmount();
                yield Math.min(max, (space(inventory, result) + per - 1) / per);
            }
            case LEFT, RIGHT -> isEmpty(cursor) || (cursor.isSimilar(result)
                    && cursor.getAmount() + result.getAmount() <= result.getMaxStackSize()) ? Math.min(1, max) : 0;
            case NUMBER_KEY -> isEmpty(inventory.getItem(event.getHotbarButton())) ? Math.min(1, max) : 0;
            case SWAP_OFFHAND -> isEmpty(inventory.getItemInOffHand()) ? Math.min(1, max) : 0;
            case DROP -> isEmpty(cursor) ? Math.min(1, max) : 0;
            // Ctrl+Q blijft doorgaan tot de ingrediënten op zijn
            case CONTROL_DROP -> isEmpty(cursor) ? max : 0;
            default -> 0;
        };
    }

    /** Hoeveel items deze klik van een gewone resultaatstapel (oven) pakt: de stapel kan deels achterblijven. */
    static int itemsTaken(InventoryClickEvent event, ItemStack result) {
        int amount = result.getAmount();
        return switch (event.getClick()) {
            case SHIFT_LEFT, SHIFT_RIGHT -> Math.min(amount, space(event.getWhoClicked().getInventory(), result));
            case RIGHT -> isEmpty(event.getCursor()) ? (amount + 1) / 2 : amount * timesTaken(event, result, 1);
            case DROP -> isEmpty(event.getCursor()) ? 1 : 0;
            default -> amount * timesTaken(event, result, 1);
        };
    }

    private static int space(PlayerInventory inventory, ItemStack result) {
        int space = 0;
        for (ItemStack slot : inventory.getStorageContents()) {
            if (isEmpty(slot)) {
                space += result.getMaxStackSize();
            } else if (slot.isSimilar(result)) {
                space += Math.max(0, result.getMaxStackSize() - slot.getAmount());
            }
        }
        return space;
    }

    static boolean isEmpty(ItemStack item) {
        return item == null || item.isEmpty();
    }
}
