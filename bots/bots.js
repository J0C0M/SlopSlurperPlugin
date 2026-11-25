// Testbots voor de lokale server. Elke bot logt in als een echte speler (via Mineflayer),
// dus alle trackers van de plugin zien hem gewoon: sessies, AFK, blokken breken en plaatsen,
// kills, doden en posities.
//
// Elke bot heeft:
//  - een speelstijl (miner, builder, fighter, explorer, lazy): welke activiteiten hij vaak kiest;
//  - een speelschema (avondspeler, scholier, ...): wanneer hij online komt (zie schedule.js);
//  - vrienden: andere bots die hij opzoekt om samen te spelen;
//  - met --homes (experimenteel) een eigen basis: een plek waar hij een huisje met kist bouwt en
//    steeds naar terugkeert. Die plek wordt bewaard in state/<naam>.json.
//
// Gebruik:  node bots.js [--count 4] [--host localhost] [--port 25565] [--prefix Bot] [--pvp]
//                        [--schedule] [--homes] [--session-min 10] [--session-max 40] [--offline-min 1] [--offline-max 10]
//
// De server moet in offline mode draaien (start-server.ps1 -Bots), want bots hebben geen Minecraft-account.

const fs = require('fs')
const path = require('path')
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const { Schedule, SCHEDULE_NAMES, formatTime } = require('./schedule')
const { RunReport } = require('./report')

// ---------- instellingen ----------

function parseArgs (argv) {
  const opts = {
    count: 4,
    host: 'localhost',
    port: 25565,
    prefix: 'Bot',
    pvp: false, // bots vallen elkaar soms aan (nooit echte spelers)
    homes: false, // experimenteel: elke bot bouwt een eigen huis en keert daar steeds naar terug
    schedule: false, // speelschema's: bots spelen alleen op hun eigen tijden (avondspeler, scholier, ...)
    sessionMin: 10, // minuten online per sessie (zonder --schedule)
    sessionMax: 40,
    offlineMin: 1, // minuten offline tussen sessies (zonder --schedule)
    offlineMax: 10,
    only: '' // testhulp: alleen deze activiteit (bijv. home, social, mine)
  }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    if (!(key in opts)) {
      console.error(`Onbekende optie: ${argv[i]}`)
      process.exit(1)
    }
    if (typeof opts[key] === 'boolean') {
      opts[key] = true
    } else {
      const val = argv[++i]
      opts[key] = typeof opts[key] === 'number' ? Number(val) : val
      if (typeof opts[key] === 'number' && !Number.isFinite(opts[key])) {
        console.error(`Ongeldige waarde voor ${argv[i - 1]}: ${val}`)
        process.exit(1)
      }
    }
  }
  if (opts.prefix.length > 12) {
    console.error('--prefix mag maximaal 12 tekens zijn (Minecraft-namen zijn maximaal 16).')
    process.exit(1)
  }
  return opts
}

const opts = parseArgs(process.argv.slice(2))
const STATE_DIR = path.join(__dirname, 'state')
const REPORT_EVERY_MS = 5 * 60_000 // tussenstand, zodat er na een crash ook een rapport is
const report = new RunReport(process.argv.slice(2).join(' '))

// Elke bot krijgt een eigen speelstijl, zodat de data per speler verschilt.
const PERSONALITIES = {
  miner: { progress: 8, build: 0, fight: 1, explore: 1, idle: 1, chat: 1, home: 2, social: 2 },
  builder: { progress: 6, build: 1, fight: 1, explore: 1, idle: 1, chat: 1, home: 6, social: 2 },
  fighter: { progress: 6, build: 0, fight: 4, explore: 1, idle: 1, chat: 1, home: 1, social: 2 },
  explorer: { progress: 5, build: 0, fight: 1, explore: 4, idle: 1, chat: 1, home: 1, social: 2 },
  lazy: { progress: 3, build: 0, fight: 1, explore: 1, idle: 4, chat: 2, home: 2, social: 3 }
}
const PERSONALITY_NAMES = Object.keys(PERSONALITIES)
// Huizen bouwen is experimenteel (bots lopen in lastig terrein nog vast), dus standaard uit.
if (!opts.homes && opts.only !== 'home') for (const p of Object.values(PERSONALITIES)) delete p.home
if (opts.only && ![...Object.keys(PERSONALITIES.miner), 'mine'].includes(opts.only)) {
  console.error(`--only moet een van deze zijn: ${Object.keys(PERSONALITIES.miner).join(', ')}`)
  process.exit(1)
}

const MINEABLE = new Set([
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
  'stone', 'cobblestone', 'deepslate', 'andesite', 'diorite', 'granite',
  'coal_ore', 'iron_ore', 'copper_ore', 'deepslate_coal_ore', 'deepslate_iron_ore',
  'clay'
])
const NEEDS_PICKAXE = /stone|deepslate|andesite|diorite|granite|_ore$/
const BUILDING_BLOCKS = /(_planks|_log|cobblestone|^dirt$|^stone$|^sand$|deepslate|andesite|diorite|granite)$/
// Voor het huis: geen zand of grind (valt naar beneden). Hout en steen eerst.
const HOUSE_MATERIALS = [/_planks$/, /^cobblestone$/, /_log$/, /^(stone|andesite|diorite|granite|cobbled_deepslate)$/, /^dirt$/]
// Wat een bot in zijn kist opbergt in plaats van mee te sjouwen.
const LOOT = /(_ore$|^raw_|^coal$|seeds|^flint$|^string$|^bone$|rotten_flesh|gunpowder|^arrow$|^feather$|^leather$|_wool$|^egg$|_sapling$|^gravel$|^clay_ball$|^sand$|^stick$|^apple$)/
const TARGET_MOBS = new Set([
  'zombie', 'skeleton', 'spider', 'husk', 'drowned', 'slime',
  'cow', 'pig', 'sheep', 'chicken', 'rabbit'
])
const HOSTILE = new Set(['zombie', 'skeleton', 'spider', 'creeper', 'husk', 'drowned', 'slime', 'witch', 'cave_spider'])
const REPLACEABLE = new Set(['air', 'cave_air', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'snow', 'dead_bush'])
const NOT_GROUND = /(_leaves|_log|water|lava|ice)$/
const CHAT_LINES = [
  'hoi allemaal', 'iemand ijzer gevonden?', 'ik ga even minen', 'mooi weer vandaag',
  'wie bouwt er mee?', 'pas op, het wordt nacht', 'brb', 'gg', 'waar is iedereen?', 'lol'
]
const SOCIAL_LINES = ['hey {name}!', 'yo {name}', 'zullen we samen minen {name}?', 'ik kom naar je toe {name}', 'wacht op mij {name}']
const INVITE_LINES = ['kom je mee {name}?', '{name} kom eens kijken', 'ik ben hier {name}']
const HOME_LINES = ['terug naar huis', 'even mijn huis afbouwen', 'iemand mijn huis al gezien?', 'mijn kist is bijna vol']

