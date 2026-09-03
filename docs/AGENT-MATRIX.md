# Agent Matrix

Complete reference for every agent: responsibility, model, permissions, step budget, and when it should be invoked.

## Legend

- **Mode**: `primary` = selectable directly / can spawn subagents; `subagent` = invoked by primaries or via `@mention`.
- **Model**: `Luna` = `openrouter/openai/gpt-5.6-luna`; `V4` = `openrouter/deepseek/deepseek-v4-flash-0731`; `GLM` = `openrouter/z-ai/glm-5.3-flash`.
- **Steps**: max agentic iterations before forced text-only response (harness `steps` config).
- **Web**: webfetch/websearch permission.
- **Temp**: temperature (only V4 and GLM support it; Luna omits it).

Model families in this harness: **DeepSeek V4 Flash**, **GPT-5.6 Luna**, **GLM-5.3 Flash**. Each family's agents are independently selectable and never route cross-family work themselves. Cross-model routing (a router that consumes the escalation contract) is **not implemented yet**.

## Mode A — Luna only

### `luna/build` — primary implementation engineer

| Field | Value |
|---|---|
| Mode / Model | `primary` / Luna |
| Steps / Temp | 150 / — |
| Web | `deny` (hard requirement) |
| Edits | `allow` |
| Bash | `allow`, guarded (`git push*`, `git reset --hard*`, `git clean*`, `rm -rf*` → `ask`; `sudo*` → `deny`) |
| Task (spawn) | `luna/explorer`, `luna/architect`, `luna/debugger`, `luna/tester`, `luna/reviewer`, `luna/security-review` |
| Invoke when | Any implementation in Mode A. |

Responsibility: full implementation loop — understand repo, plan locally, modify, validate against compiler/tests/runtime, inspect diff, report. Escalates per the rules in `ORCHESTRATION.md`. Never uses the web.

### `luna/explorer` — repository recon

| Field | Value |
|---|---|
| Mode / Model | `subagent` / Luna |
| Steps / Temp | 30 / — |
| Web | `deny` |
| Edits | `deny` |
| Bash | git read-only + `rg`/`ls` only |
| Task | none (catch-all deny) |
| Invoke when | Building a mental model of an unfamiliar repo; answering "where is X / how does Y work" before touching code. |

Responsibility: breadth-first repo mapping with bounded searches. Outputs a compact structured report (Summary, Key files, Flow, Conventions, Gaps) that the caller can act on without re-exploring.

### `luna/architect` — architecture analysis

| Field | Value |
|---|---|
| Mode / Model | `subagent` / Luna |
| Steps / Temp | 40 / — |
| Web | `deny` |
| Edits | `deny` |
| Bash | git read-only + `rg`/`ls` |
| Task | none |
| Invoke when | Ambiguous architectural change, cross-cutting design, migration, or "how should this be structured" decisions. |

Responsibility: Requirements → Constraints → Current architecture → Alternatives → Decision → Migration → Validation. Outputs a `<40`-line `## Architecture decision` memo. Read-only; never implements.

### `luna/debugger` — root-cause debugging

| Field | Value |
|---|---|
| Mode / Model | `subagent` / Luna |
| Steps / Temp | 60 / — |
| Web | `deny` |
| Edits | `allow` (fixes) |
| Bash | `allow`, guarded (`git push*` → `deny`, `sudo*` → `deny`) |
| Task | none |
| Invoke when | Non-trivial bug: tests failing, crash, wrong output, hard-to-localize regression. |

Responsibility: reproduce → isolate → hypothesize → test hypothesis → fix root cause → re-reproduce → regression test. Compiler/test/runtime output is authoritative. Reports root cause, not symptoms.

### `luna/tester` — test & validation

| Field | Value |
|---|---|
| Mode / Model | `subagent` / Luna |
| Steps / Temp | 50 / — |
| Web | `deny` |
| Edits | `allow` **only** on test files (edit object allowlist: `*test*`, `*spec*`, `test/*`, `tests/*`, `__tests__/*`, `*.test.{ts,tsx,js,jsx,py}`, `*_test.go`) |
| Bash | `allow`, guarded (`git push*`, `sudo*` → `deny`) |
| Task | none |
| Invoke when | Writing/strengthening tests, or validating an implementation across quick → targeted → full runs. |

Responsibility: progressive validation. Quick check → targeted tests → full suite when warranted. May write or fix test files but never source files. Outputs `## Validation report` with pass/fail evidence.

