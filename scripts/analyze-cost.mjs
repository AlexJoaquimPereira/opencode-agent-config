#!/usr/bin/env node
// analyze-cost — cost accounting + success-adjusted economics for the harness.
//
// Reads append-only telemetry from a .telemetry/ directory and the pricing
// assumptions in config/model-pricing.json, then computes per-attempt and
// per-task costs and the success-adjusted tables in docs/COST-METRICS.md.
//
// Usage:
//   node scripts/analyze-cost.mjs [--telemetry DIR] [--direct-deepseek] [--json]
//
//   --telemetry DIR     telemetry dir (default <cwd>/.telemetry)
//   --direct-deepseek   price DeepSeek attempts at first-party direct prices
//                       instead of OpenRouter list prices
//   --json              emit one JSON document instead of the text tables
//
// Prices are ASSUMPTIONS FOR ACCOUNTING ONLY. They are never routing input.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, "..")

function loadJson(p) {
  return JSON.parse(readFileSync(p, "utf8"))
}
const pricing = loadJson(join(ROOT, "config", "model-pricing.json"))

const FAMILY = {
  v4: { modelPrefix: "deepseek", name: "V4" },
  glm: { modelPrefix: "glm", name: "GLM" },
  luna: { modelPrefix: "gpt-5.6", name: "LUNA" },
}
function familyOf(modelID = "") {
  const m = modelID.toLowerCase()
  if (m.includes("glm")) return "GLM"
  if (m.includes("deepseek")) return "V4"
  if (m.includes("luna") || m.includes("gpt-5.6")) return "LUNA"
  return null
}
function entryOf(family) {
  if (family === "V4") return pricing.models["deepseek-v4"]
  if (family === "GLM") return pricing.models["glm-5.3"]
  if (family === "LUNA") return pricing.models["luna-5.6"]
  return null
}

function parseArgs(argv) {
  const a = { telemetry: null, direct: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--telemetry") a.telemetry = argv[++i]
    else if (argv[i] === "--direct-deepseek") a.direct = true
    else if (argv[i] === "--json") a.json = true
  }
  return a
}