// Een huis: 5x5 buitenmaat, muren 3 hoog, deuropening aan de -z-kant, plat dak.
// In het midden staat de bot; vanaf daar kan hij alles bereiken.
const HOUSE_RADIUS = 2
const TABLE_SPOT = new Vec3(1, 0, 1)
const CHEST_SPOT = new Vec3(-1, 0, 1)

// ---------- hulpfuncties ----------

const debug = (...args) => { if (process.env.BOTS_DEBUG) console.log('  [debug]', ...args) }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const rand = (min, max) => min + Math.random() * (max - min)
const randInt = (min, max) => Math.floor(rand(min, max + 1))
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const fill = (line, name) => line.replace('{name}', name)

function weightedPick (weights) {
  const entries = Object.entries(weights)
  let r = Math.random() * entries.reduce((s, [, w]) => s + w, 0)
  for (const [key, w] of entries) {
    r -= w
    if (r <= 0) return key
  }
  return entries[0][0]
}

class Timeout extends Error {}

// Een activiteit mag nooit eeuwig blijven hangen (vastgelopen pathfinding, onbereikbaar blok).
function withTimeout (promise, ms, onTimeout) {
  let timer
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        if (onTimeout) onTimeout()
        reject(new Timeout(`timeout na ${ms} ms`))
      }, ms)
    })
  ]).finally(() => clearTimeout(timer))
}

function houseCenter (home) {
  return new Vec3(home.x, home.y, home.z)
}

// Alle blokken van het huis, in bouwvolgorde: fundering, muren van onder naar boven, dak van buiten naar binnen.
function housePlan (home) {
  const c = houseCenter(home)
  const r = HOUSE_RADIUS
  const plan = []
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) plan.push(c.offset(dx, -1, dz))
  }
  for (let dy = 0; dy <= 2; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const edge = Math.abs(dx) === r || Math.abs(dz) === r
        const door = dx === 0 && dz === -r && dy < 2
        if (edge && !door) plan.push(c.offset(dx, dy, dz))
      }
    }
  }
  for (let ring = r; ring >= 0; ring--) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) === ring) plan.push(c.offset(dx, 3, dz))
      }
    }
  }
  return plan
}

// Alle bots, zodat ze elkaar kunnen vinden en elkaars huis niet afbreken.
const ALL_BOTS = []

function isProtected (pos) {
  for (const b of ALL_BOTS) {
    const h = b.state.home
    if (!h) continue
    if (Math.abs(pos.x - h.x) <= HOUSE_RADIUS + 1 && Math.abs(pos.z - h.z) <= HOUSE_RADIUS + 1 &&
      pos.y >= h.y - 1 && pos.y <= h.y + 4) return true
  }
  return false
}

// Paper weigert verbindingen die binnen 4 s na elkaar van hetzelfde IP komen (connection-throttle).
let lastConnect = 0
async function connectSlot () {
  for (;;) {
    const wait = lastConnect + 5000 - Date.now()
    if (wait <= 0) {
      lastConnect = Date.now()
      return
    }
    await sleep(wait)
  }
}

// ---------- één bot ----------

class PlayerBot {
  constructor (index, name, personality, scheduleName) {
    this.index = index
    this.name = name
    this.personality = personality
    this.schedule = new Schedule(name, scheduleName)
    this.friends = []
    this.bot = null
    this.online = false
    this.busy = false
    this.invite = null
    this.deaths = 0
    this.deathsAtStart = 0
    this.stepDeadline = Infinity
    this.deathSpot = null
    this.skipBlocks = new Map() // onbereikbare blokken, tot wanneer overslaan
    this.state = this.loadState()
    this.stats = report.add(name, personality, Object.keys(this.state.milestones || {}))
  }

  log (...args) {
    console.log(`[${new Date().toLocaleTimeString()}] [${this.name}]`, ...args)
  }

  // ---------- opslag (basis) ----------

  get statePath () {
    return path.join(STATE_DIR, `${this.name}.json`)
  }

  loadState () {
    try {
      return JSON.parse(fs.readFileSync(this.statePath, 'utf8'))
    } catch {
      return {}
    }
  }

