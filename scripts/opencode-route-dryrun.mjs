#!/usr/bin/env node
// opencode-route-dryrun — inspect routing policy WITHOUT spending tokens.
//
// Shows what route/orchestrator would do for a task-shaped description: task
// classification, initial model, planner requirement, possible escalation
// target, provider policy, and whether the current time permits direct DeepSeek
// batch mode. Pure local analysis: no model call, no provider call, no secrets.
//
// Usage:
//   node scripts/opencode-route-dryrun.mjs "add a function to src/x.js"
//   node scripts/opencode-route-dryrun.mjs --json "migrate the db schema"
//
// Classification keywords (mirrors docs/ROUTING.md heuristics):
//   architecture    -> architecture, design, migrate, refactor architecture, "how should we"
//   security        -> security, auth, injection, secret, token, ssl/tls, sandbox, permission
//   debugging       -> bug, fix, crash, failing test, regression, debug, stack trace
//   external-research -> dependency, api docs, "does library x", upstream, package version
//   complex         -> "large", "complex", "across modules", "whole repo", "implement from scratch"
//   high-risk       -> data migration, concurrency, critical, production
//   multi-file      -> multiple files, 3+ files, refactor across
//   normal          -> default fallback
import { join, dirname } from "node:path"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe } from "./lib/ist.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, "..")
const pricing = JSON.parse(readFileSync(join(ROOT, "config", "model-pricing.json"), "utf8"))

function classify(task) {
  const t = (task || "").toLowerCase()
  const hit = (words) => words.some((w) => t.includes(w))
  if (hit(["security", "auth", "injection", "secret", "token", "sandbox", "permission"])) return { cls: "security", target: "LUNA", planner: true }
  if (hit(["architecture", "design", "migrat", "how should we", "restructure"])) return { cls: "architecture", target: "LUNA", planner: true }
  if (hit(["data migration", "concurrency", "critical", "production", "subtle"])) return { cls: "high-risk", target: "LUNA", planner: true }
  if (hit(["bug", "fix", "crash", "failing test", "regression", "debug", "stack trace"])) return { cls: "debugging", target: "GLM", planner: false }
  if (hit(["dependency", "api docs", "does library", "upstream", "package version", "does node"])) return { cls: "external-research", target: "V4 (research) then tier", planner: false }
  if (hit(["large", "complex", "across modules", "whole repo", "implement", "tokenizer", "lru", "parser"])) return { cls: "complex", target: "GLM", planner: true }
  if (hit(["multiple files", "refactor across"])) return { cls: "multi-file", target: "V4", planner: false }
  return { cls: "normal", target: "V4", planner: false }
}

function providerPolicy() {
  return {
    openrouter: {
      // Static OpenRouter config drives provider selection (see opencode.json):
      // DeepSeek + GLM: sort=price, allow_fallbacks=false
      // Luna: only=[openai/flex,azure,openai], allow_fallbacks=false
      deepseek: { sort: "price", allow_fallbacks: false },
      glm: { sort: "price", allow_fallbacks: false },
      luna: { only: ["openai/flex", "azure", "openai"], allow_fallbacks: false },
    },
    router_layer: "route/orchestrator chooses MODEL (V4|GLM|LUNA) only",
    session_stability: "provider fixed for the session; no mid-session switch; no failover retry across providers",
    credit_multiplier: pricing.credit_multiplier.openrouter,
  }
}

function main() {
  const argv = process.argv.slice(2)
  const asJson = argv.includes("--json")
  const task = argv.filter((x) => x !== "--json").join(" ")
  const c = classify(task)
  const state = describe(new Date())
  const policy = providerPolicy()

  if (asJson) {
    console.log(JSON.stringify({ task, classification: c, provider: policy, batch: state, dry_run: true, secrets: "none" }, null, 2))
    return
  }
  console.log("\nroute/orchestrator — dry run (no tokens spent)")
  console.log("=".repeat(64))
  console.log(`  task               : ${task || "(empty)"}`)
  console.log(`  classification     : ${c.cls}`)
  console.log(`  initial model      : ${c.target.split(" ")[0]}`)
  console.log(`  planner required   : ${c.planner}`)
  console.log(`  escalation target  : ${c.target}`)
  console.log(`  provider policy    : OpenRouter static (see opencode.json)`)
  console.log(`    deepseek         : ${JSON.stringify(policy.openrouter.deepseek)}`)
  console.log(`    glm              : ${JSON.stringify(policy.openrouter.glm)}`)
  console.log(`    luna             : ${JSON.stringify(policy.openrouter.luna)}`)
  console.log(`    credit multiplier: ${policy.credit_multiplier}`)
  console.log(`  direct-deepseek    : ${state.ist} — ${state.window}`)
  console.log("=".repeat(64))
}

main()
