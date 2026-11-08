import express from "express"
import cors from "cors"
import rateLimit from "express-rate-limit"
import "dotenv/config"
import { ChatOpenAI } from "@langchain/openai"
import { createAgent, tool } from "langchain"
import * as z from "zod"
import LRU from "lru-cache"
import path from "path"
import { fileURLToPath } from "url"
import fetch from "node-fetch"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

if (!process.env.OPENAI_API_KEY) {
  console.error("Fehler: OPENAI_API_KEY fehlt")
  process.exit(1)
}
if (!process.env.REBRICKABLE_API_KEY) {
  console.warn("Hinweis: REBRICKABLE_API_KEY fehlt, keine Setdaten möglich")
}

const app = express()
app.use(cors())
app.use(express.json({ limit: "8mb" })) // Platz für Fotos
app.use(express.static(path.join(__dirname, "public")))

const limiter = rateLimit({ windowMs: 60_000, max: 30 })
app.use("/chat", limiter)

// 🔐 Optional: App-Key-Check
const APP_KEY = process.env.APP_KEY || null
function requireAppKey(req, res, next) {
  if (!APP_KEY) return next()
  const k = req.header("x-app-key")
  if (k !== APP_KEY) return res.status(401).json({ error: "Kein Zugriff" })
  next()
}

// ─────────────────────────────────────────────
// 🧱 Rebrickable API (mit Cache)
// ─────────────────────────────────────────────
const RB_BASE = "https://rebrickable.com/api/v3/lego"
const rbCache = new LRU({ max: 1000, maxAge: 60 * 60 * 1000 }) // 1 Stunde