  saveState () {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2))
  }

  // ---------- sessies ----------

  // Inloggen, spelen, uitloggen, pauze, opnieuw. Met een schema alleen binnen de speeltijden.
  async lifecycle () {
    let announced = null
    let resumeUntil = null
    for (;;) {
      let sessionMs
      if (resumeUntil && resumeUntil - Date.now() > 60_000) {
        // Na opnieuw inloggen (vastgezeten) de lopende sessie afmaken.
        sessionMs = resumeUntil - Date.now()
      } else if (!opts.schedule) {
        sessionMs = rand(opts.sessionMin, opts.sessionMax) * 60_000
      } else {
        const until = this.schedule.activeUntil()
        if (!until) {
          const next = this.schedule.nextStart()
          if (announced !== next) this.log(`offline tot ${formatTime(next)} (${this.schedule.label})`)
          announced = next
          await sleep(Math.min(Math.max(next - Date.now(), 1000), 30 * 60_000))
          continue
        }
        const left = until - Date.now()
        if (left < 3 * 60_000) {
          await sleep(left + 1000)
          continue
        }
        sessionMs = Math.min(this.schedule.sessionMinutes() * 60_000, left)
      }

      resumeUntil = null
      const ended = await this.playSession(sessionMs)
      if (ended === 'rejoin') {
        resumeUntil = this.sessionEndsAt
        await sleep(rand(5000, 15_000))
        continue
      }
      let pause
      if (ended === 'error') pause = rand(0.2, 0.5)
      else if (!opts.schedule) pause = rand(opts.offlineMin, opts.offlineMax)
      else pause = this.schedule.pauseMinutes()
      this.log(`pauze van ${pause.toFixed(1)} min`)
      await sleep(pause * 60_000)
    }
  }

  async playSession (durationMs) {
    await connectSlot()
    return new Promise((resolve) => {
      let settled = false
      const finish = (why) => {
        if (settled) return
        settled = true
        this.online = false
        clearInterval(this.headWatch)
        clearTimeout(sessionTimer)
        resolve(why)
      }

      const bot = mineflayer.createBot({
        host: opts.host,
        port: opts.port,
        username: this.name,
        auth: 'offline',
        version: '1.21.11',
        viewDistance: 5, // minder chunks per bot: scheelt ongeveer de helft van het geheugen
        hideErrors: true
      })
      this.bot = bot
      this.sessionEndsAt = Date.now() + durationMs
      this.rejoinRequested = false
      this.stuckLog = []
      this.forcedMoves = []
      bot.loadPlugin(pathfinder)
      this.stats.attach(bot)
      // De server zet de bot terug (teleport). Gebeurt dat tientallen keren achter elkaar, dan
      // keurt de server zijn bewegingen af en komt hij niet meer vooruit.
      bot.on('forcedMove', () => {
        const now = Date.now()
        this.forcedMoves.push(now)
        while (this.forcedMoves.length && this.forcedMoves[0] < now - 3000) this.forcedMoves.shift()
      })

      const sessionTimer = setTimeout(() => {
        this.log('sessie voorbij, uitloggen')
        bot.quit()
      }, durationMs)

      bot.once('spawn', () => {
        // Mineflayer zet een bot die tegen een muur loopt exact op de blokrand. Paper telt dat door
        // afronding als botsing en zet hem elke tick terug. Een fractie breder voorkomt dat. Werkt
        // samen met patches/prismarine-physics (marge in de botsingen); ze zijn allebei nodig.
        bot.physics.playerHalfWidth = 0.30001
        this.online = true
        this.defending = false
        this.freeing = false
        this.invite = null
        clearInterval(this.headWatch)
        this.headWatch = setInterval(() => { this.freeHead() }, 200)
        this.moves = { gentle: this.makeMovements(true), rough: this.makeMovements(false) }
        bot.pathfinder.setMovements(this.moves.gentle)
        const label = !opts.schedule ? '' : ` (${this.schedule.label})`
        this.log(`online als ${this.personality}${label} voor ${(durationMs / 60_000).toFixed(0)} min`)
        this.brain().catch((err) => this.log('brain gestopt:', err.message))
      })

      bot.on('death', () => {
        this.deaths++
        this.log('dood gegaan')
        if (bot.entity) this.deathSpot = { pos: bot.entity.position.clone(), t: Date.now() }
        bot.pathfinder.setGoal(null)
      })
      bot.on('entityHurt', (entity) => {
        if (entity === bot.entity) this.onHurt()
      })
      bot.on('kicked', (reason) => {
        const text = typeof reason === 'string' ? reason : JSON.stringify(reason)
        this.log('gekickt:', text)
        this.stats.kicks.push(text)
      })
      bot.on('error', (err) => {
        this.stats.error(err.code || err.message)
        if (err.code === 'ECONNREFUSED') this.log(`server niet bereikbaar op ${opts.host}:${opts.port}, later opnieuw`)
        else this.log('fout:', err.message)
        finish('error')
      })
      bot.on('end', (reason) => {
        if (this.rejoinRequested) return finish('rejoin')
        if (this.online) this.log('verbinding verbroken:', reason)
        finish(this.online || reason === 'disconnect.quitting' ? 'ended' : 'error')
      })
    })
  }

  // Kiest steeds een volgende activiteit, zolang de bot online is.
  async brain () {
    await sleep(rand(2000, 5000))
    while (this.online) {
      // Terugvechten (onHurt) gaat voor; pas daarna weer een eigen activiteit.
      while ((this.defending || this.freeing) && this.online) await sleep(200)
      if (!this.online) break
      let activity = opts.only || weightedPick(PERSONALITIES[this.personality])
      // Een uitnodiging van een vriend gaat meestal voor.
      const invite = this.invite
      this.invite = null
      if (invite && invite.until > Date.now() && invite.from.online && Math.random() < 0.8) activity = 'joinFriend'
      if (!opts.only || opts.only === 'progress') {
        if (this.deathSpot) activity = 'recover'
        // Zonder armor 's nachts niet rondzwerven, maar ondergronds verder werken.
        else if (this.isNight() && this.armorPieces() < 2 && !['idle', 'chat'].includes(activity)) activity = 'progress'
      }
      this.startWork()
      this.busy = true
      try {
        await this.eatIfHungry()
        if (activity === 'joinFriend') await this.joinFriend(invite.from)
        else await this[activity]()
      } catch (err) {
        // Afgebroken routes (terugvechten, timeout) en onbereikbare doelen zijn normaal, niet loggen.
        const expected = err instanceof Timeout || /goal was changed|Path was stopped|No path to the goal|Digging aborted|Took to long/i.test(err.message)
        if (!expected && this.online) this.log(`${activity} mislukt:`, err.message)
        else debug(this.name, `${activity} gestopt:`, err.message)
        if (this.online) this.bot.pathfinder.setGoal(null)
      } finally {
        this.busy = false
      }
      await sleep(rand(500, 3000))
    }
  }

  // Naar een doel lopen. Komt de bot een paar seconden niet vooruit (bijv. in ondiep water
  // tegen een oever, waar de pathfinder wel een route vindt maar niet loskomt), dan breekt hij
  // af, springt een willekeurige kant op en gooit een Timeout, zodat de aanroeper opnieuw kan.
  // Twee manieren van lopen (idee uit Mindcraft): "gentle" maakt graven en bouwen duur, zodat de
  // bot om heuvels heen loopt in plaats van erdoorheen te hakken. Dat geeft minder vastlopen op
  // opstapjes en schonere data (minder gebroken/geplaatste blokken die alleen van de route komen).
  // Alleen als er zo geen route is, mag hij hakken en bouwen ("rough").
  makeMovements (gentle) {
    const moves = new Movements(this.bot)
    moves.canDig = true
    moves.allow1by1towers = true
    moves.allowParkour = true
    if (gentle) {
      moves.digCost = 10
      moves.placeCost = 2
    }
    // Liever om water heen: zwemmen tegen een oever op lukt de pathfinder slecht.
    moves.liquidCost = 6
    // Huizen (van alle bots) niet afbreken en er niet in bouwen tijdens het lopen.
    moves.exclusionAreasBreak.push((block) => block.position && isProtected(block.position) ? 100 : 0)
    moves.exclusionAreasPlace.push((block) => block.position && isProtected(block.position) ? 100 : 0)
    return moves
  }

  chooseMovements (goal) {
    const bot = this.bot
    let moves = this.moves.rough
    try {
      if (bot.pathfinder.getPathTo(this.moves.gentle, goal, 250).status === 'success') moves = this.moves.gentle
    } catch {}
    bot.pathfinder.setMovements(moves)
  }

  async goto (goal, ms = 45_000) {
    const bot = this.bot
    this.chooseMovements(goal)
    let last = bot.entity.position.clone()
    let lastMove = Date.now()
    let stuck = false
    const watch = setInterval(() => {
      const p = bot.entity?.position
      if (!p) return
      if (p.distanceTo(last) > 0.7) {
        last = p.clone()
        lastMove = Date.now()
      } else if (this.forcedMoves.length > 30 ||
        (Date.now() - lastMove > 7000 && !bot.pathfinder.isMining() && !bot.pathfinder.isBuilding())) {
        stuck = true
        bot.pathfinder.setGoal(null)
      }
    }, 1000)
    try {
      await withTimeout(bot.pathfinder.goto(goal), ms, () => bot.pathfinder.setGoal(null))
    } catch (err) {
      if (stuck) {
        this.stats.stuck++
        await this.unstuck(goal)
        this.checkRejoin()
        throw new Timeout('vast komen te zitten')
      }
      throw err
    } finally {
      clearInterval(watch)
      // Volgen (vechten, samen spelen) gebeurt altijd met de zachte manier van lopen.
      if (this.online) bot.pathfinder.setMovements(this.moves.gentle)
    }
  }

  // Laatste redmiddel (ook uit Mindcraft): blijft de bot op dezelfde plek vastzitten, dan
  // uitloggen en na een paar seconden opnieuw inloggen. Dat haalt hem ook uit de terugzet-lus.
  checkRejoin () {
    const bot = this.bot
    const now = Date.now()
    const here = bot.entity.position.clone()
    this.stuckLog.push({ t: now, pos: here })
    this.stuckLog = this.stuckLog.filter((s) => s.t > now - 90_000)
    const sameSpot = this.stuckLog.filter((s) => s.pos.distanceTo(here) < 4)
    if (sameSpot.length >= 3 || this.forcedMoves.length > 30) {
      this.log('zit vast, logt opnieuw in')
      this.rejoinRequested = true
      this.stats.rejoins++
      bot.quit()
    }
  }

  // Losmaken: met springen ingedrukt richting het doel (of willekeurig) lopen of zwemmen.
  async unstuck (goal) {
    const bot = this.bot
    const p = bot.entity.position
    const feet = p.floored()
    const inWater = bot.blockAt(feet)?.name === 'water'
    debug(this.name, `zit vast${inWater ? ' in water' : ''}, maakt zich los bij`, feet.toString())
    let yaw = rand(0, Math.PI * 2)
    if (goal && Number.isFinite(goal.x) && Number.isFinite(goal.z) && Math.random() < 0.7) {
      // Mineflayer-yaw: 0 = noord (-z), positief = tegen de klok in.
      yaw = Math.atan2(-(goal.x - p.x), -(goal.z - p.z)) + rand(-0.6, 0.6)
    }
    await bot.look(yaw, 0, true)
    bot.setControlState('forward', true)
    bot.setControlState('jump', true)
    bot.setControlState('sprint', !inWater)
    await sleep(inWater ? rand(2500, 4000) : rand(1200, 2500))
    bot.clearControlStates()
  }

  // Lopen naar een plek die ver weg kan zijn: in stukken van hooguit ~50 blokken,
  // zodat de pathfinder niet vastloopt op een te grote zoekruimte.
  async walkTo (target, range = 3, totalMs = 180_000) {
    const bot = this.bot
    const deadline = Date.now() + totalMs
    let noPath = 0
    while (this.online && Date.now() < deadline && noPath < 3) {
      const here = bot.entity.position
      const dx = target.x - here.x
      const dz = target.z - here.z
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist <= range + 1 && Math.abs(target.y - here.y) < 4) return true
      try {
        if (dist > 50) {
          const f = 45 / dist
          await this.goto(new goals.GoalNearXZ(here.x + dx * f, here.z + dz * f, 4), 60_000)
        } else {
          await this.goto(new goals.GoalNear(target.x, target.y, target.z, range), 60_000)
          return true
        }
      } catch (err) {
        debug(this.name, `walkTo ${target.floored()} vanaf ${here.floored()} (${dist.toFixed(0)} blokken):`, err.message)
        if (!(err instanceof Timeout) && !/No path|Path was stopped|goal was changed|Took to long/i.test(err.message)) throw err
        if (/Took to long|No path/i.test(err.message)) noPath++
        // Kort een andere kant op en opnieuw proberen.
        if (Date.now() < deadline) await this.explore(10).catch(() => {})
      }
    }
    return false
  }

  // ---------- activiteiten ----------

  async explore (maxDist = 80) {
    const bot = this.bot
    const angle = Math.random() * Math.PI * 2
    const dist = rand(Math.min(20, maxDist), maxDist)
    const target = bot.entity.position.offset(Math.cos(angle) * dist, 0, Math.sin(angle) * dist)
    bot.setControlState('sprint', Math.random() < 0.5)
    try {
      await this.goto(new goals.GoalNearXZ(target.x, target.z, 3), 60_000)
    } finally {
      bot.setControlState('sprint', false)
    }
    await this.lookAround(randInt(2, 5))
  }

  async mine (only = null) {
    const bot = this.bot
    const rounds = randInt(3, 10)
    for (let i = 0; i < rounds && this.online; i++) {
      const block = bot.findBlock({
        matching: (b) => (only ? only.test(b.name) : MINEABLE.has(b.name)) &&
          (!NEEDS_PICKAXE.test(b.name) || this.hasItem(/_pickaxe$/)),
        useExtraInfo: (b) => !isProtected(b.position) && !(this.skipBlocks.get(b.position.toString()) > Date.now()),
        maxDistance: 32,
        count: 1
      })
      if (!block) {
        await this.explore()
        return
      }
      try {
        await this.goto(new goals.GoalLookAtBlock(block.position, bot.world), 30_000)
      } catch {
        if (!this.online || this.defending) return
        // Onbereikbaar (bijv. hoog in een boom): een tijdje overslaan, anders kiest hij steeds hetzelfde blok.
        this.skipBlocks.set(block.position.toString(), Date.now() + 5 * 60_000)
        continue
      }
      const current = bot.blockAt(block.position)
      if (!current || current.name !== block.name || !bot.canDigBlock(current)) continue
      await this.equipToolFor(current)
      await withTimeout(bot.dig(current), 20_000, () => bot.stopDigging())
      await this.collectDrops()
    }
  }

  async build () {
    const bot = this.bot
    const count = randInt(4, 16)
    let placed = 0
    for (let tries = 0; placed < count && tries < count * 5 && this.online; tries++) {
      const item = bot.inventory.items().find((it) => BUILDING_BLOCKS.test(it.name))
      if (!item) {
        if (placed === 0) await this.mine()
        return
      }
      await bot.equip(item, 'hand')
      // Een plek naast de bot op een vast blok (de grond, of een eerder geplaatst blok: zo
      // ontstaan muurtjes), met erboven lucht of gras.
      const base = bot.entity.position.floored()
      const offset = new Vec3(randInt(-2, 2), Math.random() < 0.6 ? -1 : 0, randInt(-2, 2))
      if (Math.abs(offset.x) + Math.abs(offset.z) === 0) continue
      const ref = bot.blockAt(base.plus(offset))
      const above = ref && bot.blockAt(ref.position.offset(0, 1, 0))
      if (!ref || !above || ref.boundingBox !== 'block' || !REPLACEABLE.has(above.name)) continue
      if (this.overlapsMe(above.position) || isProtected(above.position)) continue
      try {
        await bot.lookAt(ref.position.offset(0.5, 1, 0.5))
        await withTimeout(bot.placeBlock(ref, new Vec3(0, 1, 0)), 5_000)
        placed++
        await sleep(rand(250, 900))
      } catch {
        // Plaatsen mislukt (geen zicht, entity in de weg); volgende plek proberen.
      }
    }
  }

  async fight (target) {
    const bot = this.bot
    target = target || (bot.health >= 12 ? this.findTarget() : null)
    if (!target) {
      await this.explore()
      return
    }
    await this.equipWeapon()
    bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true)
    const start = Date.now()
    try {
      while (this.online && target.isValid && Date.now() - start < 60_000) {
        if (bot.entity.position.distanceTo(target.position) < 3.2) {
          await bot.lookAt(target.position.offset(0, target.height * 0.8, 0))
          bot.attack(target)
          await sleep(650)
        } else {
          await sleep(200)
        }
        if (bot.health < 6) break // wegrennen bij weinig hartjes
      }
    } finally {
      bot.pathfinder.setGoal(null)
    }
    await this.collectDrops()
  }

  // Blijft stilstaan. Lang genoeg en de AFK-tracker telt het als AFK.
  async idle () {
    const bot = this.bot
    const afk = Math.random() < 0.3
    const ms = afk ? rand(200_000, 360_000) : rand(10_000, 60_000)
    if (afk) this.log(`gaat ${(ms / 60_000).toFixed(1)} min AFK`)
    const end = Date.now() + ms
    while (this.online && Date.now() < end) {
      if (!afk && Math.random() < 0.3) await this.lookAround(1)
      await sleep(5000)
    }
  }

  async chat () {
    this.bot.chat(pick(CHAT_LINES))
    await this.lookAround(randInt(1, 3))
  }

  // ---------- samen spelen ----------

  onlineBuddies () {
    // Alleen wie redelijk in de buurt is: iemand diep in een mijn vindt de pathfinder niet.
    const me = this.bot.entity.position
    return ALL_BOTS.filter((b) => b !== this && b.online && b.bot?.entity &&
      Math.abs(b.bot.entity.position.y - me.y) < 15 && b.bot.entity.position.distanceTo(me) < 150)
  }

  // Zoekt een andere bot op (meestal een vriend) en speelt een tijdje met hem samen.
  async social () {
    const buddies = this.onlineBuddies()
    if (buddies.length === 0) {
      await this.idle()
      return
    }
    const friends = buddies.filter((b) => this.friends.includes(b))
    const buddy = friends.length > 0 && Math.random() < 0.75 ? pick(friends) : pick(buddies)
    this.log(`zoekt ${buddy.name} op`)
    // Soms nodigt hij de ander uit, die dan ook naar hem toe komt.
    if (Math.random() < 0.5) {
      buddy.invite = { from: this, until: Date.now() + 2 * 60_000 }
      this.bot.chat(fill(pick(INVITE_LINES), buddy.name))
    }
    if (await this.reach(buddy)) await this.hangOut(buddy, rand(60_000, 240_000))
    else if (this.online) this.log(`kon ${buddy.name} niet bereiken`)
  }

  async joinFriend (friend) {
    this.log(`gaat naar ${friend.name} toe`)
    this.bot.chat(pick(['oke ik kom', 'ben onderweg', 'wacht even']))
    if (await this.reach(friend)) await this.hangOut(friend, rand(60_000, 240_000))
  }

  // Loopt naar een andere bot toe. Zijn positie komt uit de gedeelde lijst, dus dat werkt
  // ook als hij nog buiten zicht is.
  async reach (buddy) {
    for (let attempt = 0; attempt < 4 && this.online && buddy.online; attempt++) {
      const target = buddy.bot.entity.position
      if (this.bot.entity.position.distanceTo(target) < 6) return true
      await this.walkTo(target, 3, 90_000)
    }
    return this.online && buddy.online && this.bot.entity.position.distanceTo(buddy.bot.entity.position) < 8
  }

  // Bij een andere bot blijven: volgen, rondkijken, af en toe samen iets minen of een mob aanvallen.
  async hangOut (buddy, ms) {
    const bot = this.bot
    this.log(`speelt samen met ${buddy.name}`)
    bot.chat(fill(pick(SOCIAL_LINES), buddy.name))
    const end = Date.now() + ms
    try {
      while (this.online && buddy.online && Date.now() < end) {
        const other = bot.players[buddy.name]?.entity
        if (!other) {
          if (!await this.reach(buddy)) return
          continue
        }
        if (bot.entity.position.distanceTo(other.position) > 5) {
          bot.pathfinder.setGoal(new goals.GoalFollow(other, 3), true)
          await sleep(2000)
          continue
        }
        bot.pathfinder.setGoal(null)
        const r = Math.random()
        if (r < 0.15) {
          const mob = this.findTarget(12)
          if (mob) await this.fight(mob)
        } else if (r < 0.35) {
          await this.mineOneNearby()
        } else if (r < 0.42) {
          bot.chat(pick(CHAT_LINES))
        } else {
          await bot.lookAt(other.position.offset(0, 1.6, 0))
          await sleep(rand(1500, 4000))
        }
      }
    } finally {
      bot.pathfinder.setGoal(null)
    }
  }

  async mineOneNearby () {
    const bot = this.bot
    const block = bot.findBlock({
      matching: (b) => MINEABLE.has(b.name) && (!NEEDS_PICKAXE.test(b.name) || this.hasItem(/_pickaxe$/)),
      useExtraInfo: (b) => !isProtected(b.position),
      maxDistance: 6
    })
    if (!block || !bot.canDigBlock(block)) return
    await this.equipToolFor(block)
    await withTimeout(bot.dig(block), 15_000, () => bot.stopDigging())
  }

  // ---------- eigen basis ----------

  // Naar huis: verder bouwen, inrichten, spullen opbergen, even rondhangen.
  async home () {
    if (!this.state.home) {
      await this.chooseHome()
      return
    }
    const c = houseCenter(this.state.home)
    if (!await this.walkTo(c, 2)) {
      debug(this.name, 'kon niet thuiskomen')
      return
    }
    if (Math.random() < 0.3) this.bot.chat(pick(HOME_LINES))
    const result = await this.buildHouse(randInt(12, 30))
    debug(this.name, 'huis:', result, 'materiaal:', this.houseMaterial()?.name ?? '-', 'pos:', this.bot.entity.position.floored().toString())
    if (result === 'no-materials') {
      this.log('heeft geen bouwmateriaal meer, gaat materiaal halen')
      await this.mine(Math.random() < 0.8 ? /_log$/ : /^(dirt|grass_block)$/)
      return
    }
    if (result === 'done') {
      await this.furnish()
      await this.storeLoot()
      await this.lookAround(randInt(2, 5))
    }
  }

  // Kiest een vlakke plek voor een huis, een eind van het spawnpunt en van de andere huizen.
  async chooseHome () {
    const bot = this.bot
    const origin = bot.spawnPoint || bot.entity.position
    const angle = (this.index / Math.max(opts.count, 1)) * Math.PI * 2 + rand(-0.4, 0.4)
    const dist = rand(35, 70)
    const target = new Vec3(origin.x + Math.cos(angle) * dist, bot.entity.position.y, origin.z + Math.sin(angle) * dist)
    this.log('zoekt een plek voor een huis')
    await this.walkTo(target, 6)
    const spot = this.findFlatSpot(12)
    if (!spot) {
      this.log('geen vlakke plek gevonden, later opnieuw')
      return
    }
    this.state.home = { x: spot.x, y: spot.y, z: spot.z }
    this.saveState()
    this.log(`bouwt een huis bij ${spot.x} ${spot.y} ${spot.z}`)
  }

  // Hoogte waar je op de grond staat (voeten), of null bij water, bomen of lava.
  groundLevel (x, z, aroundY) {
    for (let y = aroundY + 6; y >= aroundY - 8; y--) {
      const b = this.bot.blockAt(new Vec3(x, y, z))
      if (!b) return null
      if (/water|lava/.test(b.name)) return null
      if (b.boundingBox === 'block') return NOT_GROUND.test(b.name) ? null : y + 1
    }
    return null
  }

  findFlatSpot (radius) {
    const bot = this.bot
    const here = bot.entity.position.floored()
    const r = HOUSE_RADIUS
    const others = ALL_BOTS.filter((b) => b !== this && b.state.home).map((b) => b.state.home)
    const candidates = []
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) candidates.push([dx, dz])
    }
    candidates.sort((a, b) => (a[0] ** 2 + a[1] ** 2) - (b[0] ** 2 + b[1] ** 2))
    for (const [dx, dz] of candidates) {
      const x = here.x + dx
      const z = here.z + dz
      if (others.some((h) => Math.abs(h.x - x) < 12 && Math.abs(h.z - z) < 12)) continue
      const y = this.groundLevel(x, z, here.y)
      if (y === null) continue
      let flat = true
      for (let ix = -r; ix <= r && flat; ix++) {
        for (let iz = -r; iz <= r && flat; iz++) {
          const g = this.groundLevel(x + ix, z + iz, y)
          // Een blok lager mag: de fundering vult dat op.
          if (g !== y && g !== y - 1) flat = false
        }
      }
      if (flat && !this.waterNear(x, y, z, 6)) return new Vec3(x, y, z)
    }
    return null
  }

  waterNear (x, y, z, r) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dy = -3; dy <= 1; dy++) {
          if (this.bot.blockAt(new Vec3(x + dx, y + dy, z + dz))?.name === 'water') return true
        }
      }
    }
    return false
  }

  houseMaterial () {
    const items = this.bot.inventory.items()
    for (const re of HOUSE_MATERIALS) {
      const item = items.find((it) => re.test(it.name))
      if (item) return item
    }
    return null
  }

  // Plaatst een blok op pos, tegen een vast blok ernaast.
  async placeAt (pos, item) {
    const bot = this.bot
    await bot.equip(item, 'hand')
    const dirs = [new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, 1, 0)]
    for (const d of dirs) {
      const ref = bot.blockAt(pos.plus(d))
      // Niet tegen kisten of werkbanken klikken, dan gaat er een scherm open.
      if (!ref || ref.boundingBox !== 'block' || /chest|crafting_table|furnace/.test(ref.name)) continue
      try {
        await withTimeout(bot.placeBlock(ref, new Vec3(-d.x, -d.y, -d.z)), 5_000)
        return true
      } catch {}
    }
    return false
  }

  // Bouwt verder aan het huis, hooguit `budget` blokken per keer. Zo groeit het over meerdere bezoeken.
  async buildHouse (budget) {
    const bot = this.bot
    const c = houseCenter(this.state.home)
    try {
      await this.goto(new goals.GoalBlock(c.x, c.y, c.z), 30_000)
    } catch {
      await this.goto(new goals.GoalNear(c.x, c.y, c.z, 1), 20_000)
    }
    const plan = housePlan(this.state.home)
    const missing = () => plan.filter((p) => {
      const b = bot.blockAt(p)
      return b && REPLACEABLE.has(b.name)
    })
    let placed = 0
    for (let pass = 0; pass < 3 && this.online && placed < budget; pass++) {
      let progress = false
      for (const pos of missing()) {
        if (placed >= budget || !this.online) break
        const item = this.houseMaterial()
        if (!item) return placed > 0 ? 'progress' : 'no-materials'
        if (this.overlapsMe(pos)) continue
        if (bot.entity.position.offset(0, 1.6, 0).distanceTo(pos.offset(0.5, 0.5, 0.5)) > 4.4) continue
        if (await this.placeAt(pos, item)) {
          placed++
          progress = true
          await sleep(rand(200, 700))
        }
      }
      if (!progress) break
    }
    const left = missing().length
    debug(this.name, `geplaatst ${placed}, nog ${left} te gaan`)
    if (left === 0 && !this.state.houseDone) {
      this.state.houseDone = true
      this.saveState()
      this.log('huis is af!')
      bot.chat('mijn huis is af :)')
    }
    if (left === 0) return 'done'
    return placed > 0 ? 'progress' : 'stuck'
  }

  // Werkbank en kist in het huis zetten.
  async furnish () {
    const bot = this.bot
    const c = houseCenter(this.state.home)
    const tablePos = c.plus(TABLE_SPOT)
    const chestPos = c.plus(CHEST_SPOT)
    if (bot.blockAt(tablePos)?.name !== 'crafting_table') {
      if (this.hasItem(/^crafting_table$/) || await this.craft('crafting_table', 1, null)) {
        const item = bot.inventory.items().find((it) => it.name === 'crafting_table')
        if (item && REPLACEABLE.has(bot.blockAt(tablePos)?.name)) await this.placeAt(tablePos, item)
      }
    }
    if (bot.blockAt(chestPos)?.name !== 'chest') {
      const table = bot.blockAt(tablePos)?.name === 'crafting_table' ? bot.blockAt(tablePos) : null
      if (!table) return
      await this.makePlanks(8)
      if (this.hasItem(/^chest$/) || await this.craft('chest', 1, table)) {
        const item = bot.inventory.items().find((it) => it.name === 'chest')
        if (item && REPLACEABLE.has(bot.blockAt(chestPos)?.name) && await this.placeAt(chestPos, item)) {
          this.log('heeft een kist in zijn huis gezet')
        }
      }
    }
  }

  // Buit en overtollige blokken in de kist doen.
  async storeLoot () {
    const bot = this.bot
    const chestBlock = bot.blockAt(houseCenter(this.state.home).plus(CHEST_SPOT))
    if (chestBlock?.name !== 'chest') return
    const toStore = []
    const kept = {}
    for (const it of bot.inventory.items()) {
      if (LOOT.test(it.name)) {
        toStore.push([it, it.count])
      } else if (BUILDING_BLOCKS.test(it.name) && !/_planks$|_log$/.test(it.name)) {
        // Van steen en aarde houdt hij er 32 per soort bij zich.
        kept[it.name] = (kept[it.name] || 0) + it.count
        const extra = kept[it.name] - 32
        if (extra > 0) toStore.push([it, Math.min(extra, it.count)])
      }
    }
    if (toStore.length === 0) return
    let chest
    try {
      chest = await withTimeout(bot.openContainer(chestBlock), 5_000)
      for (const [it, amount] of toStore) {
        try { await chest.deposit(it.type, null, amount) } catch {}
      }
    } catch {
      // Kist kon niet open (te ver, geblokkeerd); volgende keer.
    } finally {
      if (chest) chest.close()
    }
  }

  // ---------- reacties en onderhoud ----------

  onHurt () {
    const bot = this.bot
    if (this.defending || !this.online) return
    // 16 blokken: skeletons schieten van een afstand.
    const attacker = bot.nearestEntity((e) => HOSTILE.has(e.name) && e.position.distanceTo(bot.entity.position) < 16)
    if (!attacker) return
    this.defending = true
    bot.pathfinder.setGoal(null)
    bot.stopDigging()
    // Wacht tot de huidige activiteit stopt; vecht dan terug, of vlucht bij weinig hartjes.
    const defend = async () => {
      for (let i = 0; i < 50 && this.busy; i++) await sleep(100)
      try {
        if (attacker.name === 'creeper' || bot.health < 8 || attacker.position.distanceTo(bot.entity.position) > 6) await this.flee(attacker)
        else await this.fight(attacker)
      } catch {}
      this.defending = false
    }
    defend()
  }

  // Wegrennen van een mob tot hij ver genoeg weg is (of na een paar seconden).
  async flee (from) {
    const bot = this.bot
    debug(this.name, `vlucht voor ${from.name} (${bot.health.toFixed(0)} hp)`)
    bot.pathfinder.setGoal(new goals.GoalInvert(new goals.GoalFollow(from, 20)), true)
    bot.setControlState('sprint', true)
    const end = Date.now() + rand(5000, 9000)
    try {
      while (this.online && from.isValid && Date.now() < end) {
        if (from.position.distanceTo(bot.entity.position) > 20) break
        await sleep(300)
      }
    } finally {
      bot.pathfinder.setGoal(null)
      bot.setControlState('sprint', false)
    }
  }

  // Zou een blok op deze plek in de hitbox van de bot zelf komen?
  overlapsMe (pos) {
    const p = this.bot.entity.position
    return Math.abs(pos.x + 0.5 - p.x) < 0.85 && Math.abs(pos.z + 0.5 - p.z) < 0.85 &&
      pos.y > p.y - 1 && pos.y < p.y + 1.8
  }

  findTarget (maxDist = 48) {
    const bot = this.bot
    const me = bot.entity.position
    return bot.nearestEntity((e) => {
      // Ongeveer op dezelfde hoogte, zodat de bot niet naar mobs diep in een grot gaat graven.
      if (e === bot.entity || e.position.distanceTo(me) > maxDist || Math.abs(e.position.y - me.y) > 8) return false
      if (e.type === 'player') {
        // Alleen andere bots, nooit echte spelers. Niet je vrienden.
        if (!opts.pvp || e.username === this.name || !e.username?.startsWith(opts.prefix)) return false
        if (this.friends.some((f) => f.name === e.username)) return false
        return Math.random() < 0.15
      }
      return TARGET_MOBS.has(e.name)
    })
  }

  async lookAround (times) {
    const bot = this.bot
    for (let i = 0; i < times && this.online; i++) {
      await bot.look(rand(0, Math.PI * 2), rand(-0.5, 0.5), false)
      if (Math.random() < 0.3) {
        bot.setControlState('jump', true)
        await sleep(300)
        bot.setControlState('jump', false)
      }
      await sleep(rand(800, 2500))
    }
  }

  async collectDrops () {
    const bot = this.bot
    const drop = bot.nearestEntity((e) => e.name === 'item' && e.position.distanceTo(bot.entity.position) < 8)
    if (drop) {
      try { await this.goto(new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 1), 8_000) } catch {}
    }
  }

  hasItem (pattern) {
    return this.bot.inventory.items().some((it) => pattern.test(it.name))
  }

  countItems (pattern) {
    return this.bot.inventory.items().filter((it) => pattern.test(it.name)).reduce((s, it) => s + it.count, 0)
  }

  async equipToolFor (block) {
    const bot = this.bot
    const pattern = NEEDS_PICKAXE.test(block.name)
      ? /_pickaxe$/
      : /_log$/.test(block.name) ? /_axe$/ : /_shovel$/
    const tool = bot.inventory.items().find((it) => pattern.test(it.name))
    if (tool) await bot.equip(tool, 'hand')
  }

  async equipWeapon () {
    const bot = this.bot
    const weapon = bot.inventory.items().find((it) => /_sword$/.test(it.name)) ||
      bot.inventory.items().find((it) => /_axe$/.test(it.name))
    if (weapon) await bot.equip(weapon, 'hand')
  }

  // Maakt iets, stuk voor stuk en met controle. Meerdere tegelijk, of te snel achter elkaar, raakt
  // uit de pas met de server; een mislukte poging geeft geen foutmelding, dus kijken of het er is.
  async craft (name, amount, table) {
    const bot = this.bot
    const item = bot.registry.itemsByName[name]
    if (!item) return false
    const count = () => bot.inventory.items().filter((it) => it.type === item.id).reduce((s, it) => s + it.count, 0)
    for (let i = 0; i < amount; i++) {
      const before = count()
      for (let tries = 0; tries < 4 && count() <= before; tries++) {
        const recipe = bot.recipesFor(item.id, null, 1, table)[0]
        if (!recipe) return false
        try { await withTimeout(bot.craft(recipe, 1, table), 10_000) } catch {}
        await sleep(500)
      }
      if (count() <= before) return false
    }
    return true
  }

  // Zaagt stammen tot planken tot hij er minstens `want` heeft (of geen stammen meer).
  async makePlanks (want) {
    for (let i = 0; i < 4 && this.countItems(/_planks$/) < want; i++) {
      const log = this.bot.inventory.items().find((it) => /_log$/.test(it.name))
      if (!log) return
      if (!await this.craft(log.name.replace('_log', '_planks'), 1, null)) return
    }
  }

  async placeNearby (itemName) {
    const bot = this.bot
    const item = bot.inventory.items().find((it) => it.name === itemName)
    if (!item) return null
    await bot.equip(item, 'hand')
    const base = bot.entity.position.floored()
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
      const ref = bot.blockAt(base.offset(dx, -1, dz))
      const above = ref && bot.blockAt(ref.position.offset(0, 1, 0))
      if (!ref || !above || ref.boundingBox !== 'block' || !REPLACEABLE.has(above.name)) continue
      if (isProtected(above.position)) continue
      try {
        await withTimeout(bot.placeBlock(ref, new Vec3(0, 1, 0)), 5_000)
        return bot.blockAt(above.position)
      } catch {}
    }
    return null
  }
}

