#!/usr/bin/env node
// opencode-direct-deepseek — explicit batch/off-peak execution path on the
// DeepSeek FIRST-PARTY direct provider.
//
// This is a SEPARATE path from interactive routing:
//   - interactive route/orchestrator stays clock-agnostic and provider-stable
//   - this launcher is ONLY for explicit batch/background work: long repo-wide
//     refactors, bulk test generation, mechanical migrations, repetitive code
//     transformations, background maintenance.
//
// It does NOT change v4/build into a different agent. It changes the runtime
// path around the same agent by selecting the direct DeepSeek provider and by
// refusing to run during DeepSeek's IST weekday peak windows unless overridden.
//
// Usage:
//   node scripts/opencode-direct-deepseek.mjs "refactor task prompt"
//   node scripts/opencode-direct-deepseek.mjs --agent v4/build "prompt"
//   node scripts/opencode-direct-deepseek.mjs --override "run anyway in peak"
//   node scripts/opencode-direct-deepseek.mjs --check   # print policy only
//
// Env:
//   OPENCODE_BIN     path to opencode (default: repo bin/opencode)
//   DIRECT_MODEL     model id (default: deepseek/deepseek-v4-flash-0731)
//   CLOCK_NOW_MS     fake "now" in epoch ms for testing (overrides real clock)
import { spawnSync } from "node:child_process"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { describe } from "./lib/ist.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, "..")
const OPENCODE = process.env.OPENCODE_BIN || join(ROOT, "bin", "opencode")
const DIRECT_MODEL = process.env.DIRECT_MODEL || "deepseek/deepseek-v4-flash-0731"

function parseArgs(argv) {
  const a = { agent: "v4/build", override: false, check: false, prompt: null }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--agent") a.agent = argv[++i]
    else if (argv[i] === "--override") a.override = true
    else if (argv[i] === "--check") a.check = true
    else rest.push(argv[i])
  }
  a.prompt = rest.join(" ")
  return a
}

function nowMs() {
  const fake = process.env.CLOCK_NOW_MS
  return fake ? Number(fake) : Date.now()
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  const state = describe(new Date(nowMs()))

  console.log(`[direct-deepseek] agent=${a.agent} model=${DIRECT_MODEL}`)
  console.log(`[direct-deepseek] now: ${state.ist} | ${state.window}`)

  if (a.check) {
    console.log(
      JSON.stringify(
        { ...state, agent: a.agent, model: DIRECT_MODEL, batch_allowed: !state.peak || a.override },
        null,
        2
      )
    )
    return
  }

  if (state.peak && !a.override) {
    console.error(
      "[direct-deepseek] REFUSED: inside DeepSeek weekday peak window. " +
        "Use --override to run anyway (direct DeepSeek batch is intended for off-peak)."
    )
    process.exit(3)
  }
  if (!a.prompt) {
    console.error("[direct-deepseek] missing prompt")
    process.exit(2)
  }

  const r = spawnSync(OPENCODE, ["run", "--agent", a.agent, "-m", DIRECT_MODEL, "--auto", a.prompt], {
    stdio: "inherit",
    env: { ...process.env, NO_COLOR: "1" },
  })
  process.exit(r.status == null ? 1 : r.status)
}

main()