async function rb(pathAndQuery) {
  const key = process.env.REBRICKABLE_API_KEY
  if (!key) throw new Error("Rebrickable API Key fehlt")

  const cached = rbCache.get(pathAndQuery)
  if (cached) return cached

  const res = await fetch(`${RB_BASE}${pathAndQuery}`, {
    headers: { Authorization: `key ${key}` }
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Rebrickable Fehler ${res.status}`)

  const data = await res.json()
  rbCache.set(pathAndQuery, data)
  return data
}

// "75192" → "75192-1", "10497-2" bleibt
function normalizeSetNum(n) {
  const s = String(n).trim().replace(/^#/, "")
  return /^\d+$/.test(s) ? `${s}-1` : s
}
const setPath = n => `/sets/${encodeURIComponent(normalizeSetNum(n))}`

// Listen, die sich fast nie ändern, nur einmal laden
function loadOnce(pathAndQuery) {
  let promise = null
  return () => {
    if (!promise) {
      promise = rb(pathAndQuery)
        .then(d => d?.results || [])
        .catch(err => {
          promise = null
          throw err
        })
    }
    return promise
  }
}
const getThemes = loadOnce("/themes/?page_size=1000")
const getColors = loadOnce("/colors/?page_size=1000")

async function themeName(id) {
  const t = (await getThemes()).find(t => t.id === id)
  return t?.name || null
}

// Nur echte Bausets: keine Bücher, Schlüsselanhänger, Promo-Artikel, Spiele, Ersatzteile –
// und keine nur angekündigten Sets ohne Teileangabe
const EXCLUDED_ROOT_THEMES = new Set(["Books", "Gear", "Promotional", "Games", "Service Packs", "Bulk Bricks"])
const NON_BUILD_NAME = /bundle|replacement|classroom|key ?chain|key light|magnet|puzzle|sticker|book|poster/i

async function rootThemeName(id) {
  const themes = await getThemes()
  let t = themes.find(x => x.id === id)
  while (t?.parent_id) t = themes.find(x => x.id === t.parent_id)
  return t?.name || null
}

async function isBuildSet(s) {
  if (!s || (s.num_parts ?? 0) < 10) return false
  if (NON_BUILD_NAME.test(s.name || "")) return false
  return !EXCLUDED_ROOT_THEMES.has(await rootThemeName(s.theme_id))
}

async function filterBuildSets(sets) {
  const keep = await Promise.all(sets.map(isBuildSet))
  return sets.filter((_, i) => keep[i])
}
async function findThemeIds(name) {
  const q = name.toLowerCase()
  const themes = await getThemes()
  const exact = themes.filter(t => t.name.toLowerCase() === q)
  const partial = themes.filter(t => t.name.toLowerCase().includes(q) && !exact.includes(t))
  return [...exact, ...partial].map(t => t.id)
}
async function findColor(name) {
  const q = name.toLowerCase()
  const colors = await getColors()
  return (
    colors.find(c => c.name.toLowerCase() === q) ||
    colors.find(c => c.name.toLowerCase().includes(q)) ||
    null
  )
}

async function toSetInfo(s) {
  return {
    set_num: s.set_num,
    name: s.name,
    year: s.year,
    num_parts: s.num_parts,
    theme: await themeName(s.theme_id),
    image_url: s.set_img_url || null
  }
}

async function fetchSet(setNum) {
  const s = await rb(`${setPath(setNum)}/`)
  return s ? toSetInfo(s) : null
}

// Tool-Fehler nicht werfen, sondern als Text an die KI geben
function safeTool(fn) {
  return async (args, runtime) => {
    try {
      return JSON.stringify(await fn(args, runtime))
    } catch (err) {
      console.error("Tool-Fehler:", err.message)
      return JSON.stringify({ error: "Daten gerade nicht verfügbar" })
    }
  }
}

// ─────────────────────────────────────────────
// 🛠️ Tools für die KI
// ─────────────────────────────────────────────
const getSetDetails = tool(
  safeTool(async ({ set_num }) => (await fetchSet(set_num)) || { error: "Set nicht gefunden" }),
  {
    name: "get_set_details",
    description: "Holt Infos zu einem LEGO Set über die Setnummer (z.B. 75192): Name, Jahr, Teileanzahl, Thema, Bild.",
    schema: z.object({
      set_num: z.string().describe("Setnummer, z.B. '75192' oder '75192-1'")
    })
  }
)

const searchSets = tool(
  safeTool(async ({ query, theme, min_year, max_year }) => {
    // mehr holen, weil Bücher/Promo-Artikel usw. danach rausgefiltert werden
    const params = new URLSearchParams({ page_size: "40", ordering: "-year", min_parts: "10" })
    if (query) params.set("search", query)
    if (min_year) params.set("min_year", String(min_year))
    if (max_year) params.set("max_year", String(max_year))

    let themeIds = [null]
    if (theme) {
      themeIds = (await findThemeIds(theme)).slice(0, 3)
      if (!themeIds.length) return { error: `Kein Thema "${theme}" gefunden` }
    }

    const results = []
    for (const id of themeIds) {
      const p = new URLSearchParams(params)
      if (id) p.set("theme_id", String(id))
      const data = await rb(`/sets/?${p}`)
      results.push(...(data?.results || []))
    }

    const real = await filterBuildSets(results)
    const sets = await Promise.all(real.slice(0, 10).map(toSetInfo))
    return sets.length ? { sets } : { error: "Keine Sets gefunden" }
  }),
  {
    name: "search_sets",
    description: "Sucht LEGO Sets nach Name/Stichwort, Thema (z.B. 'Ninjago', 'Star Wars') und/oder Jahr. Neueste zuerst.",
    schema: z.object({
      query: z.string().nullable().describe("Suchbegriff im Setnamen auf Englisch, z.B. 'Millennium Falcon'"),
      theme: z.string().nullable().describe("Themenname auf Englisch, z.B. 'Ninjago', 'Star Wars', 'City'"),
      min_year: z.number().int().nullable(),
      max_year: z.number().int().nullable()
    })
  }
)

const getSetMinifigs = tool(
  safeTool(async ({ set_num }) => {
    const data = await rb(`${setPath(set_num)}/minifigs/?page_size=100`)
    if (!data) return { error: "Set nicht gefunden" }
    const figs = data.results.map(f => ({ name: f.set_name, quantity: f.quantity }))
    return figs.length ? { minifigs: figs } : { minifigs: [], note: "Keine Minifiguren in diesem Set" }
  }),
  {
    name: "get_set_minifigs",
    description: "Listet die Minifiguren, die in einem LEGO Set enthalten sind.",
    schema: z.object({ set_num: z.string() })
  }
)

const getSetParts = tool(
  safeTool(async ({ set_num, color }) => {
    const data = await rb(`${setPath(set_num)}/parts/?page_size=1000`)
    if (!data) return { error: "Set nicht gefunden" }

    let parts = data.results.filter(p => !p.is_spare)
    if (color) {
      const c = color.toLowerCase()
      parts = parts.filter(p => p.color.name.toLowerCase().includes(c))
    }

    const byColor = {}
    for (const p of parts) byColor[p.color.name] = (byColor[p.color.name] || 0) + p.quantity

    return {
      total_pieces: parts.reduce((sum, p) => sum + p.quantity, 0),
      pieces_by_color: Object.entries(byColor)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([name, qty]) => ({ color: name, quantity: qty })),
      most_common_parts: [...parts]
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 10)
        .map(p => ({ name: p.part.name, color: p.color.name, quantity: p.quantity }))
    }
  }),
  {
    name: "get_set_parts",
    description: "Teileliste eines Sets: Anzahl pro Farbe und häufigste Teile. Optional nach Farbe filtern (englischer Farbname, z.B. 'Red').",
    schema: z.object({
      set_num: z.string(),
      color: z.string().nullable().describe("Englischer Farbname, z.B. 'Red'")
    })
  }
)

const getAlternateBuilds = tool(
  safeTool(async ({ set_num }) => {
    const data = await rb(`${setPath(set_num)}/alternates/?page_size=10`)
    if (!data) return { error: "Set nicht gefunden" }
    const builds = data.results.map(m => ({
      name: m.name,
      num_parts: m.num_parts,
      designer: m.designer_name || null
    }))
    return builds.length ? { alternate_builds: builds } : { alternate_builds: [], note: "Keine alternativen Modelle bekannt" }
  }),
  {
    name: "get_alternate_builds",
    description: "Findet alternative Modelle (MOCs von Fans), die man mit den Teilen eines Sets bauen kann.",
    schema: z.object({ set_num: z.string() })
  }
)

// ⚖️ Sets vergleichen
const compareSets = tool(
  safeTool(async ({ set_nums }) => {
    const sets = await Promise.all(
      set_nums.map(async n => {
        const info = await fetchSet(n)
        if (!info) return { set_num: n, error: "Set nicht gefunden" }
        const figs = await rb(`${setPath(n)}/minifigs/?page_size=100`)
        const minifigs = (figs?.results || []).reduce((sum, f) => sum + f.quantity, 0)
        return { ...info, minifig_count: minifigs }
      })
    )
    return { sets }
  }),
  {
    name: "compare_sets",
    description: "Vergleicht 2 bis 4 LEGO Sets: Name, Jahr, Teile, Thema und Anzahl Minifiguren.",
    schema: z.object({
      set_nums: z.array(z.string()).min(2).max(4).describe("Setnummern, z.B. ['75192', '75375']")
    })
  }
)

// 🔎 Teil suchen
// Rebrickable-Suche ist ungenau → selbst sortieren: exakter Name zuerst, Duplo/Drucke nach hinten
function rankParts(parts, query) {
  const q = query.toLowerCase()
  const score = p => {
    const n = p.name.toLowerCase()
    let s = n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3
    if (n.includes("duplo") && !q.includes("duplo")) s += 5
    if (/pr\d/.test(p.part_num)) s += 3
    return s + n.length / 1000
  }
  return [...parts].sort((a, b) => score(a) - score(b))
}

async function resolvePart(partNum, query) {
  if (partNum) {
    const p = await rb(`/parts/${encodeURIComponent(partNum)}/`)
    if (p) return { part: p, others: [] }
  }
  const q = String(query || "").replace(/(\d)\s*x\s*(?=\d)/gi, "$1 x ").trim()
  if (!q) return null
  const search = await rb(`/parts/?search=${encodeURIComponent(q)}&page_size=1000`)
  const ranked = rankParts(search?.results || [], q)
  if (!ranked.length) return null
  return { part: ranked[0], others: ranked.slice(1, 5).map(p => p.name) }
}

const findPart = tool(
  safeTool(async ({ part_num, part_query, color }) => {
    const found = await resolvePart(part_num, part_query)
    if (!found) return { error: `Kein Teil zu "${part_query}" gefunden` }

    const { part, others } = found
    const partInfo = { part_num: part.part_num, name: part.name }

    if (!color) {
      const colors = await rb(`/parts/${encodeURIComponent(part.part_num)}/colors/?page_size=200`)
      return {
        part: partInfo,
        similar_parts: others,
        available_colors: (colors?.results || [])
          .sort((a, b) => b.num_sets - a.num_sets)
          .slice(0, 12)
          .map(c => ({ color: c.color_name, in_sets: c.num_sets })),
        note: "Für eine Setliste nach der Farbe fragen"
      }
    }

    const c = await findColor(color)
    if (!c) return { part: partInfo, error: `Farbe "${color}" nicht gefunden` }

    const data = await rb(
      `/parts/${encodeURIComponent(part.part_num)}/colors/${c.id}/sets/?page_size=100&ordering=-year`
    )
    // Nur echte Bausets (keine Bundles/Ersatzpacks ohne Teileangabe)
    const real = (await filterBuildSets(data?.results || [])).filter(
      s => s.num_parts >= 50 && !/pack|kit \d/i.test(s.name)
    )
    const sets = await Promise.all(real.slice(0, 10).map(toSetInfo))
    return {
      part: partInfo,
      color: c.name,
      similar_parts: others,
      total_sets: data?.count ?? sets.length,
      sets
    }
  }),
  {
    name: "find_part",
    description:
      "Findet ein LEGO Teil und in welchen Sets es in einer bestimmten Farbe vorkommt. Ohne Farbe: zeigt verfügbare Farben.",
    schema: z.object({
      part_num: z
        .string()
        .nullable()
        .describe("LEGO Teilenummer, falls du sie sicher kennst, z.B. '3001' (Brick 2 x 4), '3023' (Plate 1 x 2), '3068b' (Tile 2 x 2)"),
      part_query: z
        .string()
        .describe("Teilename auf Englisch im Rebrickable-Stil, z.B. 'Brick 2 x 4', 'Plate 1 x 2', 'Tile 2 x 2'"),
      color: z.string().nullable().describe("Englischer Farbname, z.B. 'Red', 'Dark Bluish Gray'")
    })
  }
)

// 🎲 Zufallsset
const randomSet = tool(
  safeTool(async ({ theme, min_parts }) => {
    const params = new URLSearchParams({ page_size: "1", min_parts: String(min_parts ?? 150) })
    if (theme) {
      const ids = await findThemeIds(theme)
      if (!ids.length) return { error: `Kein Thema "${theme}" gefunden` }
      params.set("theme_id", String(ids[Math.floor(Math.random() * Math.min(ids.length, 3))]))
    }

    const first = await rb(`/sets/?${params}`)
    const count = Math.min(first?.count || 0, 10000)
    if (!count) return { error: "Kein passendes Set gefunden" }

    // bis zu 4 Versuche, falls ein Buch/Promo-Artikel o.ä. erwischt wird
    for (let i = 0; i < 4; i++) {
      params.set("page", String(1 + Math.floor(Math.random() * count)))
      const data = await rb(`/sets/?${params}`)
      const s = data?.results?.[0]
      if (await isBuildSet(s)) return toSetInfo(s)
    }
    return { error: "Kein Set gefunden" }
  }),
  {
    name: "random_set",
    description:
      "Holt ein zufälliges LEGO Set, optional aus einem Thema. Gut für Entdeckungen und Quizfragen.",
    schema: z.object({
      theme: z.string().nullable().describe("Themenname auf Englisch, z.B. 'Technic'"),
      min_parts: z.number().int().nullable().describe("Mindestanzahl Teile (Standard 150)")
    })
  }
)

// 📸 Foto mit echten Set-Bildern vergleichen
const MODEL_NAME = process.env.OPENAI_MODEL || "gpt-4.1-mini" // in .env änderbar, z.B. OPENAI_MODEL=gpt-4o-mini

const VISION_FINAL_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4.1" // genauer Bildvergleich

function makeVisionModel(schema, maxTokens, model = MODEL_NAME) {
  return new ChatOpenAI({
    model,
    temperature: 0,
    maxTokens,
    apiKey: process.env.OPENAI_API_KEY
  }).withStructuredOutput(schema)
}

// Runde 1: aus einer Gruppe die ähnlichsten Kandidaten aussuchen
const shortlistModel = makeVisionModel(
  z.object({
    similar: z
      .array(z.string())
      .describe("Bis zu 2 Setnummern, die dem Foto am ähnlichsten sind (beste zuerst). Leer, wenn keins ähnlich ist.")
  }),
  150,
  process.env.OPENAI_SHORTLIST_MODEL || VISION_FINAL_MODEL // günstiger, aber ungenauer: gpt-4.1-mini
)

// Runde 2: genauer Vergleich der Finalisten
const finalModel = makeVisionModel(
  z.object({
    best_match: z.string().nullable().describe("Setnummer des besten Treffers oder null, wenn keiner wirklich passt"),
    confidence: z.enum(["high", "medium", "low"]).describe("high nur, wenn markante Details eindeutig übereinstimmen"),
    runner_ups: z.array(z.string()).describe("Bis zu 2 weitere mögliche Setnummern"),
    reason: z.string().describe("Kurze Begründung: welche Merkmale passen oder nicht")
  }),
  400,
  VISION_FINAL_MODEL
)

// Das zuletzt vom Nutzer geschickte Foto aus dem Gesprächsverlauf holen
function findUserPhoto(runtime) {
  const messages = runtime?.state?.messages || []
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = messages[i].content
    if (!Array.isArray(content)) continue
    const img = content.find(c => c.type === "image_url")
    if (img) return typeof img.image_url === "string" ? img.image_url : img.image_url?.url
  }
  return null
}

const MAX_PHOTO_CANDIDATES = 160
const SHORTLIST_GROUP = 10
const MAX_FINALISTS = 10

// Set-Bilder selbst laden und direkt mitschicken
// (OpenAI schafft es nicht, viele Bilder rechtzeitig selbst herunterzuladen)
const imageCache = new LRU({ max: 3000, maxAge: 24 * 60 * 60 * 1000 })
async function imageDataUrl(imageUrl, small = true) {
  const key = (small ? "s:" : "l:") + imageUrl
  const cached = imageCache.get(key)
  if (cached) return cached

  const thumbUrl = imageUrl.replace("/media/sets/", "/media/thumbs/sets/") + "/300x300p.jpg"
  const urls = small ? [thumbUrl, imageUrl] : [imageUrl, thumbUrl]
  for (const url of urls) {
    try {
      const res = await fetch(url, { timeout: 8000 })
      if (!res.ok) continue
      const type = res.headers.get("content-type") || "image/jpeg"
      const data = `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`
      imageCache.set(key, data)
      return data
    } catch {}
  }
  return null
}

// Kandidaten breit sammeln: alle Jahre, mehrere Suchbegriffe/Themen
async function gatherCandidates({ search_terms, themes, candidate_set_nums }) {
  const hits = new Map() // set_num → { set, score }
  const add = (s, weight = 1) => {
    if (!s?.set_num) return
    const entry = hits.get(s.set_num) || { set: s, score: 0 }
    entry.score += weight
    hits.set(s.set_num, entry)
  }

  const requests = []
  for (const term of (search_terms || []).slice(0, 4)) {
    requests.push(
      rb(`/sets/?search=${encodeURIComponent(term)}&min_parts=20&page_size=200`).then(d =>
        (d?.results || []).forEach(s => add(s, 2))
      )
    )
  }
  for (const theme of (themes || []).slice(0, 2)) {
    requests.push(
      findThemeIds(theme).then(async ids => {
        for (const id of ids.slice(0, 2)) {
          const d = await rb(`/sets/?theme_id=${id}&min_parts=20&page_size=200&ordering=-year`)
          ;(d?.results || []).forEach(s => add(s))
        }
      })
    )
  }
  for (const n of candidate_set_nums || []) {
    requests.push(rb(`${setPath(n)}/`).then(s => add(s, 3)).catch(() => {}))
  }
  await Promise.all(requests.map(p => p.catch(err => console.error("Kandidaten-Suche:", err.message))))

  const ranked = [...hits.values()]
    .filter(e => e.set.set_img_url)
    .sort((a, b) => b.score - a.score)
    .map(e => e.set)

  const build = await filterBuildSets(ranked)
  return Promise.all(build.slice(0, MAX_PHOTO_CANDIDATES).map(toSetInfo))
}

function candidateContent(intro, photo, sets, imageKey, photoDetail = "high") {
  return [
    { type: "text", text: intro },
    { type: "image_url", image_url: { url: photo, detail: photoDetail } },
    ...sets.flatMap(s => [
      { type: "text", text: `Kandidat ${s.set_num}: ${s.name} (${s.year}, ${s.num_parts} Teile)` },
      { type: "image_url", image_url: { url: s[imageKey], detail: "low" } }
    ])
  ]
}

const PHOTO_HINT =
  "Das Foto kann gespiegelt, schräg, schlecht beleuchtet oder nur ein Ausschnitt sein (z.B. nur der Dino, nur das Fahrzeug). " +
  "Vergleiche markante Details: Form, Farbkombination, besondere Teile, Aufdrucke, Proportionen."

const comparePhoto = tool(
  safeTool(async (args, runtime) => {
    const photo = findUserPhoto(runtime)
    if (!photo) return { error: "Kein Foto in dieser Nachricht" }

    const t0 = Date.now()
    const found = await gatherCandidates(args)
    const thumbs = await Promise.all(found.map(s => imageDataUrl(s.image_url, true)))
    const pool = found.map((s, i) => ({ ...s, thumb: thumbs[i] })).filter(s => s.thumb)
    if (!pool.length) return { error: "Keine Kandidaten gefunden – andere Suchbegriffe probieren" }
    const t1 = Date.now()

    // Runde 1: in Gruppen grob vorsortieren (parallel)
    let finalists = pool
    if (pool.length > MAX_FINALISTS) {
      const groups = []
      for (let i = 0; i < pool.length; i += SHORTLIST_GROUP) groups.push(pool.slice(i, i + SHORTLIST_GROUP))
      const picks = await Promise.all(
        groups.map(group =>
          shortlistModel
            .invoke([
              {
                role: "user",
                content: candidateContent(
                  "Das erste Bild ist ein Foto vom Nutzer, danach folgen offizielle LEGO Set-Bilder. " +
                    "Welche bis zu 2 Sets sind dem Foto am ähnlichsten? " +
                    PHOTO_HINT,
                  photo,
                  group,
                  "thumb",
                  "low" // Vorauswahl: Foto klein reicht, spart Zeit und Geld
                )
              }
            ])
            .then(r => (r.similar || []).slice(0, 2))
            .catch(err => {
              console.error("Vorauswahl-Fehler:", err.message)
              return []
            })
        )
      )
      const chosen = new Set(picks.flat().map(normalizeSetNum))
      finalists = pool.filter(s => chosen.has(s.set_num)).slice(0, MAX_FINALISTS)
      if (!finalists.length) {
        return { compared_candidates: pool.length, best_match: null, confidence: "low", reason: "Kein Kandidat sah ähnlich aus" }
      }
    }

    const t2 = Date.now()
    // Runde 2: Finalisten mit größeren Bildern genau vergleichen
    const large = await Promise.all(finalists.map(s => imageDataUrl(s.image_url, false)))
    finalists = finalists.map((s, i) => ({ ...s, large: large[i] || s.thumb }))

    const verdict = await finalModel.invoke([
      {
        role: "user",
        content: candidateContent(
          "Das erste Bild ist ein Foto vom Nutzer, danach folgen die engsten Kandidaten (offizielle LEGO Set-Bilder). " +
            "Welches Set zeigt das Foto? " +
            PHOTO_HINT +
            " Wenn keins wirklich passt, gib best_match = null.",
          photo,
          finalists,
          "large"
        )
      }
    ])
    console.log(
      `📸 Foto-Vergleich: ${pool.length} Kandidaten → ${finalists.length} Finalisten [${finalists.map(s => s.set_num).join(", ")}] → ${verdict.best_match} (${verdict.confidence}) | Suche ${t1 - t0}ms, Runde1 ${t2 - t1}ms, Runde2 ${Date.now() - t2}ms`
    )

    const byNum = Object.fromEntries(finalists.map(({ thumb, large, ...s }) => [s.set_num, s]))
    const pick = n => byNum[normalizeSetNum(n || "")] || null

    return {
      compared_candidates: pool.length,
      best_match: pick(verdict.best_match),
      confidence: verdict.confidence,
      reason: verdict.reason,
      other_candidates: (verdict.runner_ups || []).map(pick).filter(Boolean).slice(0, 2)
    }
  }),
  {
    name: "compare_photo_with_sets",
    description:
      "Findet heraus, welches LEGO Set auf dem Foto des Nutzers ist: sucht selbst passende Kandidaten (alle Jahre) und vergleicht das Foto mit deren offiziellen Bildern.",
    schema: z.object({
      search_terms: z
        .array(z.string())
        .describe("2–4 englische Suchbegriffe für den Setnamen, z.B. ['dinosaur', 'dino', 'T. rex'] oder ['fire station', 'fire truck', 'fire']"),
      themes: z
        .array(z.string())
        .describe("0–2 englische Themennamen, falls klar erkennbar, z.B. ['City'], ['Ninjago']. Sonst leer."),
      candidate_set_nums: z.array(z.string()).describe("Optional: Setnummern, die du schon vermutest. Sonst leer.")
    })
  }
)

// 🦖 Tierfiguren (z.B. Raptor, T. rex, Drache): fertige Figuren sind bei LEGO "Teile", keine Sets
const figureModel = makeVisionModel(
  z.object({
    matches: z
      .array(z.string())
      .describe("Bis zu 3 Teilenummern der Figuren, die dem Foto am ähnlichsten sind (beste zuerst). Leer, wenn keine passt."),
    confidence: z.enum(["high", "medium", "low"])
  }),
  150,
  VISION_FINAL_MODEL
)

// "Animal, ..." sind ganze Figuren; Körperteile/Zubehör heißen "Animal Body Part" / "Animal / Creature Accessory"
const FIGURE_EXCLUDE = /\begg\b/i

// Rebrickable-Namen: z.B. heißen Velociraptoren nur "Raptor"
const ANIMAL_ALIASES = { velociraptor: "Raptor", tyrannosaurus: "T. rex", "t-rex": "T. rex", trex: "T. rex" }

async function setsWithPart(partNum, limit = 6) {
  const colors = await rb(`/parts/${encodeURIComponent(partNum)}/colors/?page_size=50`)
  const color = (colors?.results || []).sort((a, b) => b.num_sets - a.num_sets)[0]
  if (!color) return []
  const data = await rb(
    `/parts/${encodeURIComponent(partNum)}/colors/${color.color_id}/sets/?page_size=50&ordering=-year`
  )
  const sets = await filterBuildSets(data?.results || [])
  return Promise.all(sets.slice(0, limit).map(toSetInfo))
}

const findAnimalFigure = tool(
  safeTool(async ({ animal, use_photo }, runtime) => {
    const raw = String(animal || "").trim()
    const query = ANIMAL_ALIASES[raw.toLowerCase().replace(/\s+/g, "")] || raw.replace(/velociraptor/i, "Raptor")
    if (!query) return { error: "Welches Tier?" }

    // Alle Figur-Varianten suchen (z.B. "Animal, Dinosaur, Raptor ...")
    const searches = await Promise.all(
      [query, `Dinosaur ${query}`, `Animal ${query}`].map(q =>
        rb(`/parts/?search=${encodeURIComponent(q)}&page_size=200`).catch(() => null)
      )
    )
    const byNum = new Map()
    for (const d of searches) {
      for (const p of d?.results || []) {
        if (/^animal,/i.test(p.name) && !FIGURE_EXCLUDE.test(p.name) && p.part_img_url) byNum.set(p.part_num, p)
      }
    }
    let figures = [...byNum.values()].slice(0, 30)
    if (!figures.length) return { error: `Keine Figur zu "${query}" gefunden` }

    let confidence = null
    const photo = use_photo ? findUserPhoto(runtime) : null
    if (photo) {
      // Foto mit den Bildern aller Varianten vergleichen
      const imgs = await Promise.all(figures.map(p => imageDataUrl(p.part_img_url, true)))
      const withImg = figures.map((p, i) => ({ ...p, img: imgs[i] })).filter(p => p.img)
      const verdict = await figureModel.invoke([
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Das erste Bild ist ein Foto vom Nutzer, danach folgen offizielle Bilder von LEGO Tierfiguren. " +
                "Welche Figuren sind es am wahrscheinlichsten? Achte besonders auf Farben und Aufdruck-Muster. " +
                PHOTO_HINT
            },
            { type: "image_url", image_url: { url: photo, detail: "high" } },
            ...withImg.flatMap(p => [
              { type: "text", text: `Figur ${p.part_num}: ${p.name}` },
              { type: "image_url", image_url: { url: p.img, detail: "low" } }
            ])
          ]
        }
      ])
      confidence = verdict.confidence
      const order = (verdict.matches || []).map(n => byNum.get(n)).filter(Boolean)
      console.log(`🦖 Figur-Vergleich: ${withImg.length} Varianten → ${order.map(p => p.part_num).join(", ")} (${confidence})`)
      if (!order.length) return { figures_compared: withImg.length, best_match: null, confidence: "low" }
      figures = order
    }

    // Zu den besten Figuren die Sets holen, in denen sie stecken
    const top = figures.slice(0, photo ? 2 : 4)
    const results = []
    for (const p of top) {
      results.push({
        part_num: p.part_num,
        figure: p.name.replace(/^Animal,\s*/i, ""),
        in_sets: await setsWithPart(p.part_num, photo ? 4 : 3)
      })
    }

    return {
      ...(photo ? { confidence } : { total_variants: byNum.size }),
      figures: results
    }
  }),
  {
    name: "find_animal_figure",
    description:
      "Für fertige LEGO Tierfiguren (z.B. Dinosaurier wie Raptor/T. rex, Drachen, Haie): findet die Figur-Varianten und in welchen Sets sie enthalten sind. Mit use_photo=true wird das Foto des Nutzers mit allen Varianten verglichen.",
    schema: z.object({
      animal: z.string().describe("Englischer Tiername, z.B. 'Raptor', 'T. rex', 'Triceratops', 'Dragon', 'Shark'"),
      use_photo: z.boolean().describe("true, wenn der Nutzer ein Foto der Figur geschickt hat")
    })
  }
)

// ─────────────────────────────────────────────
// 🏗️ Eigene Modelle aus den Steinen des Nutzers (mit Bild + Bauanleitung)
// ─────────────────────────────────────────────
const BUILD_MODEL = process.env.OPENAI_BUILD_MODEL || "gpt-5-mini" // plant räumlich am besten

const BRICK_COLORS = {
  red: { hex: "#C91A09", de: "rot" },
  blue: { hex: "#0055BF", de: "blau" },
  yellow: { hex: "#F2CD37", de: "gelb" },
  green: { hex: "#237841", de: "grün" },
  lime: { hex: "#A5CA18", de: "hellgrün" },
  "dark green": { hex: "#184632", de: "dunkelgrün" },
  "light blue": { hex: "#5A93DB", de: "hellblau" },
  "dark blue": { hex: "#0A3463", de: "dunkelblau" },
  orange: { hex: "#FE8A18", de: "orange" },
  pink: { hex: "#FC97AC", de: "rosa" },
  purple: { hex: "#8A3FB0", de: "lila" },
  brown: { hex: "#6B3F22", de: "braun" },
  tan: { hex: "#E4CD9E", de: "beige" },
  white: { hex: "#F4F4F4", de: "weiß" },
  "light gray": { hex: "#A0A5A9", de: "hellgrau" },
  "dark gray": { hex: "#6C6E68", de: "dunkelgrau" },
  black: { hex: "#2B2B2B", de: "schwarz" },
  "dark red": { hex: "#8E1B1B", de: "dunkelrot" }
}
const COLOR_NAMES = Object.keys(BRICK_COLORS)
const KIND_HEIGHT = { brick: 3, plate: 1, tile: 1 } // Höhe in Platten-Einheiten
const KIND_LABEL = {
  de: { brick: "Stein", plate: "Platte", tile: "Fliese" },
  en: { brick: "brick", plate: "plate", tile: "tile" }
}
const GRID = 24 // max. Grundfläche in Noppen
const MAX_HEIGHT = 45 // max. Höhe in Platten

const sizeOf = s => {
  const m = /^\s*(\d{1,2})\s*[x×]\s*(\d{1,2})\s*$/i.exec(String(s))
  if (!m) return null
  const a = +m[1]
  const b = +m[2]
  return a >= 1 && b >= 1 && a <= 16 && b <= 16 ? [a, b] : null
}
const partKey = (kind, size, color) => {
  const [a, b] = sizeOf(size)
  return `${kind}|${Math.min(a, b)}x${Math.max(a, b)}|${color}`
}

const BuildPlanSchema = z.object({
  name: z.string().describe("Kurzer Name des Modells"),
  description: z.string().describe("1 Satz, was es ist"),
  pieces: z.array(
    z.object({
      size: z.string().describe("z.B. '2x4' (A Noppen entlang x, B entlang y)"),
      kind: z.enum(["brick", "plate", "tile"]),
      color: z.enum(COLOR_NAMES),
      x: z.number().int().describe("linke Kante (Noppen)"),
      y: z.number().int().describe("hintere Kante (Noppen)"),
      rotated: z.boolean().describe("true = um 90° gedreht (A entlang y, B entlang x)"),
      step: z.number().int().describe("Bauschritt, beginnend bei 1")
    })
  ),
  steps: z.array(z.string()).describe("Kurze Anleitung pro Schritt: steps[0] gehört zu Schritt 1 usw.")
})

// Denk-Modelle (gpt-5…, o…) können räumlich viel besser planen, kennen aber keine "temperature"
const BUILD_REASONING = /^(gpt-5|o\d)/.test(BUILD_MODEL)
const buildModel = new ChatOpenAI({
  model: BUILD_MODEL,
  apiKey: process.env.OPENAI_API_KEY,
  ...(BUILD_REASONING
    ? { reasoning: { effort: process.env.OPENAI_BUILD_EFFORT || "low" }, maxTokens: 16000 }
    : { temperature: 0.7, maxTokens: 4000 })
}).withStructuredOutput(BuildPlanSchema)

const BUILD_RULES = `You design small, simple, recognizable LEGO models for kids, using ONLY the given parts.
HOW PLACING WORKS (a computer simulates it, so be exact):
- Seen from above: x = left→right, y = back→front, in studs. A piece of size "AxB" covers A studs along x and B studs along y, starting at its corner (x, y). rotated=true swaps that (B along x, A along y).
- You only give x and y. Pieces are placed in list order and DROP DOWN like with gravity: each piece lands on top of the highest piece below any part of its footprint (or on the ground). So to stack, just place a piece at the same x/y again later in the list.
- A brick is 3 times as high as a plate. Tiles are smooth: nothing can be put on a tile.
- All pieces must form ONE connected model. Pieces only connect by sitting on each other – pieces side by side are NOT connected. Join neighbouring pieces with a piece on top that overlaps both (like bricks in a real wall), or build everything on one big base plate.
- Never use more pieces of a kind/size/color than the user has. You don't need to use all of them.
- Use 0 ≤ x, y < ${GRID} and keep the model compact.
- Steps: bottom to top, 3–10 steps, each step adds a few pieces. List pieces in step order.
EXAMPLE (a 2-wide tower on a plate): 2x4 plate at (0,0) step 1; 2x2 brick at (0,0) step 2; 2x2 brick at (0,2) step 2; 2x4 brick at (0,0) step 3 ← this one connects both 2x2 bricks.
- The model should clearly look like what it is (use colors smartly, e.g. windows, roof, eyes, wheels from black pieces).
- Step texts: one short, friendly sentence each for a child, saying where the pieces go (e.g. "Put the 2 red bricks on the left and right side of the plate"). Never mention coordinates or numbers like (0,2) in texts – use words like left, right, front, back, middle, on top.`

function describeInventory(inventory) {
  return inventory.map(p => `${p.count}× ${p.size} ${p.kind}, ${p.color}`).join("\n")
}

// Teile der Reihe nach "fallen lassen" (wie echte Schwerkraft): die Höhe rechnen wir selbst aus.
// strict = Fehler melden (für eine Korrektur-Runde), sonst unpassende Teile einfach weglassen.
function placeBuild(rawPieces, inventory, strict) {
  const errors = []
  const have = new Map()
  for (const p of inventory) {
    const k = partKey(p.kind, p.size, p.color)
    have.set(k, (have.get(k) || 0) + p.count)
  }
  const used = new Map()
  const top = new Map() // "x,y" → { z: Oberkante, i: Teil }
  const placed = []
  const order = rawPieces.map((p, n) => ({ ...p, n })).sort((a, b) => a.step - b.step || a.n - b.n)

  for (const p of order) {
    const size = sizeOf(p.size)
    if (!size || !KIND_HEIGHT[p.kind] || !BRICK_COLORS[p.color]) {
      if (strict) errors.push(`Piece ${p.n}: invalid size/kind/color`)
      continue
    }
    const k = partKey(p.kind, p.size, p.color)
    if ((used.get(k) || 0) >= (have.get(k) || 0)) {
      if (strict) {
        const [kind, sz, color] = k.split("|")
        errors.push(`Piece ${p.n}: no ${color} ${sz} ${kind} left (user has ${have.get(k) || 0})`)
      }
      continue
    }
    const [w, l] = p.rotated ? [size[1], size[0]] : size
    if (p.x < 0 || p.y < 0 || p.x + w > GRID || p.y + l > GRID) {
      if (strict) errors.push(`Piece ${p.n}: outside the area 0..${GRID - 1}`)
      continue
    }
    // Landehöhe = höchste Oberkante unter der Grundfläche
    let z = 0
    for (let x = p.x; x < p.x + w; x++)
      for (let y = p.y; y < p.y + l; y++) z = Math.max(z, top.get(`${x},${y}`)?.z || 0)
    const below = new Set()
    let onTile = false
    for (let x = p.x; x < p.x + w; x++)
      for (let y = p.y; y < p.y + l; y++) {
        const t = top.get(`${x},${y}`)
        if (t && t.z === z) placed[t.i].tile ? (onTile = true) : below.add(t.i)
      }
    const h = KIND_HEIGHT[p.kind]
    if (z + h > MAX_HEIGHT) {
      if (strict) errors.push(`Piece ${p.n}: the model is too tall`)
      continue
    }
    if (strict) {
      // Teilweise überlappend im selben Schritt = meist "nebeneinander" gemeint (genau gestapelt ist ok)
      const sameStep = [...below].filter(j => {
        const q = placed[j]
        return q.step === p.step && q.kind === p.kind && !(q.x === p.x && q.y === p.y && q.w === w && q.l === l)
      })
      if (sameStep.length) {
        errors.push(
          `Piece ${p.n} overlaps piece ${placed[sameStep[0]].n} from the same step, so it landed ON TOP of it. If they should be side by side, move it so their footprints don't overlap.`
        )
      }
    }
    if (z > 0 && !below.size) {
      if (strict) errors.push(`Piece ${p.n} would land on a tile (no studs) and fall off`)
      if (!strict || onTile) continue
    }
    used.set(k, (used.get(k) || 0) + 1)
    const i = placed.length
    placed.push({ ...p, z, w, l, h, tile: p.kind === "tile", below })
    for (let x = p.x; x < p.x + w; x++) for (let y = p.y; y < p.y + l; y++) top.set(`${x},${y}`, { z: z + h, i })
  }

  // Zusammenhang: Teile hängen nur zusammen, wenn eins auf dem anderen steckt
  const adj = placed.map(() => new Set())
  placed.forEach((p, i) => p.below.forEach(j => (adj[i].add(j), adj[j].add(i))))
  const comp = new Array(placed.length).fill(-1)
  const sizes = []
  placed.forEach((_, s) => {
    if (comp[s] !== -1) return
    const id = sizes.length
    let count = 0
    const stack = [s]
    comp[s] = id
    while (stack.length) {
      const n = stack.pop()
      count++
      for (const m of adj[n]) if (comp[m] === -1) (comp[m] = id), stack.push(m)
    }
    sizes.push(count)
  })
  const main = sizes.indexOf(Math.max(0, ...sizes))
  if (strict && sizes.length > 1) {
    const loose = placed.filter((_, i) => comp[i] !== main).map(p => p.n)
    errors.push(
      `The model falls apart: pieces ${loose.join(", ")} are not connected to the rest. Pieces side by side are not connected – add or move a piece so it sits on top of (or under) both parts, like overlapping bricks in a wall.`
    )
  }
  const result = placed.filter((_, i) => comp[i] === main)
  // Schritt eines Teils nie vor dem Teil, auf dem es steht
  const stepOf = new Map()
  placed.forEach((p, i) => stepOf.set(i, Math.max(p.step, ...[...p.below].map(j => stepOf.get(j)))))
  return {
    errors,
    pieces: result.map(p => ({ ...p, step: stepOf.get(placed.indexOf(p)) }))
  }
}