// Het doelenpad (gereedschap, eten, ijzer) staat in progress.js.
require('./progress')(PlayerBot, { withTimeout, isProtected, debug, Timeout, REPLACEABLE })

// ---------- starten ----------

async function main () {
  console.log(`${opts.count} bots voor ${opts.host}:${opts.port} (Ctrl+C om te stoppen)`)
  for (let i = 0; i < opts.count; i++) {
    const personality = PERSONALITY_NAMES[i % PERSONALITY_NAMES.length]
    // Schema schuift t.o.v. de speelstijl, zodat niet elke miner ook een avondspeler is.
    const schedule = SCHEDULE_NAMES[(i * 2) % SCHEDULE_NAMES.length]
    ALL_BOTS.push(new PlayerBot(i, `${opts.prefix}_${i + 1}`, personality, schedule))
  }
  // Vrienden: de bots ernaast in de rij (een kring), plus soms nog eentje.
  for (const b of ALL_BOTS) {
    const n = ALL_BOTS.length
    if (n < 2) break
    const add = (o) => { if (o !== b && !b.friends.includes(o)) b.friends.push(o) }
    add(ALL_BOTS[(b.index + 1) % n])
    add(ALL_BOTS[(b.index - 1 + n) % n])
  }

  for (const b of ALL_BOTS) {
    const friends = b.friends.map((f) => f.name).join(', ') || '-'
    let when = 'speelt meteen'
    if (opts.schedule) {
      const until = b.schedule.activeUntil()
      when = until ? `speelt nu, tot ${formatTime(until)}` : `begint ${formatTime(b.schedule.nextStart())}`
    }
    let home = ''
    if (opts.homes) home = b.state.home ? `; huis bij ${b.state.home.x} ${b.state.home.y} ${b.state.home.z}` : '; nog geen huis'
    console.log(`  ${b.name.padEnd(16)} ${b.personality.padEnd(9)} ${(!opts.schedule ? '' : b.schedule.label).padEnd(14)} ${when}; vrienden: ${friends}${home}`)
  }

  let stopping = false
  const shutdown = () => {
    if (stopping) return
    stopping = true
    console.log('Bots uitloggen...')
    console.log(`\n${report.save(true)}\nOpgeslagen in ${report.file}`)
    for (const b of ALL_BOTS) if (b.bot) b.bot.quit()
    setTimeout(() => process.exit(0), 1500)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  process.on('SIGHUP', shutdown) // venster gesloten
  setInterval(() => { if (!stopping) report.save(false) }, REPORT_EVERY_MS)

  for (const b of ALL_BOTS) b.lifecycle()
}

main()
