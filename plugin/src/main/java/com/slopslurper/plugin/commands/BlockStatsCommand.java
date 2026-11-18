package com.slopslurper.plugin.commands;

import com.slopslurper.plugin.storage.BlockStats;
import com.slopslurper.plugin.storage.Database;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabExecutor;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.List;
import java.util.logging.Level;

/**
 * /blockstats [speler] — laat zien welke blokken een speler het meest breekt.
 */
public final class BlockStatsCommand implements TabExecutor {

    private static final int TOP_SIZE = 10;

    private final JavaPlugin plugin;
    private final Database database;

    public BlockStatsCommand(JavaPlugin plugin, Database database) {
        this.plugin = plugin;
        this.database = database;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        OfflinePlayer target;
        if (args.length == 0) {
            if (!(sender instanceof Player player)) {
                sender.sendMessage(Component.text("Gebruik vanuit de console: /blockstats <speler>", NamedTextColor.RED));
                return true;
            }
            target = player;
        } else {
            if (!sender.hasPermission("slopslurper.blockstats.others")) {
                sender.sendMessage(Component.text("Je mag alleen je eigen statistieken bekijken.", NamedTextColor.RED));
                return true;
            }
            target = Bukkit.getOfflinePlayerIfCached(args[0]);
            if (target == null) {
                sender.sendMessage(Component.text("Speler '" + args[0] + "' is nog nooit op deze server geweest.", NamedTextColor.RED));
                return true;
            }
        }

        String name = target.getName() != null ? target.getName() : args[0];
        database.getBlockStats(target.getUniqueId(), TOP_SIZE).whenComplete((stats, error) ->
                // Terug naar de main thread voor het antwoord
                Bukkit.getScheduler().runTask(plugin, () -> {
                    if (error != null) {
                        plugin.getLogger().log(Level.SEVERE, "Kon blockstats niet ophalen", error);
                        sender.sendMessage(Component.text("Er ging iets mis bij het ophalen van de statistieken.", NamedTextColor.RED));
                        return;
                    }
                    sendStats(sender, name, stats);
                }));
        return true;
    }

    private void sendStats(CommandSender sender, String name, BlockStats stats) {
        if (stats.total() == 0) {
            sender.sendMessage(Component.text(name + " heeft nog geen blokken gebroken.", NamedTextColor.GRAY));
            return;
        }
        sender.sendMessage(Component.text("Blokken gebroken door " + name + ": " + stats.total(), NamedTextColor.GOLD));
        int rank = 1;
        for (BlockStats.Entry entry : stats.top()) {
            sender.sendMessage(Component.text(" " + rank++ + ". ", NamedTextColor.GRAY)
                    .append(Component.text(entry.blockType(), NamedTextColor.WHITE))
                    .append(Component.text("  x" + entry.amount(), NamedTextColor.YELLOW)));
        }
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (args.length == 1 && sender.hasPermission("slopslurper.blockstats.others")) {
            String prefix = args[0].toLowerCase();
            return Bukkit.getOnlinePlayers().stream()
                    .map(Player::getName)
                    .filter(n -> n.toLowerCase().startsWith(prefix))
                    .toList();
        }
        return List.of();
    }
}
