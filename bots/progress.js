// Het doelenpad: van lege handen naar ijzeren gereedschap en armor, zoals een echte speler.
//
// Elke keer dat een bot hieraan werkt, pakt hij het eerste doel dat nog niet gehaald is. Dat wordt
// afgeleid uit zijn inventaris. Er hoeft dus niets bewaard te worden: na uitloggen gaat hij verder
// waar hij was, en wie doodgaat en zijn spullen kwijt is, begint vanzelf weer bij een eerdere stap.
//
// Dit bestand voegt methodes toe aan PlayerBot (zie onderaan).

const { goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')

const LOG = /^(oak|birch|spruce|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log$/
const PLANKS = /_planks$/
const COBBLE = /^cobblestone$/
const COAL = /^(coal|charcoal)$/
const RAW_MEAT = /^(beef|porkchop|mutton|chicken|rabbit)$/
const COOKED_MEAT = /^cooked_(beef|porkchop|mutton|chicken|rabbit)$/
const BAD_FOOD = /rotten_flesh|spider_eye|poisonous|pufferfish|suspicious|chorus|^chicken$/
const ANIMALS = new Set(['cow', 'pig', 'sheep', 'chicken', 'rabbit'])
const JUNK = /^(dirt|grass_block|gravel|sand|granite|diorite|andesite|tuff|cobbled_deepslate|calcite|rotten_flesh|spider_eye|.*_seeds|.*_sapling|leaf_litter|bone|string|feather)$/
const ARMOR = { helmet: 'head', chestplate: 'torso', leggings: 'legs', boots: 'feet' }
const TIERS = ['wooden', 'stone', 'copper', 'golden', 'iron', 'diamond', 'netherite']
const SIDES = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]
const AROUND = [...SIDES, new Vec3(0, 1, 0), new Vec3(0, -1, 0)]
// Valt naar beneden als het blok eronder verdwijnt: een bot die eronder staat, stikt.
const FALLING = /^(gravel|suspicious_gravel|sand|red_sand|suspicious_sand|.*_concrete_powder)$/
const STEP_MS = 6 * 60_000 // zo lang werkt een bot achter elkaar aan zijn doelen
const IRON_Y = 16 // hier ligt het meeste ijzer

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Wat er nodig is om iets te maken (planken en stokken telt ensure() zelf uit).
const RECIPES = {
  crafting_table: { planks: 4, table: false },
  wooden_pickaxe: { planks: 3, stick: 2 },
  wooden_sword: { planks: 2, stick: 1 },
  stone_pickaxe: { cobblestone: 3, stick: 2 },
  stone_sword: { cobblestone: 2, stick: 1 },
  stone_axe: { cobblestone: 3, stick: 2 },
  furnace: { cobblestone: 8 },
  stone_shovel: { cobblestone: 1, stick: 2 },
  torch: { coal: 1, stick: 1, table: false },
  iron_pickaxe: { iron_ingot: 3, stick: 2 },
  iron_sword: { iron_ingot: 2, stick: 1 },
  iron_helmet: { iron_ingot: 5 },
  iron_chestplate: { iron_ingot: 8 },
  iron_leggings: { iron_ingot: 7 },
  iron_boots: { iron_ingot: 4 },
  shield: { planks: 6, iron_ingot: 1 }
}

// Zelfde begin voor iedereen; daarna verschilt de volgorde per speelstijl.
const START = ['wooden_pickaxe', 'stone_pickaxe', 'stone_sword', 'stone_axe', 'stone_shovel', 'furnace', 'food', 'coal', 'torch']
const ARMOR_GOALS = ['iron_chestplate', 'iron_leggings', 'iron_helmet', 'iron_boots']
const GOALS = {
  miner: [...START, 'iron_pickaxe', 'iron_sword', ...ARMOR_GOALS, 'shield'],
  builder: [...START, 'building_stock', 'iron_pickaxe', 'iron_sword', ...ARMOR_GOALS],
  fighter: [...START, 'iron_sword', 'shield', ...ARMOR_GOALS, 'iron_pickaxe'],
  explorer: [...START, 'iron_pickaxe', 'iron_boots', 'iron_sword', 'shield', 'iron_helmet', 'iron_chestplate', 'iron_leggings'],
  lazy: [...START, 'iron_pickaxe', 'iron_sword']
}

module.exports = function install (PlayerBot, { withTimeout, isProtected, debug, Timeout, REPLACEABLE }) {
  // Telt als "verwacht" (net als een timeout): de activiteit stopt gewoon en de bot kiest opnieuw.
  class Interrupted extends Timeout {}

  Object.assign(PlayerBot.prototype, {
    // ---------- sturing ----------

    // Stopt het huidige werk als de bot uitlogt, doodgaat, wordt aangevallen of lang genoeg bezig is.
    guard () {
      if (!this.online) throw new Interrupted('offline')
      if (this.freeing) throw new Interrupted('hoofd in een blok')
      if (this.defending) throw new Interrupted('wordt aangevallen')
      if (this.deaths !== this.deathsAtStart) throw new Interrupted('doodgegaan')
      if (Date.now() > this.stepDeadline) throw new Interrupted('tijd om')
    },

    startWork (ms = STEP_MS) {
      this.deathsAtStart = this.deaths
      this.stepDeadline = Date.now() + ms
    },

    isNight () {
      const t = this.bot.time.timeOfDay
      return t > 12800 && t < 23200
    },

    armorPieces () {
      const eq = this.bot.entity.equipment || []
      return eq.filter((it) => it && /^iron_(helmet|chestplate|leggings|boots)$/.test(it.name)).length
    },

    // Alles wat hij bij zich heeft, ook wat hij draagt of in zijn andere hand houdt.
    owned () {
      const bot = this.bot
      return bot.inventory.slots.filter((it, slot) => it && slot >= 5)
    },

    owns (name) {
      return this.owned().some((it) => it.name === name)
    },

    // Heeft hij dit gereedschap, of een betere versie?
    ownsTier (name) {
      const m = name.match(/^([a-z]+)_(pickaxe|axe|shovel|sword|helmet|chestplate|leggings|boots)$/)
      if (!m) return this.owns(name)
      const min = TIERS.indexOf(m[1])
      return this.owned().some((it) => {
        const o = it.name.match(/^([a-z]+)_([a-z]+)$/)
        return o && o[2] === m[2] && TIERS.indexOf(o[1]) >= min && o[1] !== 'golden'
      })
    },

    foodCount () {
      return this.countItems(COOKED_MEAT) + this.countItems(/^(bread|apple|baked_potato|cooked_cod|cooked_salmon)$/)
    },

    goalDone (goal) {
      switch (goal) {
        case 'food': return this.foodCount() >= 4
        case 'coal': return this.countItems(COAL) >= 4 || this.countItems(/^torch$/) >= 4
        case 'torch': return this.countItems(/^torch$/) >= 4
        case 'building_stock': return this.countItems(COBBLE) >= 64
        default: return this.ownsTier(goal)
      }
    },

    currentGoal () {
      return GOALS[this.personality].find((g) => !this.goalDone(g)) || null
    },

    // De activiteit zelf.
    async progress () {
      this.startWork()
      await this.wearBest()
      await this.dropJunk()
      let last = null
      for (;;) {
        this.guard()
        let goal = this.currentGoal()
        if (!goal) {
          // Alles gehaald: nog wat voorraad mijnen.
          await this.mineOre(/^(deepslate_)?(iron|coal)_ore$/, /^(raw_iron|coal)$/, this.countItems(/^(raw_iron|coal)$/) + 12)
          return
        }
        // 's Nachts niet onbeschermd over het gras: dan ondergronds werken of schuilen.
        const surfaceWork = ['wooden_pickaxe', 'food'].includes(goal)
        if (surfaceWork && this.isNight() && this.armorPieces() < 2) {
          if (!this.ownsTier('wooden_pickaxe')) {
            await this.shelter()
            continue
          }
          goal = 'coal_night'
        }
        if (goal !== last) {
          this.log(`doel: ${goal}`)
          last = goal
        }
        await this.workOn(goal)
        this.noteMilestones()
      }
    },

    async workOn (goal) {
      switch (goal) {
        case 'food': return this.getFood()
        case 'coal': return this.getCoal(8)
        case 'coal_night': return this.getCoal(this.countItems(COAL) + 8)
        case 'torch': return this.ensure('torch', 8)
        case 'building_stock': return this.ensure('cobblestone', 64)
        default:
          await this.ensure(goal, 1)
          await this.wearBest()
      }
    },

    // Voor de log: wanneer een bot iets voor het eerst haalde (bewaard in state/<naam>.json).
    noteMilestones () {
      this.state.milestones = this.state.milestones || {}
      for (const goal of GOALS[this.personality]) {
        if (this.state.milestones[goal] || !this.goalDone(goal)) continue
        this.state.milestones[goal] = new Date().toISOString()
        this.log(`mijlpaal: ${goal}`)
        this.saveState()
      }
    },

    // ---------- spullen regelen ----------

    // Zorgt dat de bot minstens n van iets heeft: verzamelen, smelten of maken, inclusief alles
    // wat daarvoor nodig is.
    async ensure (name, n) {
      const count = () => this.owned().filter((it) => it.name === name).reduce((s, it) => s + it.count, 0)
      for (let tries = 0; count() < n; tries++) {
        this.guard()
        if (tries > 6) throw new Interrupted(`${name} lukt niet`)
        if (name === 'stick') {
          await this.ensurePlanks(2)
          await this.craft('stick', 1, null)
        } else if (name === 'cobblestone') {
          if (!this.ownsTier('wooden_pickaxe')) await this.ensure('wooden_pickaxe', 1)
          await this.getCobble(n)
        } else if (name === 'coal') {
          await this.getCoal(n)
        } else if (name === 'iron_ingot') {
          await this.getIron(n)
        } else {
          await this.make(name)
        }
      }
    },

    async make (name) {
      const recipe = RECIPES[name]
      if (!recipe) throw new Interrupted(`geen recept voor ${name}`)
      for (const part of ['iron_ingot', 'cobblestone']) {
        if (recipe[part]) await this.ensure(part, recipe[part])
      }
      if (recipe.coal && this.countItems(COAL) < recipe.coal) await this.getCoal(recipe.coal)
      if (recipe.stick) await this.ensure('stick', recipe.stick)
      // Planken als laatste (stokken gebruiken er ook), met genoeg over voor een werkbank.
      const needTable = recipe.table !== false
      const tableNear = needTable && (this.owns('crafting_table') || this.nearBlock('crafting_table', 16))
      const planks = (recipe.planks || 0) + (needTable && !tableNear ? 4 : 0)
      if (planks) await this.ensurePlanks(planks)
      if (!needTable) {
        await this.craft(name, 1, null)
        return
      }
      const table = await this.station('crafting_table')
      const ok = await this.craft(name, 1, table)
      if (ok) this.log(`maakt ${name}`)
      await this.takeStation(table)
    },

    // Genoeg planken van één houtsoort (een recept mag bij Mineflayer niet mengen).
    async ensurePlanks (n) {
      for (let tries = 0; tries < 8; tries++) {
        this.guard()
        const kinds = {}
        for (const it of this.bot.inventory.items()) {
          if (LOG.test(it.name)) {
            const k = it.name.replace('_log', '')
            kinds[k] = (kinds[k] || 0) + it.count * 4
          } else if (PLANKS.test(it.name)) {
            const k = it.name.replace('_planks', '')
            kinds[k] = (kinds[k] || 0) + it.count
          }
        }
        const best = Object.entries(kinds).sort((a, b) => b[1] - a[1])[0]
        if (best && best[1] >= n) {
          const planks = new RegExp(`^${best[0]}_planks$`)
          for (let i = 0; i < 12 && this.countItems(planks) < n; i++) await this.craft(`${best[0]}_planks`, 1, null)
          if (this.countItems(planks) >= n) return
        }
        await this.surface()
        if (!await this.gather(LOG, LOG, this.countItems(LOG) + 4, { maxDistance: 64 })) await this.explore(70)
      }
      throw new Interrupted('geen hout gevonden')
    },

    async getCobble (n) {
      if (await this.gather(/^(stone|cobblestone)$/, COBBLE, n, { maxDistance: 24, exposed: true })) return
      // Geen steen aan de oppervlakte: naar beneden graven tot hij erbij kan.
      await this.descend(this.bot.entity.position.y - 8, () => this.exposedNear(/^stone$/, 5))
      await this.gather(/^(stone|cobblestone)$/, COBBLE, n, { maxDistance: 8, exposed: true })
    },

    async getCoal (n) {
      if (this.countItems(COAL) >= n) return
      if (!this.ownsTier('wooden_pickaxe')) await this.ensure('wooden_pickaxe', 1)
      await this.mineOre(/^(deepslate_)?coal_ore$/, COAL, n, 45)
    },

    async getIron (n) {
      const have = () => this.countItems(/^iron_ingot$/)
      if (have() >= n) return
      const need = n - have()
      if (this.countItems(/^raw_iron$/) < need) {
        if (!this.ownsTier('stone_pickaxe')) await this.ensure('stone_pickaxe', 1)
        if (this.countItems(/^torch$/) < 4 && this.countItems(COAL) > 2) await this.ensure('torch', 4)
        await this.mineOre(/^(deepslate_)?iron_ore$/, /^raw_iron$/, need)
      }
      if (this.countItems(/^raw_iron$/) > 0) await this.smelt('raw_iron', this.countItems(/^raw_iron$/))
    },

    async getFood () {
      const raw = this.countItems(RAW_MEAT)
      if (raw + this.foodCount() < 5) {
        await this.surface()
        const animal = this.bot.nearestEntity((e) => ANIMALS.has(e.name) && !this.skipBlocks.has(`mob${e.id}`) &&
          e.position.distanceTo(this.bot.entity.position) < 64 && Math.abs(e.position.y - this.bot.entity.position.y) < 20)
        if (!animal) {
          await this.explore(80)
          return
        }
        const before = this.countItems(RAW_MEAT)
        await this.fight(animal)
        await this.collectAll(this.bot.entity.position, 8)
        if (this.countItems(RAW_MEAT) === before) this.skipBlocks.set(`mob${animal.id}`, Date.now() + 60_000)
        return
      }
      const meat = this.bot.inventory.items().find((it) => RAW_MEAT.test(it.name))
      if (meat) await this.smelt(meat.name, meat.count)
    },

    // Smelten in een oven. Die zet hij neer en neemt hij daarna weer mee.
    async smelt (input, n) {
      const bot = this.bot
      const id = (name) => bot.registry.itemsByName[name].id
      n = Math.min(n, 8)
      const fuelItem = () => bot.inventory.items().find((it) => COAL.test(it.name)) ||
        bot.inventory.items().find((it) => PLANKS.test(it.name) || LOG.test(it.name))
      if (!fuelItem()) await this.ensurePlanks(8)
      const furnaceBlock = await this.station('furnace')
      const furnace = await withTimeout(bot.openFurnace(furnaceBlock), 8000)
      let done = 0
      try {
        if (furnace.outputItem()) await furnace.takeOutput()
        const fuel = fuelItem()
        if (fuel && !furnace.fuelItem()) {
          const each = COAL.test(fuel.name) ? 8 : 1.5
          await furnace.putFuel(fuel.type, null, Math.min(fuel.count, Math.ceil(n / each)))
        }
        if (!furnace.inputItem()) await furnace.putInput(id(input), null, Math.min(n, this.countItems(new RegExp(`^${input}$`)) || n))
        const end = Date.now() + n * 10_500 + 5000
        while (Date.now() < end && furnace.inputItem()) {
          this.guard()
          await sleep(1000)
        }
        await sleep(500)
        done = furnace.outputItem()?.count || 0
      } finally {
        try {
          if (furnace.outputItem()) await furnace.takeOutput()
          if (furnace.inputItem()) await furnace.takeInput()
          if (furnace.fuelItem()) await furnace.takeFuel()
        } catch {}
        furnace.close()
        await sleep(400)
      }
      if (done) this.log(`smelt ${done}x ${input}`)
      await this.takeStation(furnaceBlock)
    },

    // ---------- werkbank en oven ----------

    nearBlock (name, maxDistance) {
      const type = this.bot.registry.blocksByName[name].id
      return this.bot.findBlock({ matching: type, maxDistance })
    },

    // Een werkbank of oven binnen bereik: een bestaande in de buurt, of de eigen neerzetten.
    async station (name) {
      const existing = this.nearBlock(name, 16)
      if (existing) {
        try {
          await this.goto(new goals.GoalNear(existing.position.x, existing.position.y, existing.position.z, 2), 20_000)
          return existing
        } catch {
          this.guard()
        }
      }
      if (!this.owns(name)) await this.make(name)
      let block = null
      for (let i = 0; i < 3 && block?.name !== name; i++) {
        this.guard()
        // Lukt het hier niet (in water, tussen planten, op een helling): een stukje verderop.
        if (i > 0) await this.explore(10).catch(() => this.guard())
        block = await this.placeStation(name)
        if (block?.name !== name) block = await this.placeInWall(name)
      }
      if (block?.name !== name) throw new Interrupted(`kan ${name} niet neerzetten`)
      return block
    },

    // Op een vrije plek om de bot heen. Bloemen, gras en bladeren haalt hij eerst weg.
    async placeStation (name) {
      const bot = this.bot
      const feet = bot.entity.position.floored()
      for (const dy of [0, -1, 1]) {
        for (let dx = -2; dx <= 2; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            const spot = feet.offset(dx, dy, dz)
            const at = bot.blockAt(spot)
            const below = bot.blockAt(spot.offset(0, -1, 0))
            if (!at || at.boundingBox !== 'empty' || /water|lava|torch/.test(at.name)) continue
            if (!below || below.boundingBox !== 'block' || /chest|crafting_table|furnace|leaves/.test(below.name)) continue
            if (isProtected(spot) || this.overlapsMe(spot)) continue
            this.guard()
            try {
              if (!/air$/.test(at.name)) await withTimeout(bot.dig(at), 4000, () => bot.stopDigging())
              const item = bot.inventory.items().find((it) => it.name === name)
              if (!item) return null
              await bot.equip(item, 'hand')
              await withTimeout(bot.placeBlock(below, new Vec3(0, 1, 0)), 3000)
              return bot.blockAt(spot)
            } catch (err) {
              debug(this.name, `${name} neerzetten op ${spot} (${at.name} op ${below.name}):`, err.message)
              // Soms staat hij er toch, maar kwam de melding te laat.
              await sleep(300)
              if (bot.blockAt(spot)?.name === name) return bot.blockAt(spot)
            }
          }
        }
      }
      return null
    },

    // In een smalle gang is er geen plek naast de bot: een blok uit de muur hakken en hem daar zetten.
    async placeInWall (name) {
      const bot = this.bot
      const feet = bot.entity.position.floored()
      for (const d of SIDES) {
        const spot = feet.plus(d)
        const block = bot.blockAt(spot)
        const below = bot.blockAt(spot.offset(0, -1, 0))
        if (!block || block.boundingBox !== 'block' || below?.boundingBox !== 'block') continue
        if (isProtected(spot) || this.liquidAt(spot)) continue
        if (!await this.digBlock(block)) continue
        const item = bot.inventory.items().find((it) => it.name === name)
        if (item && await this.placeAt(spot, item)) return bot.blockAt(spot)
      }
      return null
    },

    async takeStation (block) {
      const bot = this.bot
      const current = block && bot.blockAt(block.position)
      if (!current || current.name !== block.name || isProtected(block.position)) return
      if (current.name === 'furnace' && !this.ownsTier('wooden_pickaxe')) return
      try {
        if (await this.digBlock(current)) await this.collectAll(block.position, 4)
      } catch (err) {
        this.guard()
      }
    },

    // ---------- verzamelen ----------

    toolFor (block) {
      const kind = /_log$|_planks$|crafting_table|chest/.test(block.name)
        ? 'axe'
        : /^(dirt|grass_block|sand|red_sand|gravel|clay)$/.test(block.name) ? 'shovel' : 'pickaxe'
      return this.bot.inventory.items()
        .filter((it) => it.name.endsWith(`_${kind}`))
        .sort((a, b) => TIERS.indexOf(b.name.split('_')[0]) - TIERS.indexOf(a.name.split('_')[0]))[0]
    },

    async digBlock (block) {
      const bot = this.bot
      if (!block || isProtected(block.position) || !bot.canDigBlock(block)) return false
      const tool = this.toolFor(block)
      if (tool && bot.heldItem?.type !== tool.type) await bot.equip(tool, 'hand')
      await withTimeout(bot.dig(block), 20_000, () => bot.stopDigging())
      return true
    },

    isExposed (pos) {
      return AROUND.some((d) => {
        const b = this.bot.blockAt(pos.plus(d))
        return b && b.boundingBox !== 'block' && !/water|lava/.test(b.name)
      })
    },

    liquidAt (pos) {
      return AROUND.some((d) => /water|lava/.test(this.bot.blockAt(pos.plus(d))?.name || ''))
    },

    blockIds (re) {
      return this.bot.registry.blocksArray.filter((b) => re.test(b.name)).map((b) => b.id)
    },

    candidates (re, maxDistance, exposed) {
      const now = Date.now()
      return this.bot.findBlocks({ matching: this.blockIds(re), maxDistance, count: 200 })
        .filter((p) => !isProtected(p) && !(this.skipBlocks.get(p.toString()) > now) &&
          !this.fallsOn(p) && (!exposed || this.isExposed(p)))
    },

    exposedNear (re, maxDistance) {
      return this.candidates(re, maxDistance, true).length > 0
    },

    // Verzamelt blokken tot hij `want` stuks van `itemRe` heeft. Met `exposed` alleen blokken die
    // aan lucht grenzen: een speler ziet ook geen erts dwars door steen heen.
    async gather (blockRe, itemRe, want, { maxDistance = 32, exposed = false } = {}) {
      const bot = this.bot
      let failed = 0
      while (this.countItems(itemRe) < want) {
        this.guard()
        if (failed > 6) return false
        const pos = this.candidates(blockRe, maxDistance, exposed)[0]
        if (!pos) return false
        const skip = () => {
          this.skipBlocks.set(pos.toString(), Date.now() + 5 * 60_000)
          failed++
        }
        const before = this.countItems(itemRe)
        try {
          await this.goto(new goals.GoalLookAtBlock(pos, bot.world), 25_000)
          this.guard()
          const block = bot.blockAt(pos)
          if (!block || !blockRe.test(block.name)) continue
          if (!await this.digBlock(block)) {
            skip()
            continue
          }
          await this.collectAll(pos, 6)
        } catch (err) {
          this.guard()
          skip()
          continue
        }
        if (this.countItems(itemRe) > before) failed = 0
        else skip()
      }
      return true
    },

    // Raapt alles op wat in de buurt ligt.
    async collectAll (around, radius) {
      const bot = this.bot
      await sleep(400)
      for (let i = 0; i < 5; i++) {
        const drop = bot.nearestEntity((e) => e.name === 'item' && e.position.distanceTo(around) < radius)
        if (!drop) return
        try {
          await this.goto(new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 0), 8000)
        } catch {
          this.guard()
          return
        }
        await sleep(300)
      }
    },

    // ---------- ondergronds ----------

    underground () {
      const bot = this.bot
      const p = bot.entity.position.floored()
      for (let y = 2; y <= 50; y++) {
        const b = bot.blockAt(p.offset(0, y, 0))
        if (b && b.boundingBox === 'block' && !/leaves|log|glass/.test(b.name)) return true
      }
      return false
    },

    // Terug naar boven, naar de plek waar hij naar beneden ging.
    async surface () {
      if (!this.underground()) return
      const e = this.state.entrance
      if (e && await this.walkTo(new Vec3(e.x, e.y, e.z), 2, 90_000)) {
        this.guard()
        if (!this.underground()) return
      }
      this.guard()
      try {
        await this.goto(new goals.GoalY(Math.max(70, Math.floor(this.bot.entity.position.y) + 10)), 60_000)
      } catch {
        this.guard()
      }
    },

    // Mijnt erts: eerst wat er zichtbaar is, anders dieper graven of een gang maken.
    async mineOre (oreRe, itemRe, want, targetY = IRON_Y) {
      while (this.countItems(itemRe) < want) {
        this.guard()
        await this.dropJunk()
        await this.eatIfHungry()
        const tool = this.bot.inventory.items().some((it) => /_pickaxe$/.test(it.name))
        if (!tool) await this.ensure('stone_pickaxe', 1)
        if (await this.gather(oreRe, itemRe, want, { maxDistance: 20, exposed: true })) return
        const stop = () => this.exposedNear(oreRe, 8)
        if (this.bot.entity.position.y > targetY + 2) await this.descend(targetY, stop)
        else await this.tunnel(14, stop)
      }
    },

    // Een trap naar beneden, tot targetY of tot stop() waar is.
    async descend (targetY, stop) {
      if (!this.underground()) {
        const p = this.bot.entity.position.floored()
        this.state.entrance = { x: p.x, y: p.y, z: p.z }
        this.saveState()
      }
      let dir = this.safeDir(true)
      let steps = 0
      for (let blocked = 0; this.bot.entity.position.y > targetY && blocked < 4;) {
        this.guard()
        if (this.stepLoose(dir, true)) dir = this.safeDir(true)
        if (await this.digStep(dir, true)) {
          blocked = 0
          if (++steps % 8 === 0) await this.placeTorch()
          if (stop && stop()) return
        } else {
          blocked++
          dir = this.safeDir(true, dir)
        }
      }
      // Steeds water of lava in de weg: ergens anders opnieuw beginnen.
      if (this.bot.entity.position.y > targetY) await this.tunnel(8, stop)
    },

    // Een rechte gang van twee hoog.
    async tunnel (length, stop) {
      let dir = this.safeDir(false)
      for (let i = 0, blocked = 0; i < length && blocked < 4; i++) {
        this.guard()
        if (this.stepLoose(dir, false)) dir = this.safeDir(false)
        if (await this.digStep(dir, false)) {
          if (i % 8 === 7) await this.placeTorch()
          if (stop && stop()) return
        } else {
          blocked++
          dir = this.safeDir(false, dir)
        }
      }
      // Helemaal ingesloten: een eind verderop verder.
      if (this.stepBlocked) {
        this.stepBlocked = false
        await this.explore(25)
      }
    },

    // Een richting die niet meteen vastloopt; liefst rechtdoor, anders een andere dan `not`.
    safeDir (down, not = null) {
      const keep = this.digDir
      const options = SIDES.filter((d) => d !== not)
      const safe = options.filter((d) => this.stepSafe(d, down))
      // Liever niet onder grind of zand door.
      const firm = safe.filter((d) => !this.stepLoose(d, down))
      const ok = firm.length ? firm : safe
      if (!not && keep && ok.includes(keep)) return keep
      const list = ok.length ? ok : options
      this.stepBlocked = ok.length === 0
      this.digDir = list[Math.floor(Math.random() * list.length)]
      return this.digDir
    },

    stepCells (dir, down) {
      const front = this.bot.entity.position.floored().plus(dir)
      const cells = [front.offset(0, 1, 0), front]
      if (down) cells.push(front.offset(0, -1, 0))
      return cells
    },

    // Geen water of lava ernaast, geen huis, en een vloer om op te staan.
    stepSafe (dir, down) {
      const bot = this.bot
      const cells = this.stepCells(dir, down)
      const floor = bot.blockAt(cells[cells.length - 1].offset(0, -1, 0))
      if (!floor || floor.boundingBox !== 'block') return false
      return cells.every((c) => {
        const b = bot.blockAt(c)
        return b && !isProtected(c) && !/water|lava|bedrock/.test(b.name) && !this.liquidAt(c)
      })
    },

    // Ligt er grind of zand op dit blok, of is het dat zelf?
    fallsOn (pos) {
      return [pos, pos.offset(0, 1, 0)].some((p) => FALLING.test(this.bot.blockAt(p)?.name || ''))
    },

    stepLoose (dir, down) {
      return this.stepCells(dir, down).some((c) => this.fallsOn(c))
    },

    // Hakt de cellen voor de bot leeg en wacht tot er niets meer navalt. De bot blijft staan: wat
    // valt, komt vóór hem terecht en niet op zijn hoofd.
    async clearCells (cells) {
      const bot = this.bot
      const top = cells[0]
      for (let i = 0; i < 24; i++) {
        this.guard()
        const block = cells.map((c) => bot.blockAt(c)).find((b) => b && b.boundingBox === 'block')
        if (block) {
          if (!await this.digBlock(block)) return false
          await sleep(FALLING.test(block.name) ? 400 : 100)
          continue
        }
        const falling = bot.nearestEntity((e) => e.name === 'falling_block' && Math.abs(e.position.x - top.x - 0.5) < 1 &&
          Math.abs(e.position.z - top.z - 0.5) < 1)
        if (!falling && !FALLING.test(bot.blockAt(top.offset(0, 1, 0))?.name || '')) return true
        await sleep(300)
      }
      return false
    },

    async digStep (dir, down) {
      const bot = this.bot
      if (!this.stepSafe(dir, down)) return false
      const cells = this.stepCells(dir, down)
      if (!await this.clearCells(cells)) return false
      const to = cells[cells.length - 1]
      // Tijdens het graven kan er lava of water zichtbaar zijn geworden.
      if (!this.stepSafe(dir, down)) return false
      try {
        await this.goto(new goals.GoalBlock(to.x, to.y, to.z), 8000)
      } catch {
        this.guard()
        return false
      }
      return true
    },

    // Vangnet: zit zijn hoofd in een blok, dan laat hij alles vallen en hakt zich vrij.
    headBlock () {
      const p = this.bot.entity?.position
      if (!p) return null
      for (const [dx, dz] of [[0, 0], [0.23, 0], [-0.23, 0], [0, 0.23], [0, -0.23]]) {
        const b = this.bot.blockAt(p.offset(dx, 1.62, dz))
        if (b && b.boundingBox === 'block' && b.diggable && !/leaves|glass|slab|stairs|chest/.test(b.name)) return b
      }
      return null
    },

    async freeHead () {
      const bot = this.bot
      if (this.freeing || !this.online || bot.health <= 0 || !this.headBlock()) return
      this.freeing = true // houdt al het andere werk tegen (zie guard)
      try {
        bot.pathfinder.setGoal(null)
        bot.clearControlStates()
        bot.stopDigging()
        for (let i = 0; i < 20 && this.online && bot.health > 0; i++) {
          const block = this.headBlock()
          if (!block) break
          debug(this.name, `zit met zijn hoofd in een blok (${block.name}), hakt zich los`)
          const tool = this.toolFor(block)
          try {
            if (tool && bot.heldItem?.type !== tool.type) await bot.equip(tool, 'hand')
            await withTimeout(bot.dig(block, true), 6000, () => bot.stopDigging())
          } catch {}
          await sleep(150)
        }
      } catch {} finally {
        this.freeing = false
      }
    },

    async placeTorch () {
      const bot = this.bot
      const torch = bot.inventory.items().find((it) => it.name === 'torch')
      if (!torch) return
      const feet = bot.entity.position.floored()
      const floor = bot.blockAt(feet.offset(0, -1, 0))
      if (!floor || floor.boundingBox !== 'block' || bot.blockAt(feet)?.name !== 'air') return
      try {
        await bot.equip(torch, 'hand')
        await withTimeout(bot.placeBlock(floor, new Vec3(0, 1, 0)), 3000)
      } catch {}
    },

    // Zonder pickaxe de nacht door: een gat van drie diep graven, dichtmaken en wachten.
    async shelter () {
      const bot = this.bot
      debug(this.name, 'schuilt voor de nacht')
      const start = bot.entity.position.floored()
      for (let i = 1; i <= 3; i++) {
        this.guard()
        const b = bot.blockAt(start.offset(0, -i, 0))
        const below = bot.blockAt(start.offset(0, -i - 1, 0))
        if (!b || !below || below.boundingBox !== 'block' || this.liquidAt(b.position)) break
        if (!await this.digBlock(b)) break
        await sleep(700)
      }
      const lid = bot.entity.position.floored().offset(0, 2, 0)
      const item = bot.inventory.items().find((it) => /^(dirt|cobblestone)$/.test(it.name) || PLANKS.test(it.name))
      if (item && REPLACEABLE.has(bot.blockAt(lid)?.name)) await this.placeAt(lid, item)
      while (this.isNight()) {
        this.guard()
        if (Math.random() < 0.1) await bot.look(Math.random() * 6.28, 0, false)
        await sleep(3000)
      }
      await this.surface()
    },

    // ---------- overleven ----------

    async wearBest () {
      const bot = this.bot
      for (const [piece, dest] of Object.entries(ARMOR)) {
        const best = bot.inventory.items()
          .filter((it) => it.name.endsWith(`_${piece}`))
          .sort((a, b) => TIERS.indexOf(b.name.split('_')[0]) - TIERS.indexOf(a.name.split('_')[0]))[0]
        const worn = bot.inventory.slots[bot.getEquipmentDestSlot(dest)]
        if (best && (!worn || TIERS.indexOf(best.name.split('_')[0]) > TIERS.indexOf(worn.name.split('_')[0]))) {
          try { await bot.equip(best, dest) } catch {}
        }
      }
      const shield = bot.inventory.items().find((it) => it.name === 'shield')
      if (shield && !bot.inventory.slots[bot.getEquipmentDestSlot('off-hand')]) {
        try { await bot.equip(shield, 'off-hand') } catch {}
      }
    },

    async eatIfHungry () {
      const bot = this.bot
      const hurt = bot.health < 14 && bot.food < 20
      if (bot.food >= 15 && !hurt) return
      const foods = bot.registry.foodsByName
      const food = bot.inventory.items()
        .filter((it) => foods[it.name] && (!BAD_FOOD.test(it.name) || bot.food < 6))
        .sort((a, b) => foods[b.name].foodPoints - foods[a.name].foodPoints)[0]
      if (!food) return
      try {
        await bot.equip(food, 'hand')
        await withTimeout(bot.consume(), 5000)
        debug(this.name, `eet ${food.name}`)
      } catch {}
    },

    // Rommel weggooien als de inventaris bijna vol is.
    async dropJunk () {
      const bot = this.bot
      if (bot.inventory.emptySlotCount() > 6) return
      const seen = {}
      for (const it of bot.inventory.items()) {
        seen[it.name] = (seen[it.name] || 0) + 1
        const tooMuch = (JUNK.test(it.name) && seen[it.name] > (it.name === 'dirt' ? 1 : 0)) || (it.name === 'cobblestone' && seen[it.name] > 3)
        if (!tooMuch) continue
        try { await bot.tossStack(it) } catch {}
        await sleep(200)
      }
    },

    // Na een dood terug naar de plek om de spullen op te rapen. Eén poging per dood.
    async recover () {
      const spot = this.deathSpot
      this.deathSpot = null
      this.startWork(3 * 60_000)
      if (!spot || Date.now() - spot.t > 4 * 60_000) return
      if (spot.pos.distanceTo(this.bot.entity.position) > 200) return
      this.log('gaat zijn spullen ophalen')
      const before = this.owned().length
      if (await this.walkTo(spot.pos, 3, 150_000)) {
        this.guard()
        for (let i = 0; i < 4; i++) await this.collectAll(spot.pos, 10)
      }
      const got = this.owned().length - before
      this.log(got > 0 ? `heeft ${got} stapels terug` : 'spullen niet teruggevonden')
      await this.wearBest()
    }
  })
}