const builds = new LRU({ max: 300, maxAge: 2 * 60 * 60 * 1000 })

function finishBuild(plan, pieces, lang) {
  // Schritte lückenlos nummerieren, Texte mitnehmen
  const stepNums = [...new Set(pieces.map(p => p.step))].sort((a, b) => a - b)
  const L = KIND_LABEL[lang]
  const steps = stepNums.map((n, idx) => {
    const these = pieces.filter(p => p.step === n)
    const counts = new Map()
    for (const p of these) {
      const k = `${p.size}|${p.kind}|${p.color}`
      counts.set(k, (counts.get(k) || 0) + 1)
    }
    return {
      text:
        plan.steps[n - 1] ||
        (lang === "de" ? "Setze diese Teile wie im Bild auf." : "Add these pieces like in the picture."),
      parts: [...counts].map(([k, count]) => {
        const [size, kind, color] = k.split("|")
        const c = BRICK_COLORS[color]
        return { count, label: `${size} ${L[kind]}`, color: c.hex, color_name: lang === "de" ? c.de : color }
      }),
      _n: n,
      _idx: idx + 1
    }
  })
  const stepIndex = new Map(steps.map(s => [s._n, s._idx]))
  const build = {
    id: Math.random().toString(36).slice(2, 10),
    name: plan.name,
    description: plan.description,
    lang,
    total: pieces.length,
    parts_list: (() => {
      const counts = new Map()
      for (const p of pieces) {
        const k = `${p.size} ${p.kind} ${p.color}`
        counts.set(k, (counts.get(k) || 0) + 1)
      }
      return [...counts].map(([k, n]) => `${n}× ${k}`).join(", ")
    })(),
    pieces: pieces.map(p => ({
      x: p.x,
      y: p.y,
      z: p.z,
      w: p.w,
      l: p.l,
      h: p.h,
      tile: p.tile,
      color: BRICK_COLORS[p.color].hex,
      step: stepIndex.get(p.step)
    })),
    steps: steps.map(({ _n, _idx, ...s }) => s)
  }
  builds.set(build.id, build)
  return build
}

