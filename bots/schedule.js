// Speelschema's: wanneer een bot online komt. Zo lijkt de activiteit per uur en per dag
// op die van echte spelers (avondspelers, scholieren, weekendspelers, ...).
//
// Tijden zijn in uren lokale tijd. Een venster mag over middernacht lopen (bijv. [21, 26] = 21:00 tot 02:00).
// Per dag en per venster schuiven begin en eind een beetje (jitter), en niet elke dag wordt er gespeeld
// (chance). Dat is per bot en per dag vast (seeded), zodat een herstart van de bots niets verandert.

const SCHEDULES = {
  avond: {
    label: 'avondspeler',
    weekday: { chance: 0.85, windows: [[19, 23]] },
    weekend: { chance: 0.9, windows: [[14, 24]] },
    session: [30, 90], // minuten per sessie
    pause: [5, 20] // minuten tussen sessies binnen een venster
  },
  scholier: {
    label: 'scholier',
    weekday: { chance: 0.9, windows: [[15.5, 18], [20, 22]] },
    weekend: { chance: 0.9, windows: [[11, 18]] },
    session: [20, 60],
    pause: [10, 40]
  },
  nachtbraker: {
    label: 'nachtbraker',
    weekday: { chance: 0.8, windows: [[21, 26]] },
    weekend: { chance: 0.9, windows: [[20, 27]] },
    session: [45, 120],
    pause: [5, 15]
  },
  casual: {
    label: 'casual speler',
    weekday: { chance: 0.6, windows: [[12, 22]] },
    weekend: { chance: 0.7, windows: [[10, 22]] },
    session: [10, 25],
    pause: [30, 120]
  },
  weekend: {
    label: 'weekendspeler',
    weekday: { chance: 0.25, windows: [[20, 21.5]] },
    weekend: { chance: 0.95, windows: [[10, 23]] },
    session: [60, 180],
    pause: [10, 30]
  }
}
const SCHEDULE_NAMES = Object.keys(SCHEDULES)
const HOUR = 3_600_000

// Vaste "willekeur" per tekst (FNV-1a + mulberry32), tussen 0 en 1.
function seeded (text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  h += 0x6D2B79F5
  let t = h
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function startOfDay (date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function dayKey (day) {
  return `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`
}

class Schedule {
  constructor (botName, scheduleName) {
    this.botName = botName
    this.name = scheduleName
    this.profile = SCHEDULES[scheduleName]
    this.label = this.profile.label
  }

  // De speelvensters van één dag, als [start, eind] in ms.
  windowsFor (day) {
    const weekend = day.getDay() === 0 || day.getDay() === 6
    const plan = weekend ? this.profile.weekend : this.profile.weekday
    const key = `${this.botName}|${dayKey(day)}`
    if (seeded(`${key}|plays`) >= plan.chance) return []
    return plan.windows.map(([from, to], i) => {
      const jitterStart = (seeded(`${key}|${i}|start`) - 0.5) // -0,5 tot +0,5 uur
      const jitterEnd = (seeded(`${key}|${i}|end`) - 0.5)
      const start = day.getTime() + (from + jitterStart) * HOUR
      const end = day.getTime() + (to + jitterEnd) * HOUR
      return [start, Math.max(end, start + 0.5 * HOUR)]
    })
  }

  // Tot wanneer de bot nu mag spelen (ms), of null als hij nu offline hoort te zijn.
  activeUntil (now = new Date()) {
    const t = now.getTime()
    const today = startOfDay(now)
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    for (const day of [yesterday, today]) {
      for (const [start, end] of this.windowsFor(day)) {
        if (start <= t && t < end) return end
      }
    }
    return null
  }

  // Het eerstvolgende moment (ms) waarop de bot weer gaat spelen.
  nextStart (now = new Date()) {
    const t = now.getTime()
    let best = null
    const day = startOfDay(now)
    day.setDate(day.getDate() - 1)
    for (let i = 0; i < 10; i++) {
      for (const [start] of this.windowsFor(day)) {
        if (start > t && (best === null || start < best)) best = start
      }
      // Vensters van een latere dag beginnen altijd later (alle vensters starten na 09:30).
      if (best !== null) break
      day.setDate(day.getDate() + 1)
    }
    return best ?? t + 24 * HOUR
  }

  sessionMinutes () {
    const [a, b] = this.profile.session
    return a + Math.random() * (b - a)
  }

  pauseMinutes () {
    const [a, b] = this.profile.pause
    return a + Math.random() * (b - a)
  }
}

function formatTime (ms) {
  const d = new Date(ms)
  const days = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za']
  return `${days[d.getDay()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

module.exports = { Schedule, SCHEDULE_NAMES, formatTime }