function readJsonl(dir, file) {
  const p = join(dir, file)
  try {
    const raw = readFileSync(p, "utf8")
    return raw
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

function readAttempts(dir) {
  // attempts.jsonl (primary) but also tolerate a flat file of attempt rows.
  return readJsonl(dir, "attempts.jsonl")
}
function readTasks(dir) {
  return readJsonl(dir, "tasks.jsonl")
}

// Effective per-1M prices for an attempt, in USD per 1M tokens.
function pricesFor(att, opts) {
  const fam = familyOf(att.model)
  const e = entryOf(fam)
  if (!e) return null
  const provider = String(att.provider || "").toLowerCase()
  const onOpenRouter = provider.includes("openrouter") || !opts.direct
  let p
  if (fam === "V4" && opts.direct && !onOpenRouter) {
    // direct DeepSeek batch path: priced at first-party rates.
    // Window assumed off-peak by default (the batch launcher only runs off-peak);
    // pass through the exact window if the attempt records it.
    const peak = att.off_peak === false
    const tier = peak ? e.deepseek_direct.peak : e.deepseek_direct.off_peak
    p = { input: tier.input, cache_read: tier.cache_hit_input, cache_write: tier.input, output: tier.output, openrouter: false }
  } else {
    const r = e.openrouter
    const tier = fam === "LUNA" ? r["<=272k"] : r
    // When OpenRouter lists no separate cache_write price, cache writes are
    // billed at the (uncached) input rate.
    const cacheWrite = tier.cache_write ?? tier.input
    p = {
      input: tier.input,
      cache_read: tier.cache_read ?? 0,
      cache_write: cacheWrite,
      output: tier.output,
      openrouter: true,
      web_search: tier.web_search ?? 0,
    }
    if (fam === "LUNA" && att.web_search_calls) {
      p.web_search_calls = att.web_search_calls
    }
  }
  p.family = fam
  return p
}

function costAttempt(att, p) {
  const input = att.input_tokens ?? 0
  const cached = att.cached_input_tokens ?? 0
  const uncached = Math.max(0, input - cached)
  const cacheWrite = att.cache_write_tokens ?? 0
  const output = att.output_tokens ?? 0
  const M = 1e6
  const input_cost = (uncached * p.input) / M
  const cache_read_cost = (cached * (p.cache_read ?? p.input)) / M
  const cache_write_cost = (cacheWrite * p.cache_write) / M
  const output_cost = (output * p.output) / M
  const webCalls = att.web_search_calls ?? 0
  const web_search_cost = webCalls ? (webCalls * (p.web_search ?? 0)) / 1000 : 0
  const sub = input_cost + cache_read_cost + cache_write_cost + output_cost + web_search_cost
  const credit_fee = p.openrouter ? sub * (pricing.credit_multiplier.openrouter - 1) : 0
  const total = sub + credit_fee
  return { input_cost, cache_read_cost, cache_write_cost, output_cost, web_search_cost, credit_fee, total_attempt_cost: total }
}

function routeLabel(attempts) {
  // Family sequence in attempt order => e.g. V4, V4->GLM, V4->GLM->LUNA
  const seen = []
  for (const a of attempts) {
    const f = familyOf(a.model)
    if (f && seen[seen.length - 1] !== f) seen.push(f)
  }
  return seen.join("->")
}

// Total tokens consumed by an attempt. Prefer the runtime-reported total;
// otherwise derive from the token fields actually recorded (input may include
// cached tokens; reasoning may be billed inside output but is kept distinct).
function attemptTokens(a) {
  if (a.total_tokens != null) return a.total_tokens
  const i = a.input_tokens ?? 0
  const o = a.output_tokens ?? 0
  const r = a.reasoning_tokens ?? 0
  if (i + o + r > 0) return i + o + r
  return 0
}

function median(xs) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
function mean(xs) {
  if (!xs.length) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function groupBy(rows, fn) {
  const g = new Map()
  for (const r of rows) {
    const k = fn(r)
    if (k == null) continue
    if (!g.has(k)) g.set(k, [])
    g.get(k).push(r)
  }
  return g
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const telemetryDir = opts.telemetry || join(process.cwd(), ".telemetry")
  const attempts = readAttempts(telemetryDir)
  const tasks = readTasks(telemetryDir)
  if (!attempts.length && !tasks.length) {
    console.error(`No telemetry found in ${telemetryDir}`)
    process.exit(1)
  }

  const withCost = attempts.map((a) => {
    const p = pricesFor(a, opts)
    return { ...a, _cost: p ? costAttempt(a, p) : null, _family: p?.family ?? familyOf(a.model), _prices: p }
  })

  // Task grouping: attempts carry task_id. Build per-task rows.
  const byTask = groupBy(withCost, (a) => a.task_id ?? null)
  const taskRows = []
  for (const [task_id, atts] of byTask) {
    const cost = atts.reduce((s, a) => s + (a._cost?.total_attempt_cost ?? 0), 0)
    const success = atts.some((a) => a.success === true)
    const humanIntervention = atts.some((a) => a.human_intervention === true)
    const totalTokens = atts.reduce((s, a) => s + attemptTokens(a), 0)
    const route = routeLabel(atts)
    const t = tasks.find((x) => x.task_id === task_id)
    const modelSeq = atts.map((a) => a._family).filter(Boolean)
    // Distinct family transitions (consecutive dedup), matching routeLabel: a
    // single-family task has 0 escalations regardless of attempt count.
    const famTransitions = modelSeq.filter((f, idx) => idx === 0 || f !== modelSeq[idx - 1])
    const outputTotal = atts.reduce((s, a) => s + (a.output_tokens ?? 0), 0)
    const turns = atts.reduce((s, a) => s + (a.turn_count ?? 0), 0)
    const toolCalls = atts.reduce((s, a) => s + (a.tool_call_count ?? 0), 0)
    taskRows.push({
      task_id,
      title: t?.title ?? null,
      route,
      initial_model: famTransitions[0] ?? null,
      final_model: famTransitions[famTransitions.length - 1] ?? null,
      escalation_count: Math.max(0, famTransitions.length - 1),
      attempts: atts.length,
      cost,
      success,
      human_intervention: humanIntervention,
      total_tokens: totalTokens,
      output_total: outputTotal,
      turns,
      tool_calls: toolCalls,
    })
  }

  const summary = {
    pricing_as_of: pricing.as_of,
    tasks: taskRows.length,
    attempts: withCost.length,
    success_rate: taskRows.length ? taskRows.filter((t) => t.success).length / taskRows.length : null,
    escalation_rate: taskRows.length ? taskRows.filter((t) => (t.escalation_count ?? 0) > 0).length / taskRows.length : null,
    human_intervention_rate: taskRows.length
      ? taskRows.filter((t) => t.human_intervention).length / taskRows.length
      : null,
  }

  // Per-family aggregate across attempts. cost/tokens-per-success are credited
  // to successful TASKS ending in the family (the family's own attempts within
  // those tasks), not to individual successful model calls.
  const successTasksByFinal = groupBy(taskRows.filter((t) => t.success), (t) => t.final_model)
  const famRows = []
  for (const [fam, atts] of groupBy(withCost, (a) => a._family)) {
    const succTasks = (successTasksByFinal.get(fam) || []).map((t) => t.task_id)
    const taskCost = atts.filter((a) => succTasks.includes(a.task_id)).reduce((s, a) => s + (a._cost?.total_attempt_cost ?? 0), 0)
    const taskTokens = atts.filter((a) => succTasks.includes(a.task_id)).reduce((s, a) => s + attemptTokens(a), 0)
    famRows.push({
      group: fam,
      attempts: atts.length,
      cost: atts.reduce((s, a) => s + (a._cost?.total_attempt_cost ?? 0), 0),
      cost_per_attempt: mean(atts.map((a) => a._cost?.total_attempt_cost ?? 0)),
      cost_per_success: succTasks.length ? taskCost / succTasks.length : null,
      tokens: atts.reduce((s, a) => s + attemptTokens(a), 0),
      tokens_per_attempt: mean(atts.map((a) => attemptTokens(a))),
      tokens_per_success: succTasks.length ? taskTokens / succTasks.length : null,
    })
  }

  // Route-level economics (observed, historical — no prediction model).
  const routeRows = []
  for (const [route, trs] of groupBy(taskRows, (t) => t.route ?? "unknown")) {
    const success = trs.filter((t) => t.success)
    routeRows.push({
      route,
      tasks: trs.length,
      success: success.length,
      median_total_tokens: median(trs.map((t) => t.total_tokens)),
      median_output_tokens: median(trs.map((t) => t.output_total || 0)),
      median_turns: median(trs.map((t) => t.turns)),
      median_cost: median(trs.map((t) => t.cost)),
      median_cost_success: median(success.map((t) => t.cost)) ?? null,
      human_intervention_rate: trs.length ? trs.filter((t) => t.human_intervention).length / trs.length : null,
    })
  }

  if (opts.json) {
    console.log(JSON.stringify({ summary, by_model: famRows, by_route: routeRows, tasks: taskRows }, null, 2))
    return
  }

  const line = (label, v) => console.log(`  ${label.padEnd(26)} ${v}`)
  console.log(`\nCost accounting  (pricing as_of ${pricing.as_of})`)
  console.log(`Telemetry: ${telemetryDir}`)
  console.log("=".repeat(70))
  line("tasks", summary.tasks)
  line("attempts", summary.attempts)
  line("success_rate", summary.success_rate == null ? "n/a" : summary.success_rate.toFixed(3))
  line("escalation_rate", summary.escalation_rate == null ? "n/a" : summary.escalation_rate.toFixed(3))
  line("human_intervention_rate", summary.human_intervention_rate == null ? "n/a" : summary.human_intervention_rate.toFixed(3))

  console.log("\nBy model family (attempts):")
  console.log("  family     attempts    cost($)    cost/success($)  tokens/success")
  for (const r of famRows) {
    console.log(
      `  ${String(r.group).padEnd(10)} ${String(r.attempts).padEnd(10)} ${(r.cost ?? 0).toFixed(4).padStart(9)} ${(r.cost_per_success ?? 0).toFixed(4).padStart(14)} ${(r.tokens_per_success ?? 0).toFixed(0).padStart(14)}`
    )
  }

  console.log("\nRoute economics (observed per task):")
  console.log("  route          tasks  succ  med_tokens  med_out  med_cost  med_cost/succ  human_int")
  for (const r of routeRows) {
    console.log(
      `  ${String(r.route).padEnd(13)} ${String(r.tasks).padEnd(5)} ${String(r.success).padEnd(4)} ${String(r.median_total_tokens ?? "n/a").padStart(10)} ${String(r.median_output_tokens ?? "n/a").padStart(8)} ${(r.median_cost ?? 0).toFixed(4).padStart(9)} ${(r.median_cost_success ?? 0).toFixed(4).padStart(12)} ${r.human_intervention_rate == null ? "n/a" : r.human_intervention_rate.toFixed(2)}`
    )
  }

  // Explicitly compare the canonical routes if present.
  const want = ["V4", "GLM", "LUNA", "V4->GLM", "V4->LUNA", "V4->GLM->LUNA"]
  console.log("\nCanonical route comparison (cost / successful task):")
  for (const w of want) {
    const r = routeRows.find((x) => x.route === w)
    if (!r) {
      console.log(`  ${w.padEnd(14)} no data yet`)
      continue
    }
    const perSuccess = r.success ? r.median_cost_success : null
    console.log(`  ${w.padEnd(14)} tasks=${r.tasks}  success=${r.success}  median_cost/success=${perSuccess == null ? "n/a" : perSuccess.toFixed(4)}`)
  }
  console.log("")
}

main()
