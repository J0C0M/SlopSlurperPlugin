// Rapport per run: wat heeft elke bot gedaan, en is de data bruikbaar? Telt mee terwijl de bots
// spelen en schrijft het resultaat naar reports/<tijd>.txt (en bij het stoppen ook naar het scherm).
//
// De cijfers komen uit de client van de bot, niet uit de database van de plugin. Ze kunnen dus
// iets afwijken van het dashboard.

const fs = require('fs')
const path = require('path')

const REPORT_DIR = path.join(__dirname, 'reports')
const MAX_STEP = 20 // blokken per meting; meer is een teleport of respawn, geen lopen
const SAMPLE_MS = 1000
const KILL_CREDIT_MS = 5000 // net als in Minecraft: kort na je laatste klap telt de kill nog
const CAUSE_WINDOW_MS = 5000
const NOT_PLACED = new Set(['air', 'cave_air', 'water', 'lava']) // blokupdates die geen plaatsing zijn
const REPEAT_MIN = 3 // zo vaak geplaatst en weer gebroken op dezelfde plek = verdacht

const pad = (n) => String(n).padStart(2, '0')

function stamp (d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}

function formatDuration (ms) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m} m ${pad(s % 60)} s` : `${Math.floor(m / 60)} u ${pad(m % 60)} m`
}

// ---------- tellers van één bot ----------

class BotStats {
  constructor (name, personality, knownMilestones) {
    this.name = name
    this.personality = personality
    this.known = knownMilestones // al gehaald in een eerdere run
    this.milestones = [] // { goal, onlineMs }
    this.sessions = 0
    this.onlineMs = 0
    this.onlineSince = null
    this.distance = 0
    this.broken = 0
    this.placed = 0
    this.kills = new Map()
    this.deaths = [] // { t, cause }
    this.pendingCause = null // doodsbericht dat vóór de dood zelf binnenkwam
    this.stuck = 0
    this.rejoins = 0
    this.kicks = []
    this.errors = new Map()
    this.spots = new Map() // 'x y z' -> { block, cycles }
  }

  online (now = Date.now()) {
    return this.onlineMs + (this.onlineSince === null ? 0 : now - this.onlineSince)
  }

  milestone (goal) {
    this.milestones.push({ goal, onlineMs: this.online() })
  }

  error (message) {
    this.errors.set(message, (this.errors.get(message) || 0) + 1)
  }

  // De pathfinder probeert hetzelfde blok vaak meerdere keren tegelijk te plaatsen, en elke poging
  // meldt dan succes. Staat het er volgens ons al, dan telt het dus niet nog eens.
  blockPlaced (pos, block) {
    if (NOT_PLACED.has(block)) return
    const key = `${pos.x} ${pos.y} ${pos.z}`
    const spot = this.spots.get(key)
    if (spot && spot.block === block && spot.present) return
    this.placed++
    if (spot && spot.block === block) spot.present = true
    else this.spots.set(key, { block, cycles: 0, present: true })
  }

  blockBroken (pos, block) {
    this.broken++
    const spot = this.spots.get(`${pos.x} ${pos.y} ${pos.z}`)
    if (!spot || !spot.present) return
    spot.present = false
    if (spot.block === block) spot.cycles++
  }

  died () {
    const now = Date.now()
    const early = this.pendingCause
    this.pendingCause = null
    this.deaths.push({ t: now, cause: early && now - early.t < CAUSE_WINDOW_MS ? early.cause : null })
  }

  deathMessage (cause) {
    const last = this.deaths.at(-1)
    if (last && !last.cause && Date.now() - last.t < CAUSE_WINDOW_MS) last.cause = cause
    else this.pendingCause = { t: Date.now(), cause }
  }

  // Luistert mee met één verbinding (bij elke keer inloggen opnieuw).
  attach (bot) {
    let last = null
    let sampler = null
    const hits = new Map() // entity-id -> laatste klap

    bot.once('spawn', () => {
      this.sessions++
      this.onlineSince = Date.now()
      sampler = setInterval(() => {
        const p = bot.entity?.position
        if (!p) return
        if (last) {
          const step = p.distanceTo(last)
          if (step < MAX_STEP) this.distance += step
        }
        last = p.clone()
      }, SAMPLE_MS)

      // Ook de pathfinder graaft via bot.dig, dus zo tellen routes mee.
      const dig = bot.dig
      bot.dig = async (block, ...args) => {
        const result = await dig(block, ...args)
        this.blockBroken(block.position, block.name)
        return result
      }
      const attack = bot.attack
      bot.attack = (entity, ...args) => {
        hits.set(entity.id, Date.now())
        return attack(entity, ...args)
      }
    })
    bot.on('blockPlaced', (oldBlock, newBlock) => this.blockPlaced(newBlock.position, newBlock.name))
    bot.on('entityDead', (entity) => {
      const t = hits.get(entity.id)
      hits.delete(entity.id)
      if (!t || Date.now() - t > KILL_CREDIT_MS) return
      const name = entity.type === 'player' ? entity.username : entity.name
      this.kills.set(name, (this.kills.get(name) || 0) + 1)
    })
    bot.on('death', () => this.died())
    bot.on('message', (msg) => {
      if (!msg.translate?.startsWith('death.') || String(msg.with?.[0]) !== this.name) return
      this.deathMessage(msg.toString().replace(`${this.name} `, ''))
    })
    bot.on('respawn', () => { last = null })
    bot.on('end', () => {
      clearInterval(sampler)
      this.onlineMs = this.online()
      this.onlineSince = null
    })
  }
}

// ---------- rapport van de hele run ----------

class RunReport {
  constructor (settings) {
    this.settings = settings
    this.startedAt = new Date()
    this.bots = []
    this.file = path.join(REPORT_DIR, `${stamp(this.startedAt)}.txt`)
  }

  add (name, personality, knownMilestones) {
    const stats = new BotStats(name, personality, knownMilestones)
    this.bots.push(stats)
    return stats
  }

  text (final) {
    const now = Date.now()
    const list = (map) => [...map].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}x ${k}`).join(', ')
    const lines = [
      `Rapport van ${this.startedAt.toLocaleString('nl-NL')}, duur ${formatDuration(now - this.startedAt)}` +
        (final ? '' : ' (tussenstand: de run loopt nog, of is niet netjes gestopt)'),
      `${this.bots.length} bots${this.settings ? `, opties: ${this.settings}` : ''}`,
      ''
    ]

    const header = ['bot', 'stijl', 'online', 'sessies', 'gelopen', 'gebroken', 'geplaatst', 'kills', 'doden', 'vast', 'herlogin']
    const rows = this.bots.map((b) => [
      b.name, b.personality, formatDuration(b.online(now)), b.sessions, `${Math.round(b.distance)} m`, b.broken, b.placed,
      [...b.kills.values()].reduce((s, n) => s + n, 0), b.deaths.length, b.stuck, b.rejoins
    ].map(String))
    const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
    for (const r of [header, ...rows]) {
      lines.push(r.map((c, i) => i < 2 ? c.padEnd(widths[i]) : c.padStart(widths[i])).join('  '))
    }

    for (const b of this.bots) {
      lines.push('', b.name)
      lines.push(`  mijlpalen (tijd online): ${b.milestones.map((m) => `${m.goal} ${formatDuration(m.onlineMs)}`).join(', ') || 'geen nieuwe'}`)
      if (b.known.length) lines.push(`  al eerder gehaald: ${b.known.join(', ')}`)
      if (b.kills.size) lines.push(`  kills: ${list(b.kills)}`)
      for (const d of b.deaths) lines.push(`  dood om ${new Date(d.t).toLocaleTimeString('nl-NL')}: ${d.cause || 'oorzaak onbekend'}`)
      if (b.kicks.length) lines.push(`  gekickt: ${b.kicks.join('; ')}`)
      if (b.errors.size) lines.push(`  verbindingsfouten: ${list(b.errors)}`)
      const repeated = [...b.spots].filter(([, s]) => s.cycles >= REPEAT_MIN).sort((x, y) => y[1].cycles - x[1].cycles)
      for (const [pos, s] of repeated) lines.push(`  steeds geplaatst en gebroken: ${s.block} op ${pos} (${s.cycles}x)`)
    }
    return lines.join('\n') + '\n'
  }

  // Schrijft het rapport. Mag nooit de bots laten stoppen, dus fouten alleen melden.
  save (final) {
    const text = this.text(final)
    try {
      fs.mkdirSync(REPORT_DIR, { recursive: true })
      fs.writeFileSync(this.file, text)
    } catch (err) {
      console.error('Rapport opslaan mislukt:', err.message)
    }
    return text
  }
}

module.exports = { RunReport }