const designBuild = tool(
  safeTool(async ({ inventory, idea, language }) => {
    const items = (inventory || []).filter(p => p.count > 0 && sizeOf(p.size)).map(p => ({ ...p, count: Math.min(p.count, 50) }))
    if (!items.length) return { error: "Keine gültigen Steine angegeben (z.B. 4x roter 2x4 Stein)" }
    const lang = language === "en" ? "en" : "de"
    const ask =
      `The user has these parts:\n${describeInventory(items)}\n\n` +
      (idea ? `Build idea: ${idea}\n` : "Pick the coolest idea that works well with these parts.\n") +
      `Write name, description and step texts in ${lang === "de" ? "German (informal 'du')" : "English"}.`

    const t = Date.now()
    const messages = [
      { role: "system", content: BUILD_RULES },
      { role: "user", content: ask }
    ]
    let plan = null
    let check = null
    let attempts = 0
    while (attempts < (BUILD_REASONING ? 2 : 3)) {
      attempts++
      plan = await buildModel.invoke(messages)
      check = placeBuild(plan.pieces || [], items, true)
      if (!check.errors.length) break
      console.log(`🏗️ Versuch ${attempts}: ${check.errors.slice(0, 4).join(" | ")}`)
      messages.push(
        { role: "assistant", content: JSON.stringify(plan) },
        { role: "user", content: `This plan has problems:\n- ${check.errors.slice(0, 12).join("\n- ")}\nFix them and return the complete corrected plan (also update the step texts).` }
      )
    }

    const pieces = check.errors.length ? placeBuild(plan.pieces || [], items, false).pieces : check.pieces
    console.log(
      `🏗️ Bauidee "${plan.name}": ${pieces.length} Teile, ${attempts} Versuch(e)${check.errors.length ? ", repariert" : ""} (${Date.now() - t} ms)`
    )
    if (pieces.length < 2) return { error: "Daraus konnte ich kein stabiles Modell bauen – mehr Steine angeben?" }

    const build = finishBuild(plan, pieces, lang)
    return {
      build_id: build.id,
      name: build.name,
      description: build.description,
      pieces_used: build.total,
      parts_used: build.parts_list,
      steps: build.steps.length,
      note: "The picture and the step-by-step instructions are shown automatically below your reply. Do NOT list the steps again – just introduce the model in 1–2 fun sentences."
    }
  }),
  {
    name: "design_build",
    description:
      "Erfindet ein eigenes kleines Modell aus den Steinen, die der Nutzer hat, und erzeugt ein Bild plus Schritt-für-Schritt-Bauanleitung. Nur einfache Steine (brick), Platten (plate) und Fliesen (tile).",
    schema: z.object({
      inventory: z
        .array(
          z.object({
            count: z.number().int().describe("Anzahl"),
            size: z.string().describe("Größe in Noppen, z.B. '2x4', '1x2', '2x2'"),
            kind: z.enum(["brick", "plate", "tile"]).describe("brick = normaler Stein, plate = flache Platte, tile = glatte Platte ohne Noppen"),
            color: z.enum(COLOR_NAMES)
          })
        )
        .describe("Alle Steine des Nutzers"),
      idea: z.string().nullable().describe("Was gebaut werden soll (z.B. 'house', 'car'), oder null für eine eigene Idee"),
      language: z.enum(["de", "en"]).describe("Sprache des Nutzers")
    })
  }
)


