#!/usr/bin/env node
// benchmarks/analyze.mjs — aggregate benchmarks/results/*.jsonl into the
// route-economics table from docs/COST-METRICS.md.
//
// Usage:
//   node benchmarks/analyze.mjs [--json]
import { readdirSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const RESULTS = join(here, "results")

function readCells() {
  const out = []
  for (const f of readdirSync(RESULTS).filter((x) => x.endsWith(".jsonl"))) {
    for (const line of readFileSync(join(RESULTS, f), "utf8").split("\n")) {
      if (line.trim()) out.push(JSON.parse(line))
    }
  }
  return out
}
function median(xs) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function countBy(rows, key) {
  const g = {}
  for (const r of rows) g[r[key]] = (g[r[key]] || 0) + 1
  return g
}

const args = process.argv.slice(2)
const asJson = args.includes("--json")

const cells = readCells()
if (!cells.length) {
  console.error(`no results under ${RESULTS}`)
  process.exit(1)
}

const byRoute = {}
for (const c of cells) {
  ;(byRoute[c.route] = byRoute[c.route] || []).push(c)
}

const rows = []
for (const [route, rs] of Object.entries(byRoute)) {
  const pass = rs.filter((r) => r.status === "PASS")
  const passHuman = rs.filter((r) => r.status === "PASS_WITH_HUMAN_INTERVENTION")
  const success = rs.filter((r) => r.status === "PASS" || r.status === "PASS_WITH_HUMAN_INTERVENTION")
  rows.push({
    route,
    label: rs[0].route_label || route,
    tasks: rs.length,
    success: success.length,
    autonomous_success: pass.length,
    blocked: rs.filter((r) => r.status === "BLOCKED").length,
    fail: rs.filter((r) => r.status === "FAIL").length,
    human_intervention_rate: rs.length ? (passHuman.length + rs.filter((r) => r.human_intervention).length) / rs.length : 0,
    median_wall_ms: median(rs.map((r) => r.wall_time_ms)),
    success_rate: rs.length ? success.length / rs.length : 0,
  })
}

// Mark task-class coverage too.
const classCoverage = countBy(cells, "task_class")
const statuses = countBy(cells, "status")

if (asJson) {
  console.log(JSON.stringify({ by_route: rows, class_coverage: classCoverage, status_counts: statuses }, null, 2))
} else {
  console.log("\nBenchmark results")
  console.log("=".repeat(100))
  console.log("  route          tasks  succ  auto  fail  blocked  human_int  med_wall_ms  success_rate")
  for (const r of rows) {
    console.log(
      `  ${String(r.label || r.route).padEnd(13)} ${String(r.tasks).padEnd(5)} ${String(r.success).padEnd(4)} ${String(r.autonomous_success).padEnd(5)} ${String(r.fail).padEnd(5)} ${String(r.blocked).padStart(7)} ${(r.human_intervention_rate).toFixed(2).padStart(9)} ${String(r.median_wall_ms ?? "n/a").padStart(11)} ${(r.success_rate).toFixed(2).padStart(12)}`
    )
  }
  console.log("\nTask-class coverage:", JSON.stringify(classCoverage))
  console.log("Status counts:", JSON.stringify(statuses))
  console.log("")
}
