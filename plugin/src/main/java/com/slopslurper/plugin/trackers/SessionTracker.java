package com.slopslurper.plugin.trackers;

import com.destroystokyo.paper.event.player.PlayerJumpEvent;
import com.slopslurper.plugin.storage.EventTypes;
import com.slopslurper.plugin.storage.GameEvent;
import com.slopslurper.plugin.storage.SessionRecord;
import io.papermc.paper.event.player.AsyncChatEvent;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.player.PlayerAnimationEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerItemHeldEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerToggleSneakEvent;
import org.bukkit.event.player.PlayerToggleSprintEvent;
import org.bukkit.scheduler.BukkitTask;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Sessies (van join tot quit) met speeltijd en AFK-tijd.
 *
 * <ul>
 *     <li>Per sessie één rij in {@code sessions}, elke {@code checkpoint-seconds} bijgewerkt,
 *         zodat er bij een crash hooguit zo lang verloren gaat.</li>
 *     <li>Events: {@code session_start}, {@code session_end}, {@code afk_start}, {@code afk_end}.</li>
 *     <li>AFK = {@code afk-timeout-seconds} geen echte input. Wat telt als input: rondkijken,
 *         zelf lopen (niet meegevoerd door water of in een minecart), springen, klikken/slaan,
 *         interacties, inventory, chat, commando's, sneaken/sprinten, van hotbar-slot wisselen.</li>
 * </ul>
 * Alle state wordt alleen op de main thread aangepast (chat komt async binnen en wordt doorgezet).
 */
public final class SessionTracker extends EventTracker {

    private static final long TICK_INTERVAL = 40L; // 2 seconden

    private static final class PlayerSession {
        final String id = UUID.randomUUID().toString();
        final UUID uuid;
        String name;
        final long startedAt;
        final AfkClock afk;

        PlayerSession(Player player, long now, long afkTimeoutMs) {
            this.uuid = player.getUniqueId();
            this.name = player.getName();
            this.startedAt = now;
            this.afk = new AfkClock(now, afkTimeoutMs);
        }

        SessionRecord snapshot(long now, Long endedAt, String reason) {
            return new SessionRecord(id, uuid, name, startedAt, now, endedAt, afk.afkMs(now), reason);
        }
    }

    private final Map<UUID, PlayerSession> sessions = new HashMap<>();
    private long afkTimeoutMs;
    private BukkitTask tickTask;
    private BukkitTask checkpointTask;

    @Override
    public String id() {
        return "sessions";
    }

    @Override
    public String description() {
        return "sessies, speeltijd en AFK";
    }

    @Override
    protected void onStart(TrackerContext context) {
        afkTimeoutMs = context.longSetting("afk-timeout-seconds", 180) * 1000L;
        long checkpointTicks = Math.max(10, context.longSetting("checkpoint-seconds", 60)) * 20L;

        // Spelers die al online zijn (bijv. na een plugin-herlaad) krijgen meteen een sessie
        long now = System.currentTimeMillis();
        for (Player player : Bukkit.getOnlinePlayers()) {
            open(player, now);
        }

        tickTask = Bukkit.getScheduler().runTaskTimer(context.plugin(), this::tickAfk, TICK_INTERVAL, TICK_INTERVAL);
        checkpointTask = Bukkit.getScheduler().runTaskTimer(context.plugin(), this::checkpoint, checkpointTicks, checkpointTicks);
    }

    @Override
    protected void onStop() {
        if (tickTask != null) {
            tickTask.cancel();
        }
        if (checkpointTask != null) {
            checkpointTask.cancel();
        }
        long now = System.currentTimeMillis();
        for (PlayerSession session : sessions.values().toArray(PlayerSession[]::new)) {
            close(session, now, "PLUGIN_STOP");
        }
    }

    // ---------- Sessies ----------

    @EventHandler(priority = EventPriority.MONITOR)
    public void onJoin(PlayerJoinEvent event) {
        open(event.getPlayer(), System.currentTimeMillis());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) {
        PlayerSession session = sessions.get(event.getPlayer().getUniqueId());
        if (session != null) {
            close(session, System.currentTimeMillis(), event.getReason().name());
        }
    }

    private void open(Player player, long now) {
        PlayerSession old = sessions.get(player.getUniqueId());
        if (old != null) {
            close(old, now, "REPLACED");
        }
        PlayerSession session = new PlayerSession(player, now, afkTimeoutMs);
        sessions.put(session.uuid, session);
        context().store().saveSession(session.snapshot(now, null, null));
        record(GameEvent.of(EventTypes.SESSION_START, player).time(now).meta("session", session.id).build());
    }