const tools = [
  getSetDetails,
  searchSets,
  getSetMinifigs,
  getSetParts,
  getAlternateBuilds,
  compareSets,
  findPart,
  randomSet,
  comparePhoto,
  findAnimalFigure,
  designBuild
]

// ─────────────────────────────────────────────
// 🤖 Agent
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a relaxed LEGO expert who explains things in a kid-friendly, fun way – like a buddy who loves LEGO.
No jargon, no long texts, no links.

LANGUAGE (most important rule): Write "reply" in the language of the user's LATEST message. German message → German reply. English message → English reply. Any other language → that language. If unclear, use German. Use the informal "du" in German.

DATA: You have tools for real LEGO data. Always use them for concrete sets, parts, numbers or facts – never guess set numbers or piece counts. Never mention where the data comes from.
NEVER name, describe or recommend specific sets from memory. Every set you mention must come from a tool result (this turn or earlier [Sets: ...] notes) and must be in show_sets so the user sees its picture.
If you offered something and the user agrees ("ja", "zeig mal", "gerne", "yes", "ok"), do it immediately with tools – never ask back.
If the user asks for pictures/images ("Bilder", "pictures"), put the sets in show_sets (fetch them with a tool if needed).
- Topic searches ("dinosaur sets", "police sets") → search_sets with English keywords and/or theme (e.g. query "dinosaur" or theme "Jurassic World").
- LEGO animal figures (molded dinosaurs like Raptor/T. rex, dragons, sharks…) or "which sets have the raptor" → find_animal_figure.
- Comparisons ("which is better", "difference") → compare_sets, then briefly name the differences and give an honest recommendation.
- Questions about a part/brick → find_part (translate part names and colors to English).
- "Show me any / a random set" → random_set.
- "New / current sets" → search_sets with min_year = ${new Date().getFullYear() - 1}. Only present released sets, not announcements.
- "I have these bricks, what can I build?" / build ideas with the user's own bricks → design_build. Translate sizes, kinds and colors to the tool format (e.g. "4 rote 2x4 Steine" → count 4, size "2x4", kind brick, color red; "Platte" → plate; "Fliese"/smooth → tile). If no count is given, assume 1 for "ein" and 4 for "ein paar"/"some". If the user sends a photo of loose bricks, count them from the photo. Special parts (wheels, windows, slopes…) can't be used – say so briefly. If the user gives no bricks at all, ask which bricks they have. A picture and the step-by-step instructions appear automatically – never write the steps yourself, keep show_sets empty.

