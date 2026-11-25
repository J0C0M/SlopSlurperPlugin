package com.slopslurper.plugin.trackers;

import com.slopslurper.plugin.storage.EventTypes;
import com.slopslurper.plugin.storage.GameEvent;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.HumanEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.enchantment.EnchantItemEvent;
import org.bukkit.event.inventory.BrewEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryOpenEvent;
import org.bukkit.inventory.AnvilInventory;
import org.bukkit.inventory.BrewerInventory;
import org.bukkit.inventory.FurnaceInventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.PotionMeta;
import org.bukkit.inventory.view.AnvilView;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

/** Smelten (oven, smoker, blast furnace), enchanten, aambeeld en brouwen. */
public final class StationTracker extends EventTracker {

    private static final int RESULT = 2; // zowel oven als aambeeld
    private static final int BREW_SLOTS = 3;
    private static final int MAX_STANDS = 1000;

    private record Opener(UUID uuid, String name) {
    }

    private record Potion(String type, Material item) {
    }

    /** Wie elke brewing stand het laatst opende. Begrensd: de oudste valt eruit. */
    private final Map<Location, Opener> openers = new LinkedHashMap<>(16, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<Location, Opener> eldest) {
            return size() > MAX_STANDS;
        }
    };

    @Override
    public String id() {
        return "stations";
    }

    @Override
    public String description() {
        return "smelten, enchanten, aambeeld en brouwen";
    }

    /**
     * Niet met FurnaceExtractEvent: dat gaat per gebruikt recept af (erts en ruw ijzer door elkaar
     * telt dubbel), en niet als je de rest van een stapel later pakt.
     */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onSmelt(InventoryClickEvent event) {
        if (event.getRawSlot() != RESULT
                || !(event.getView().getTopInventory() instanceof FurnaceInventory furnace)
                || !(event.getWhoClicked() instanceof Player player)) {
            return;
        }
        ItemStack result = furnace.getResult();
        int amount = ResultSlots.isEmpty(result) ? 0 : ResultSlots.itemsTaken(event, result);
        if (amount <= 0) {
            return;
        }
        record(GameEvent.of(EventTypes.SMELT, player)
                .subtype(result.getType())
                .at(furnace.getLocation())
                .value(amount)
                .meta("station", furnace.getType())
                .build());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onEnchant(EnchantItemEvent event) {
        Player player = event.getEnchanter();
        String enchants = event.getEnchantsToAdd().entrySet().stream()
                .map(e -> e.getKey().getKey().getKey() + ":" + e.getValue())
                .sorted()
                .collect(Collectors.joining(","));
        // getExpLevelCost() is het vereiste level; betalen doe je 1, 2 of 3 levels
        boolean free = player.getGameMode() == GameMode.CREATIVE;
        record(GameEvent.of(EventTypes.ENCHANT, player)
                .subtype(event.getItem().getType())
                .item(event.getItem().getType())
                .at(event.getEnchantBlock())
                .meta("enchants", enchants)
                .meta("levels", free ? 0 : event.whichButton() + 1)
                .meta("required_level", event.getExpLevelCost())
                .build());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onAnvil(InventoryClickEvent event) {
        if (event.getRawSlot() != RESULT
                || !(event.getView() instanceof AnvilView view)
                || !(event.getWhoClicked() instanceof Player player)) {
            return;
        }
        AnvilInventory anvil = view.getTopInventory();
        ItemStack first = anvil.getItem(0);
        ItemStack second = anvil.getItem(1);
        ItemStack result = anvil.getItem(RESULT);
        if (ResultSlots.isEmpty(first) || ResultSlots.isEmpty(result)) {
            return;
        }
        boolean free = player.getGameMode() == GameMode.CREATIVE;
        int cost = view.getRepairCost();
        if (cost <= 0 || (!free && player.getLevel() < cost)
                || ResultSlots.timesTaken(event, result, 1) == 0) {
            return; // te weinig levels of geen plek: het item blijft liggen
        }
        String operation;
        if (ResultSlots.isEmpty(second)) {
            operation = "RENAME";
        } else if (second.getType() == first.getType()) {
            operation = "COMBINE";
        } else if (second.getType() == Material.ENCHANTED_BOOK) {
            operation = "ENCHANT";
        } else {
            operation = "REPAIR";
        }
        record(GameEvent.of(EventTypes.ANVIL, player)
                .subtype(operation)
                .item(result.getType())
                .at(anvil.getLocation())
                .meta("levels", free ? 0 : cost)
                .meta("renamed", !Objects.equals(first.getItemMeta().displayName(), result.getItemMeta().displayName()))
                .build());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onOpen(InventoryOpenEvent event) {
        if (event.getInventory() instanceof BrewerInventory stand && stand.getLocation() != null) {
            HumanEntity who = event.getPlayer();
            openers.put(stand.getLocation().toBlockLocation(), new Opener(who.getUniqueId(), who.getName()));
        }
    }

    /** Een stand kent geen eigenaar: het drankje is van wie hem het laatst opende. */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBrew(BrewEvent event) {
        Opener opener = openers.get(event.getBlock().getLocation());
        if (opener == null) {
            return; // sinds de serverstart door niemand geopend
        }
        BrewerInventory stand = event.getContents();
        Map<Potion, Integer> made = new LinkedHashMap<>();
        for (int i = 0; i < Math.min(BREW_SLOTS, event.getResults().size()); i++) {
            ItemStack before = stand.getItem(i);
            ItemStack after = event.getResults().get(i);
            if (!ResultSlots.isEmpty(before) && !ResultSlots.isEmpty(after) && !before.equals(after)) {
                made.merge(new Potion(potionType(after), after.getType()), 1, Integer::sum);
            }
        }
        ItemStack ingredient = stand.getIngredient();
        made.forEach((potion, amount) -> record(GameEvent.of(EventTypes.BREW)
                .player(opener.uuid(), opener.name())
                .subtype(potion.type())
                .item(potion.item())
                .at(event.getBlock())
                .value(amount)
                .meta("ingredient", ResultSlots.isEmpty(ingredient) ? null : ingredient.getType())
                .build()));
    }

    private static String potionType(ItemStack item) {
        return item.getItemMeta() instanceof PotionMeta meta && meta.getBasePotionType() != null
                ? meta.getBasePotionType().name()
                : item.getType().name();
    }
}
