# Benchmark Harness

Operates on **real coding tasks** (tiny fixture repositories), not synthetic token
generation. The harness runs a task under one or more *routes* (single-model agents
and/or `route/orchestrator`), validates the outcome **objectively**, and records
token/cost/result telemetry for `analyze`.

## Directory layout

```
benchmarks/
  tasks/        one JSON file per coding task (fixture + prompt + validation)
  scenarios/    route definitions (which agents a route invokes)
  results/      append-only JSONL run records  (git-ignored)
  run.mjs       run tasks × routes through `opencode run`
  analyze.mjs   aggregate results into the route-economics table
```

## Routes

A route is an ordered list of `opencode` agents that are attempted in sequence until
one succeeds (forced escalation ladder), plus an optional `router` entry that instead
delegates adaptation to `route/orchestrator`.

| Route | Meaning |
|---|---|
| `v4` | `v4/build` only (V4-only workflow) |
| `glm` | `glm/build` only (GLM-only workflow) |
| `luna` | `luna/build` only (Luna-only workflow) |
| `v4-glm` | `v4/build`; on FAIL → `glm/build` |
| `v4-luna` | `v4/build`; on FAIL → `luna/build` |
| `v4-glm-luna` | `v4/build`; on FAIL → `glm/build`; on FAIL → `luna/build` |
| `router` | `route/orchestrator` (adaptive) |

Forced ladders are the honest way to benchmark a path such as V4→GLM→Luna: each model
gets its own fresh session on the current repo state, mirroring the escalation contract's
fresh-session handoff. `router` exercises the real adaptive router.

## Objective validation

`run.mjs` classifies each run as:

- `PASS` — validation command exits 0 (tests/build/lint/expected-behavior check).
- `FAIL` — the agents finished but validation still failed.
- `BLOCKED` — the run could not complete (upstream error, timeout, human interruption).
- `PASS_WITH_HUMAN_INTERVENTION` — validated but required a human approval/intervention.

Human intervention never counts as an ordinary autonomous success in `analyze.mjs`.

## Usage

```bash
node benchmarks/run.mjs --task simple-bug --route v4        # one cell
node benchmarks/run.mjs --all                                # full matrix (expensive)
node benchmarks/run.mjs --all --limit-routes v4,glm          # subset of routes
node benchmarks/analyze.mjs                                  # aggregate results/
```

Run records land in `benchmarks/results/<run-id>.jsonl` (append-only). Telemetry for
each run is also captured under the scratch repo's `.telemetry/` when the
`opencode-telemetry` plugin is active.