PHOTOS: If the user sends a photo, your goal is to name the exact LEGO set.
1. If a set number or set name is visible (e.g. on a box or manual) → get_set_details directly.
2. Otherwise call compare_photo_with_sets directly: give it 2–4 English search terms describing what the model is (e.g. dinosaur → ["dinosaur", "dino", "T. rex"]; police car → ["police", "police car"]) and a theme only if clearly recognizable (e.g. Ninjago, Star Wars, Jurassic World). It searches candidates from all years itself and compares the images. If the result has low confidence or no match, you may try once more with different search terms.
3. Answer with the best match and how sure you are (sure / probably / just a guess). Put the best match and up to 2 alternatives in show_sets. If confidence is low, say honestly that it's a guess and ask for a photo from another angle or of the box.
If the photo shows a molded LEGO animal FIGURE (e.g. a one-piece dinosaur like a raptor, not built from bricks) → find_animal_figure with use_photo=true, then name the figure and the sets it comes in.
Only if it's clearly a single loose brick or part, describe it instead (and use find_part if helpful).

QUIZ: If the user wants a quiz:
- Ask only ONE question at a time with 3 answers (A, B, C). Before EVERY question, fetch real data with a tool (e.g. random_set, then ask about year, piece count, theme or minifigures) so the answer is guaranteed correct. Vary the questions, not just set numbers.
- Never reveal the answer in the question. While a question is open, set quiz_question_open = true.
- After each answer: say if it was right, explain briefly, give the score (e.g. "Punkte: 2 von 3" / "Score: 2 of 3") and ask the next question.
- After 5 questions: final result with a funny compliment.