### `luna/reviewer` — code review

| Field | Value |
|---|---|
| Mode / Model | `subagent` / Luna |
| Steps / Temp | 40 / — |
| Web | `deny` |
| Edits | `deny` |
| Bash | git read-only + test commands (`npm run*`, `npm test*`, `npx*`, `yarn*`, `pnpm*`, `go test*`, `cargo test*`, `pytest*`, `python *`, `make*`, `mvn*`, `gradle*`) |
| Task | none |
| Invoke when | Multi-file or high-risk changes completed by the builder; final quality gate. |

Responsibility: inspect diff → trace behavior → identify defects → classify severity → concrete corrections. Verdict: `APPROVED` / `APPROVE WITH CHANGES` / `CHANGES REQUIRED`. Never edits.

### `luna/security-review` — security audit

| Field | Value |
|---|---|
| Mode / Model | `subagent` / Luna |
| Steps / Temp | 40 / — |
| Web | `deny` |
| Edits | `deny` |
| Bash | git read-only + test commands + `rg` |
| Task | none |
| Invoke when | Security-sensitive changes: auth, input handling, secrets, network, file system, serialization, dependencies. |

Responsibility: threat-oriented review (injection, auth, secrets, path traversal, SSRF, deserialization, dependency risk, privilege boundaries). Verdict: `CLEAN` / `REVIEW RECOMMENDED` / `HIGH RISK`.

## Mode B — V4 Flash only

### `v4/build` — primary implementation engineer (V4)

| Field | Value |
|---|---|
| Mode / Model | `primary` / V4 |
| Steps / Temp | 120 / 0.2 |
| Web | `allow` (use only when repo evidence insufficient; once; compact summary) |
| Edits | `allow` |
| Bash | `allow`, guarded as `luna/build` |
| Task (spawn) | `v4/explorer`, `v4/planner`, `v4/researcher`, `v4/debugger`, `v4/tester`, `v4/reviewer`, `v4/security-review` |
| Invoke when | Any implementation in Mode B. |

Responsibility: same implementation loop as `luna/build`, optimized for speed and cheap iteration. Web research is permitted but discouraged unless repository evidence is genuinely insufficient.

### `v4/planner` — implementation planning

| Field | Value |
|---|---|
| Mode / Model | `subagent` / V4 |
| Steps / Temp | 40 / 0.2 |
| Web | `allow` |
| Edits | `deny` |
| Bash | git read-only + `rg`/`ls` |
| Task | none |
| Invoke when | Non-trivial task before implementation in Mode B; decomposition and sequencing. |

Responsibility: produce the compact **implementation contract** (see `ORCHESTRATION.md` §Contract). Explicitly **non-authoritative**: the builder must verify against repository evidence.

### `v4/explorer` — fast repository recon

| Field | Value |
|---|---|
| Mode / Model | `subagent` / V4 |
| Steps / Temp | 25 / 0.2 |
| Web | `deny` (repo-only by design) |
| Edits | `deny` |
| Bash | git read-only + `rg`/`ls` |
| Task | none |
| Invoke when | Broad, fast repo mapping where V4's speed and cost beat Luna's. |

### `v4/researcher` — external research

| Field | Value |
|---|---|
| Mode / Model | `subagent` / V4 |
| Steps / Temp | 30 / 0.3 |
| Web | `allow` |
| Edits | `deny` |
| Bash | git read-only + `rg`/`ls` |
| Task | none |
| Invoke when | External API/framework/dependency uncertainty that repository evidence cannot resolve. |

Responsibility: official docs → source repositories → current external evidence, then a compact `## Evidence packet` (Question, Answer, Sources — only URLs actually fetched, Version context, Caveats). No edits.

### `v4/debugger` / `v4/tester` / `v4/reviewer` / `v4/security-review`

Same responsibilities as their Luna counterparts, with V4's speed/cost profile, **web access enabled** (unfamiliar-library behavior, CVE/advisory lookups), and identical permission shapes (debugger edits, tester edits test files only, reviewer/security-review read-only).

## Mode C — Two-model

### `dual/orchestrator` — conductor (primary)