    private void close(PlayerSession session, long now, String reason) {
        sessions.remove(session.uuid);
        Player player = Bukkit.getPlayer(session.uuid);

        // Eerst een eventuele terugkeer verwerken (input kort voor de quit, nog niet getickt) ...
        AfkClock.Change change = session.afk.tick(now);
        if (change != null && !change.nowAfk()) {
            recordAfkChange(session, change, player);
        }
        // ... en daarna een nog lopende AFK-periode afsluiten op het quit-moment
        if (session.afk.isAfk()) {
            record(builder(EventTypes.AFK_END, player).time(now).value(session.afk.currentAfkMs(now))
                    .meta("session", session.id).meta("reason", "quit").build());
        }

        SessionRecord rec = session.snapshot(now, now, reason);
        context().store().saveSession(rec);
        record(builder(EventTypes.SESSION_END, player).time(now).subtype(reason).value(now - session.startedAt)
                .meta("session", session.id).meta("afk_ms", rec.afkMs()).build());
    }

    /** Speler-event als de speler er nog is, anders een event zonder speler-velden. */
    private static GameEvent.Builder builder(String type, Player player) {
        return player != null ? GameEvent.of(type, player) : GameEvent.of(type);
    }

    private void recordAfkChange(PlayerSession session, AfkClock.Change change, Player player) {
        if (change.nowAfk()) {
            record(builder(EventTypes.AFK_START, player).time(change.at()).meta("session", session.id).build());
        } else {
            record(builder(EventTypes.AFK_END, player).time(change.at()).value(change.afkDurationMs())
                    .meta("session", session.id).build());
        }
    }

    private void checkpoint() {
        long now = System.currentTimeMillis();
        for (PlayerSession session : sessions.values()) {
            context().store().saveSession(session.snapshot(now, null, null));
        }
    }

    // ---------- AFK ----------

    private void tickAfk() {
        long now = System.currentTimeMillis();
        for (PlayerSession session : sessions.values()) {
            AfkClock.Change change = session.afk.tick(now);
            if (change != null) {
                recordAfkChange(session, change, Bukkit.getPlayer(session.uuid));
            }
        }
    }

    private void input(Player player) {
        PlayerSession session = sessions.get(player.getUniqueId());
        if (session != null) {
            session.afk.input(System.currentTimeMillis());
        }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onMove(PlayerMoveEvent event) {
        Location from = event.getFrom();
        Location to = event.getTo();
        boolean looked = from.getYaw() != to.getYaw() || from.getPitch() != to.getPitch();
        if (looked) {
            input(event.getPlayer());
            return;
        }
        // Positie veranderd zonder rondkijken: alleen als input tellen als de speler zelf liep,
        // niet als water, een minecart of een boot hem meevoert (klassieke AFK-pools).
        Player player = event.getPlayer();
        boolean moved = from.getX() != to.getX() || from.getZ() != to.getZ();
        if (moved && !player.isInsideVehicle() && !player.isInWater() && !player.isGliding()) {
            input(player);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onJump(PlayerJumpEvent event) {
        input(event.getPlayer());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onSwing(PlayerAnimationEvent event) {
        input(event.getPlayer()); // slaan, minen, linksklikken
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onInteract(PlayerInteractEvent event) {
        input(event.getPlayer());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onInteractEntity(PlayerInteractEntityEvent event) {
        input(event.getPlayer());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onInventoryClick(InventoryClickEvent event) {
        if (event.getWhoClicked() instanceof Player player) {
            input(player);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onSneak(PlayerToggleSneakEvent event) {
        input(event.getPlayer());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onSprint(PlayerToggleSprintEvent event) {
        input(event.getPlayer());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onHotbar(PlayerItemHeldEvent event) {
        input(event.getPlayer());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onDrop(PlayerDropItemEvent event) {
        input(event.getPlayer());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onCommand(PlayerCommandPreprocessEvent event) {
        input(event.getPlayer());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onChat(AsyncChatEvent event) {
        // Komt binnen op een andere thread; de state alleen op de main thread aanpassen
        Player player = event.getPlayer();
        if (context().plugin().isEnabled()) {
            Bukkit.getScheduler().runTask(context().plugin(), () -> input(player));
        }
    }
}
