#!/usr/bin/env node
// benchmarks/run.mjs — run real coding tasks through opencode routes.
//
// Usage:
//   node benchmarks/run.mjs --task <id> --route <id>       one cell
//   node benchmarks/run.mjs --all                          full matrix
//   node benchmarks/run.mjs --all --limit-routes v4,glm    subset
//   node benchmarks/run.mjs --task simple-bug --route v4 --agent-model x
//
// Each run:
//   1. creates a scratch repo from the task fixture,
//   2. invokes `opencode run --agent <agent> --auto "<prompt>"` (forced ladder for
//      multi-agent routes, attempting each agent in order until one validates),
//   3. runs the task's validation command,
//   4. classifies PASS / FAIL / BLOCKED / PASS_WITH_HUMAN_INTERVENTION,
//   5. appends a JSONL cell record to benchmarks/results/<ts>-<task>-<route>.jsonl.
import { spawn, spawnSync } from "node:child_process"
import { readdirSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, "..")
const OPENCODE = process.env.OPENCODE_BIN || join(ROOT, "bin", "opencode")
const SCRATCH_ROOT = process.env.BENCH_SCRATCH || join(tmpdir(), "opencode-bench")
const RESULTS_DIR = join(here, "results")
const routesCfg = JSON.parse(readFileSync(join(here, "scenarios", "routes.json"), "utf8")).routes

function loadTasks() {
  const tasks = []
  for (const f of readdirSync(join(here, "tasks")).filter((x) => x.endsWith(".json"))) {
    tasks.push(JSON.parse(readFileSync(join(here, "tasks", f), "utf8")))
  }
  return tasks
}

function parseArgs(argv) {
  const a = { all: false, task: null, route: null, limitRoutes: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--all") a.all = true
    else if (argv[i] === "--task") a.task = argv[++i]
    else if (argv[i] === "--route") a.route = argv[++i]
    else if (argv[i] === "--limit-routes") a.limitRoutes = argv[++i]
  }
  return a
}

function classifyFromCode(code) {
  if (code === 0) return "PASS"
  return "FAIL"
}

function runAgent(cwd, agent, prompt, agentModel) {
  const modelFlag = agentModel ? ["-m", agentModel] : []
  const r = spawnSync(OPENCODE, ["run", "--agent", agent, ...modelFlag, "--auto", prompt], {
    cwd,
    encoding: "utf8",
    timeout: 1000 * 60 * 20,
    env: { ...process.env, NO_COLOR: "1" },
  })
  return r
}

function validate(cwd, validateCmd) {
  const r = spawnSync(validateCmd[0], validateCmd.slice(1), { cwd, encoding: "utf8", timeout: 1000 * 60 * 2 })
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" }
}

function writeResult(record) {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const f = join(RESULTS_DIR, `${ts}-${record.task}-${record.route}.jsonl`)
  writeFileSync(f, JSON.stringify(record) + "\n", "utf8")
  return f
}

function runCell(task, routeId, route) {
  const scratch = mkdtempSync(join(SCRATCH_ROOT, `${task.id}-${routeId}-`))
  for (const [p, content] of Object.entries(task.files || {})) {
    const full = join(scratch, p)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content, "utf8")
  }

  const attemptLog = []
  const t0 = Date.now()
  let status = "FAIL"
  let lastValidation = null
  let agentUsed = null
  let humanIntervention = false
  let stdout = ""
  let failureReason = null

  try {
    if (route.router) {
      const r = runAgent(scratch, route.agent, task.prompt)
      stdout = r.stdout || ""
      const err = r.stderr || ""
      if (r.error && String(r.error).includes("ETIMEDOUT")) {
        status = "BLOCKED"
        failureReason = "agent timeout"
      } else if (r.status != null && r.status !== 0 && !/BLOCKED/.test(stdout)) {
        status = "FAIL"
        failureReason = "router run non-zero"
      } else {
        agentUsed = route.agent
        lastValidation = validate(scratch, task.validate)
        if (lastValidation.code === 0) status = "PASS"
        else { status = "FAIL"; failureReason = (lastValidation.stderr || "").slice(0, 500) }
      }
      if (/permission|intervention|y[es]?\/n/i.test(err) && status !== "PASS") humanIntervention = true
    } else {
      // Forced escalation ladder: try each agent until validation passes.
      for (const agent of route.agents) {
        attemptLog.push(agent)
        agentUsed = agent
        const r = runAgent(scratch, agent, task.prompt)
        stdout = r.stdout || ""
        const err = r.stderr || ""
        if (r.error && String(r.error).includes("ETIMEDOUT")) {
          status = "BLOCKED"
          failureReason = "agent timeout"
          break
        }
        if (/permission|Please review|intervention/i.test(err)) humanIntervention = true
        // Objective validation gate: does the repo now pass?
        lastValidation = validate(scratch, task.validate)
        if (lastValidation.code === 0) {
          status = humanIntervention ? "PASS_WITH_HUMAN_INTERVENTION" : "PASS"
          break
        }
        status = "FAIL"
        failureReason = (lastValidation.stderr || "").slice(0, 500)
      }
    }
  } catch (e) {
    status = "BLOCKED"
    failureReason = String(e && e.message || e).slice(0, 500)
  } finally {
    const durationMs = Date.now() - t0
    const record = {
      schema: "opencode-bench/cell/v1",
      ts: new Date().toISOString(),
      task: task.id,
      category: task.category,
      task_class: task.class,
      route: routeId,
      route_label: route.label,
      agents: attemptLog.length ? attemptLog : route.router ? [route.agent] : null,
      status,
      human_intervention: humanIntervention,
      validation: lastValidation ? { code: lastValidation.code, stderr: (lastValidation.stderr || "").slice(0, 300) } : null,
      failure_reason: failureReason,
      wall_time_ms: durationMs,
      scratch: scratch,
      stdout_tail: stdout.slice(-2000),
    }
    writeResult(record)
    console.log(`[bench] task=${task.id} route=${routeId} status=${status} wall_ms=${durationMs} -> ${record.scratch}`)
  }
  if (existsSync(scratch)) rmSync(scratch, { recursive: true, force: true })
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  const tasks = loadTasks()
  const taskList = a.task ? tasks.filter((t) => t.id === a.task) : tasks
  const allowedRoutes = a.limitRoutes ? a.limitRoutes.split(",") : null
  const routeList = Object.entries(routesCfg).filter(([id]) => !allowedRoutes || allowedRoutes.includes(id))
  if (!taskList.length) {
    console.error(`no task matched: ${a.task}`)
    process.exit(1)
  }
  mkdirSync(SCRATCH_ROOT, { recursive: true })
  for (const task of taskList) {
    for (const [routeId, route] of routeList) {
      runCell(task, routeId, route)
    }
  }
}

main()