| Field | Value |
|---|---|
| Mode / Model | `primary` / V4 (conductor) |
| Steps / Temp | 150 / 0.2 |
| Web | `deny` (delegates research; keeps its own context lean) |
| Edits | `deny` (never modifies files) |
| Bash | git read-only + `ls` |
| Task (spawn) | `v4/explorer`, `dual/v4-researcher`, `dual/v4-planner`, `luna/build`, `luna/debugger`, `luna/tester`, `luna/reviewer`, `luna/security-review`, `dual/luna-reviewer` |
| Invoke when | Any task in Mode C; the default entry point for two-model work. |

Responsibility: run the deterministic pipeline (recon → research → plan → build → review → report), pass only the contract to the builder (never planner prose), enforce bounded delegation, handle builder plan-rejection gracefully.

### `dual/v4-planner` — contract producer (pipeline)

Same shape as `v4/planner`; tuned for the pipeline (feeds evidence packets, explicitly non-authoritative, `<50`-line contract). Model V4, temp 0.2, web `allow`, no edits, steps 40.

### `dual/v4-researcher` — evidence packet for planner

Evidence packet producer feeding the contract. Model V4, temp 0.3, web `allow`, no edits, steps 25.

### `dual/luna-reviewer` — final acceptance review

| Field | Value |
|---|---|
| Mode / Model | `subagent` / Luna |
| Steps / Temp | 40 / — |
| Web | `deny` |
| Edits | `deny` |
| Bash | git read-only + test commands |
| Task | none |
| Invoke when | End of the Mode C pipeline, after `luna/build` reports done. |

Responsibility: verify contract compliance, repository truth, and validation claims independently. Verdict: `ACCEPT` / `ACCEPT WITH CHANGES` / `REJECT`.

## Mode D — GLM Flash only

GLM-5.3 Flash is a fast, self-contained family: no web by default and no cross-model delegation. Each agent is a standalone GLM-only agent.

### `glm/build` — primary implementation engineer (GLM)

| Field | Value |
|---|---|
| Mode / Model | `primary` / GLM |
| Steps / Temp | 120 / 0.2 |
| Web | `deny` |
| Edits | `allow` |
| Bash | `allow`, guarded as `luna/build` |
| Task (spawn) | `glm/architect`, `glm/debugger`, `glm/reviewer` |
| Invoke when | Any implementation in Mode D. |

Responsibility: same implementation loop as `luna/build`/`v4/build`, but GLM-only and web-free. Runs standalone when selected directly. When a task genuinely warrants Luna or V4 (deep reasoning, security review, or web research it cannot do), it finishes with its best validated state and emits the shared **escalation contract** (`docs/ESCALATION.md`) in its report — it never routes cross-model itself.

### `glm/architect` — read-only architecture analysis

| Field | Value |
|---|---|
| Mode / Model | `subagent` / GLM |
| Steps / Temp | 40 / 0.2 |
| Web | `deny` |
| Edits | `deny` |
| Bash | git read-only + `rg`/`ls` |
| Task | none |
| Invoke when | Ambiguous architectural change in a GLM-only workflow; produces a handoff memo for the builder. |

### `glm/debugger` — root-cause debugging

| Field | Value |
|---|---|
| Mode / Model | `subagent` / GLM |
| Steps / Temp | 50 / 0.2 |
| Web | `deny` |
| Edits | `allow` (fixes) |
| Bash | `allow`, guarded (`git push*` → `deny`, `sudo*` → `deny`) |
| Task | none |
| Invoke when | Non-trivial bug in a GLM-only workflow. |

Responsibility: reproduce → isolate → hypothesize → test hypothesis → fix root cause → re-reproduce → regression test, on execution evidence, GLM-only, no web.

### `glm/reviewer` — code review

| Field | Value |
|---|---|
| Mode / Model | `subagent` / GLM |
| Steps / Temp | 40 / 0.2 |
| Web | `deny` |
| Edits | `deny` |
| Bash | git read-only + test commands |
| Task | none |
| Invoke when | Multi-file or high-risk changes completed by `glm/build`; final quality gate in Mode D. |

Responsibility: same review workflow as `luna/reviewer`/`v4/reviewer` (inspect diff → trace → defects → severity → corrections; verdict `APPROVED` / `APPROVE WITH CHANGES` / `CHANGES REQUIRED`), GLM-only, no web.

## Why these exact agents

Each role maps to a real engineering workflow (build, design, explore, debug, test, review, secure). Roles that would duplicate existing workflows (refactor, performance, migration, release/CI, dependency-research) were deliberately folded into these agents or into project `AGENTS.md` — see `ARCHITECTURE.md` §4.3.