MEMORY: If the user refers to something from the conversation ("that set", "which one"), use the history. Earlier answers list the set numbers they showed as [Sets: ...] – use exactly those numbers. Models you designed are listed as [Build: ...] with the exact pieces they use – answer questions about them from that note.

FORMAT: In "reply" plain text, important words in **bold**, short lists with "- ". No HTML, no tables, no headings, no images, no lines like "Image:" and never write "here is a picture" – the cards show images automatically.
In "show_sets" the set numbers of the sets you specifically present in the answer (max 6) – they are shown as cards with image, number, year and piece count. Otherwise an empty list.
When cards are shown, do NOT repeat their data as a long list. Instead write 1–3 casual sentences (what's special, the difference, your recommendation).

If the topic is not LEGO, say briefly and kindly that you can only help with LEGO.`

const ResponseSchema = z.object({
  reply: z.string().describe("Die Antwort an den Nutzer"),
  show_sets: z
    .array(z.string())
    .describe("Setnummern (z.B. '75192-1'), die als Karten angezeigt werden sollen, max. 6, sonst leer"),
  quiz_question_open: z
    .boolean()
    .describe("true, wenn deine Antwort eine Quizfrage stellt, die der Nutzer noch beantworten muss")
})

const agent = createAgent({
  model: new ChatOpenAI({
    model: MODEL_NAME,
    temperature: 0.4,
    maxTokens: 1000,
    apiKey: process.env.OPENAI_API_KEY
  }),
  tools,
  systemPrompt: SYSTEM_PROMPT,
  responseFormat: ResponseSchema
})

// ─────────────────────────────────────────────
// 🧠 Gedächtnis: pro Chat-Sitzung die letzten Nachrichten
// ─────────────────────────────────────────────
const MAX_HISTORY = 24
const sessions = new LRU({ max: 1000, maxAge: 2 * 60 * 60 * 1000 }) // 2 Stunden

function messageText(msg) {
  if (typeof msg.content === "string") return msg.content
  return msg.text ?? ""
}

// Alle Sets aus den Tool-Ergebnissen dieser Antwort einsammeln
function collectSets(newMessages) {
  const found = new Map()
  const walk = v => {
    if (Array.isArray(v)) return v.forEach(walk)
    if (v && typeof v === "object") {
      if (v.set_num && v.name && !v.error) found.set(v.set_num, v)
      Object.values(v).forEach(walk)
    }
  }
  for (const m of newMessages) {
    if (m.type !== "tool" && m._getType?.() !== "tool") continue
    try {
      walk(JSON.parse(messageText(m)))
    } catch {}
  }
  return found
}

// Zuletzt erfundenes Modell dieser Antwort (Bild + Anleitung fürs Frontend)
function findBuild(newMessages) {
  let found = null
  for (const m of newMessages) {
    if (m.type !== "tool" && m._getType?.() !== "tool") continue
    try {
      const id = JSON.parse(messageText(m)).build_id
      if (id && builds.get(id)) found = builds.get(id)
    } catch {}
  }
  return found
}

async function buildCards(showSets, seen, replyText) {
  const cards = []
  const reply = String(replyText).toLowerCase()
  for (const raw of (showSets || []).slice(0, 6)) {
    const num = normalizeSetNum(raw)
    let s = seen.get(num)
    if (!s) {
      // Nicht in dieser Antwort nachgeschlagen → nur zeigen, wenn der Name auch im Text steht
      // (schützt vor ausgedachten Setnummern)
      try {
        s = await fetchSet(num)
      } catch {}
      const shortName = s?.name.toLowerCase().split(/[(\-–]/)[0].trim()
      if (s && shortName && !reply.includes(shortName) && !reply.includes(num.replace(/-1$/, ""))) s = null
    }
    if (s && !cards.some(c => c.set_num === s.set_num)) {
      cards.push({
        set_num: s.set_num,
        name: s.name,
        year: s.year,
        num_parts: s.num_parts,
        theme: s.theme || null,
        minifig_count: s.minifig_count ?? null,
        image_url: s.image_url || null
      })
    }
  }
  return cards
}

// 🧼 Text → sicheres HTML (ohne Links, **fett** erlaubt)
function textToSafeHtml(s) {
  return String(s)
    .replace(/\[(Sets|Reply in|Build)[^\]]*\]/g, "") // interne Notizen nie anzeigen
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // Markdown-Bilder entfernen
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // Markdown-Links → nur Text
    .replace(/https?:\/\/[^\s)]+/g, "")
    .replace(/^#{1,6}\s+(.+)$/gm, "**$1**") // Überschriften → fett
    .replace(/\*\*\*\*(.+?)\*\*\*\*/g, "**$1**")
    .replace(/^\s*[-*]\s*$/gm, "") // leere Listenpunkte entfernen
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n") // keine riesigen Lücken
    .trim()
    .replace(/\n/g, "<br>")
}

// 🌍 Einfache Spracherkennung (Deutsch/Englisch), damit die KI sicher richtig antwortet
const EN_WORDS = new Set("the a an is are was what which who show me some how many much do does can could you your from with of and have has one most please tell about my i it this that there any for".split(" "))
const DE_WORDS = new Set("der die das ist sind war was welche welcher welches wer zeig zeige mir ein eine einen wie viele hat haben gibt es und mit von aus ich du mein meine bitte über kann noch auch nicht".split(" "))
function detectLanguage(text) {
  const words = text.toLowerCase().match(/[a-zäöüß]+/g) || []
  let en = 0
  let de = 0
  for (const w of words) {
    if (EN_WORDS.has(w)) en++
    if (DE_WORDS.has(w)) de++
  }
  if (/[äöüß]/i.test(text)) de += 2
  if (en >= 2 && en > de) return "English"
  if (de >= 2 && de > en) return "German"
  return null // zu kurz (z.B. Quiz-Antwort "B") → Sprache aus dem Gespräch
}

// Nachrichten, bei denen der Nutzer echte Sets/Bilder sehen will (oder einem Angebot zustimmt)
const WANTS_SETS =
  /\b(zeig\w*|bild\w*|foto\w*|sets?|empfehl\w*|welche[snrm]?|such\w*|finde?\w*|gibt es|ja|gerne?|klar|ok(ay)?|show|pictures?|images?|photos?|recommend\w*|which|find|search|yes|sure)\b/i
const FORCE_TOOLS_NOTE =
  "\n\n[You did not fetch any data. Call the right tool now (e.g. search_sets, find_animal_figure, get_set_details) and present only real sets from the results in show_sets. Do not ask back.]"

const IMAGE_RE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/

// 💬 Chat API
app.post("/chat", requireAppKey, async (req, res) => {
  try {
    let text = String(req.body.message || "").trim().slice(0, 2000)
    const image = typeof req.body.image === "string" ? req.body.image : null

    if (image && (!IMAGE_RE.test(image) || image.length > 7_000_000)) {
      return res.status(400).json({ error: "Ungültiges Bild" })
    }
    if (!text && !image) return res.status(400).json({ error: "Keine Nachricht" })
    if (!text) text = "Was ist auf diesem Foto?"

    const sessionId = String(req.body.sessionId || "").slice(0, 100)
    const history = (sessionId && sessions.get(sessionId)) || []

    // Mit Foto: Text + Bild an die KI schicken
    // Sprach-Erinnerung nur für die KI (wird nicht gespeichert)
    const lang = detectLanguage(text)
    const modelText = lang
      ? `${text}\n\n[Reply in ${lang}.]`
      : `${text}\n\n[Reply in the same language as the conversation.]`
    const userMessage = image
      ? {
          role: "user",
          content: [
            { type: "text", text: modelText },
            { type: "image_url", image_url: { url: image } }
          ]
        }
      : { role: "user", content: modelText }

    let input = [...history, userMessage]
    let result = await agent.invoke({ messages: input }, { recursionLimit: 24 })

    // 🛟 Sicherheitsnetz: Nutzer will Sets/Bilder sehen, aber die KI hat nichts nachgeschlagen
    // → einmal neu versuchen, diesmal mit der Pflicht, echte Daten zu holen
    const usedTools = result.messages.slice(input.length).some(m => m.type === "tool" || m._getType?.() === "tool")
    if (!usedTools && !result.structuredResponse?.quiz_question_open && WANTS_SETS.test(text)) {
      console.log("🛟 Keine Daten geholt – zweiter Versuch mit Tool-Pflicht")
      const forced = {
        ...userMessage,
        content: Array.isArray(userMessage.content)
          ? userMessage.content.map(c => (c.type === "text" ? { ...c, text: c.text + FORCE_TOOLS_NOTE } : c))
          : userMessage.content + FORCE_TOOLS_NOTE
      }
      input = [...history, forced]
      result = await agent.invoke({ messages: input }, { recursionLimit: 24 })
    }

    const structured = result.structuredResponse
    const rawReply =
      (structured?.reply || messageText(result.messages.at(-1))).trim() ||
      "Ich helfe dir gerne bei LEGO Fragen!"

    const seen = collectSets(result.messages.slice(input.length))
    const build = findBuild(result.messages.slice(input.length))
    // Bei offener Quizfrage keine Karten – die würden die Lösung verraten
    const cards = structured?.quiz_question_open
      ? []
      : await buildCards(structured?.show_sets, seen, rawReply)

    // Im Gedächtnis nur Text speichern (Fotos sind zu groß), plus die gezeigten Setnummern
    if (sessionId) {
      const known = [...cards, ...seen.values()]
      const unique = [...new Map(known.map(s => [s.set_num, s])).values()].slice(0, 12)
      const setNote = unique.length
        ? `\n[Sets: ${unique
            .map(s => `${s.set_num} ${s.name} (${s.year ?? "?"}, ${s.num_parts ?? "?"} pieces)`)
            .join("; ")}]`
        : ""
      sessions.set(
        sessionId,
        [
          ...history,
          { role: "user", content: image ? `${text} [Nutzer hat ein Foto geschickt]` : text },
          {
            role: "assistant",
            content:
              rawReply +
              setNote +
              (build
                ? `\n[Build: ${build.name} – uses ${build.total} pieces: ${build.parts_list}. ${build.steps.length} steps: ${build.steps
                    .map((s, i) => `${i + 1}) ${s.text}`)
                    .join(" ")}]`
                : "")
          }
        ].slice(-MAX_HISTORY)
      )
    }

    res.json({ reply: textToSafeHtml(rawReply), cards: build ? [] : cards, build })
  } catch (err) {
    console.error("Chat-Fehler:", err)
    res.status(500).json({ error: "Da ist etwas schiefgelaufen. Versuch es nochmal!" })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`🚀 LEGO Chat läuft auf http://localhost:${PORT}`))
