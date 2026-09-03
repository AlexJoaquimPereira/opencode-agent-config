# Architecture

This document explains how the harness is structured and why each part exists. It is the design record; companion docs cover the agent matrix, model strategy, model/provider/routing policy, permissions, orchestration, token efficiency, and caching.

## 1. Goals

The harness maximizes, in rough priority order:

1. programming correctness and difficult-task performance;
2. repository understanding;
3. debugging and test quality;
4. security;
5. autonomous execution;
6. token and cache efficiency, latency;
7. resistance to context pollution;
8. reliability across arbitrary programming projects.

Two constraints shape everything: **GPT-5.6 Luna has no web access** (hard requirement) and **GLM-5.3 Flash has role-appropriate web access** (repo-first, used only where the specialist role benefits), and **context is expensive** for all models, so agents must carry high information density rather than maximum context utilization.

## 2. Operating modes

The user runs several configurations. Each single-model family is a first-class, independently selectable mode:

- **Mode A — Luna only.** Primary: `luna/build`. Deep implementation, debugging, testing, review, architecture. No web, by design.
- **Mode B — V4 Flash only.** Primary: `v4/build`. Fast, cheap implementation with web research available but discouraged unless repository evidence is insufficient.
- **Mode C — Two-model (Luna + V4).** Primary: `dual/orchestrator`. Deterministic V4-plan/Luna-execute high-assurance workflow; a separate manual path, independent of the router.
- **Mode D — GLM Flash only.** Primary: `glm/build`. Fast, self-contained implementation (build, explorer, researcher, architect, debugger, tester, reviewer, security-review) with role-appropriate web access (repo-first).
- **Mode R — Multi-model router.** Primary: `route/orchestrator`. Adaptive routing across V4 (default workhorse), GLM (intermediate), and Luna (high-assurance). Selecting it is the only way to get automatic cross-model behavior.

Because models may be used together, every agent declares an explicit `model`, so delegation is deterministic regardless of which primary spawned the subagent.

The model families supported by this harness are **DeepSeek V4 Flash**, **GPT-5.6 Luna**, and **GLM-5.3 Flash** — no other family is referenced. Cross-model routing is centralized in the `route/orchestrator` router (Mode R): it selects among V4, GLM and Luna per the routing matrix (ROUTING.md). The `dual/orchestrator` (Mode C) remains a separate deterministic V4→Luna workflow.

## 3. Agent namespaces

Subdirectories under `agents/` produce path-prefixed agent IDs:

```
agents/luna/build.md        → luna/build        (primary)
agents/v4/planner.md        → v4/planner        (subagent)
agents/glm/build.md         → glm/build         (primary)
agents/dual/orchestrator.md → dual/orchestrator (primary)
agents/route/orchestrator.md→ route/orchestrator (primary)
```

Namespacing serves three purposes:

- **No collisions.** A JSON-defined `luna` agent in `opencode.json` coexists with `luna/*` markdown agents because names differ.
- **Task-scoped delegation.** Primary agents allow task calls via glob patterns like `luna/*`, `v4/*`, `glm/*`. Last-match-wins makes `"*": "deny"` + `"namespace/agent": "allow"` the reliable way to whitelist exactly the intended set.
- **Model scoping.** All `luna/*` agents run GPT-5.6 Luna; all `v4/*` agents run DeepSeek V4 Flash; all `glm/*` agents run GLM-5.3 Flash; `dual/*` mixes: conductor and planners on V4, reviewers on Luna; `route/orchestrator` runs V4 as conductor and is the only cross-model router.

## 4. Agent roles and why they exist

Only roles that map to real engineering workflows were created. Each has a concrete responsibility, an explicit reason for existing, a model, a tool set, a bounded step count, a permission policy, a concise prompt, and clear output expectations.

### 4.1 Primary (mode: `primary`)

| Agent | Model | Why it is a primary |
|---|---|---|
| `luna/build` | Luna | Main implementation engineer for Mode A. Can be selected directly and can spawn Luna specialists. |
| `v4/build` | V4 Flash | Main implementation engineer for Mode B. |
| `glm/build` | GLM-5.3 Flash | Main implementation engineer for Mode D. Can be selected directly and can spawn GLM specialists. |
| `dual/orchestrator` | V4 Flash | Conductor for Mode C (deterministic V4→Luna). Read-only by design: it never edits directly. |
| `route/orchestrator` | V4 Flash | Router for Mode R. The only cross-model router: adaptively selects V4/GLM/Luna per ROUTING.md. Read-only by design: it never edits directly. |

Primaries are the only agents that spawn subagents. OpenCode's default `subagent_depth` is 1, which means primaries can spawn subagents but subagents cannot spawn subagents. This is **intentional and preserved**: it makes uncontrolled recursive agent trees impossible without explicit configuration.

### 4.2 Subagents (mode: `subagent`)

**Luna specialists (Mode A):**

| Agent | Responsibility | Exists because |
|---|---|---|
| `luna/explorer` | Read-only repo mapping and Q&A | Builders need a compact, accurate mental model before touching code. |
| `luna/architect` | Read-only architecture decision memo | Ambiguous changes need design analysis before implementation. |
| `luna/debugger` | Root-cause fixing with runtime evidence | Hard bugs need reproduce→isolate→fix discipline on a capable model. |
| `luna/tester` | Progressive validation, test writing (test files only) | Test quality is a first-class deliverable. |
| `luna/reviewer` | Diff review with severity classification | Multi-file/high-risk changes need independent review. |
| `luna/security-review` | Security audit of code/diffs | Security-sensitive changes get a dedicated pass. |

**V4 specialists (Mode B):**

| Agent | Responsibility | Exists because |
|---|---|---|
| `v4/planner` | Produces the compact implementation contract | V4 is excellent at fast decomposition; the contract, not prose, is the artifact passed forward. |
| `v4/explorer` | Fast read-only repo mapping | Cheaper/faster than Luna for broad recon. No web by design (repo-only). |
| `v4/researcher` | External documentation/API/dependency research | V4 has web access; returns a sourced evidence packet. |
| `v4/debugger` | Root-cause fixing (V4, web available) | V4 can fix bugs fast; web allowed only for unfamiliar-library behavior. |
| `v4/tester` | Progressive validation (V4) | Test quality for the V4-only mode. |
| `v4/reviewer` | Diff review (V4, web available) | Independent review in Mode B. |
| `v4/security-review` | Security audit (V4, web available) | Security pass in Mode B; may check advisories. |

**GLM specialists (Mode D):**

| Agent | Responsibility | Exists because |
|---|---|---|
| `glm/explorer` | Read-only repo mapping and Q&A | GLM builders need a compact repo map before touching code. |
| `glm/researcher` | **Local-first** dependency/docs research (web allowed, repo first) | GLM resolves external questions from repo, installed sources, then web; used as a GLM-tier researcher. |
| `glm/architect` | Read-only architecture decision memo | Ambiguous GLM-only changes need design analysis before implementation. |
| `glm/debugger` | Root-cause fixing with runtime evidence | Hard GLM-only bugs need reproduce→isolate→fix discipline. |
| `glm/tester` | Progressive validation, test writing (test files only) | Test quality for the GLM-only mode. |
| `glm/reviewer` | Diff review with severity classification | Independent review in Mode D. |
| `glm/security-review` | Security audit of code/diffs | Security pass in Mode D; web only to confirm advisories/CVEs. |

Each GLM specialist is a standalone GLM-only agent: it runs GLM-5.3 Flash, never routes to Luna/V4, and has role-appropriate web access (repo-first; only `glm/explorer` is repo-only by design, mirroring `v4/explorer`).

**Router (Mode R):**

| Agent | Responsibility | Exists because |
|---|---|---|
| `route/orchestrator` | Adaptive multi-model router | General-purpose routing across V4/GLM/Luna is the one workflow that must not live in a single-model agent. It owns all cross-model delegation. |

**Dual specialists (Mode C):**

| Agent | Responsibility | Exists because |
|---|---|---|
| `dual/v4-planner` | Contract producer for the pipeline | Same contract format as `v4/planner`, explicitly non-authoritative; the Luna builder verifies it. |
| `dual/v4-researcher` | Evidence packet for the planner | Feeds verified external facts into the contract. |
| `dual/luna-reviewer` | Final high-confidence review against contract + repo | Closes the loop: verifies the implementation is correct, complete, and contract-compliant. |

### 4.3 Roles deliberately NOT created

Per the requirement to avoid persona-flavored agents:

- **Refactoring specialist** — refactoring is a workflow the builder already performs (inspect → plan → modify → validate → review). A dedicated agent would duplicate it.
- **Performance specialist** — performance analysis is folded into the reviewer/architect workflows; a dedicated agent adds latency without clear benefit for general repos.
- **Migration specialist** — migration is a phase of the architecture workflow (`luna/architect` covers migration + validation).
- **Release/CI specialist** — CI/release logic is inherently project-specific; that belongs in the project's `AGENTS.md`, not global agents.
- **Dependency/API researcher** — external web research is served by `v4/researcher`, `dual/v4-researcher`, and `glm/researcher` (each repo-first, then official docs/web). GLM researchers may use web like their V4 counterparts.

## 5. Delegation and nesting

- Only primaries spawn subagents (via the `task` tool). Every primary has a `task` permission block with `"*": "deny"` followed by an explicit allowlist of the specific agents it may call.
- Specialist subagents have `task: { "*": "deny" }` — they never spawn anything. Combined with `subagent_depth: 1` (default), the delegation graph is strictly one level deep from any primary.
- Mode C is one level deep from `dual/orchestrator`: explorer/planner/researcher on V4, builder/debugger/tester/reviewer/security-review on Luna. No agent in the pipeline spawns another.
- GLM specialists never spawn and `glm/build` only ever calls `glm/*`. No GLM → Luna → GLM (or any recursive cross-model) chain is possible from the permission model alone: each family's primary has no task path to another family's agents.
- Mode R is one level deep from `route/orchestrator`, the **only** cross-model router. It may call v4, glm, and luna specialists; none of those specialists may call another family back. Cross-model routing is centralized and cannot recurse.

### The escalation contract and the router

Single-model builders (`v4/build`, `glm/build`) emit the shared escalation contract (`docs/ESCALATION.md`) — a compact `STATUS / TARGET / REASON / SEVERITY / EVIDENCE / LAST_VALIDATION / RECOMMENDED_HANDOFF` block — when the task warrants another model family. Emitting it does **not** spawn a cross-model agent (their permissions forbid it). The `route/orchestrator` router reads the contract and performs the actual cross-model routing (see ROUTING.md); routing terminates in SUCCESS or BLOCKED with a bounded one-step escalation after each tier.

## 6. The implementation contract

The contract is the single artifact passed from planner to builder (Modes C and R). Format:

```
OBJECTIVE / SCOPE / ARCHITECTURE / FILES / DEPENDENCIES / INVARIANTS /
VALIDATION / RISKS / OPEN QUESTIONS
```

Why this matters:

- It is **compact** — the builder receives only the contract, not the planner's reasoning or exploration transcripts.
- It is **verifiable** — `luna/build` must check every section against repository evidence and may amend or reject it.
- It keeps the planner **non-authoritative**, which is a hard requirement of the design.

The contract schema is embedded verbatim in both `v4/planner` and `dual/v4-planner` prompts, so Mode B, Mode C, and Mode R produce identical artifacts.

## 7. Verification loop (Mode C)

```
request → v4/explorer (recon, optional)
        → dual/v4-researcher (external facts, optional)
        → dual/v4-planner (contract)
        → luna/build (verify contract vs repo → amend/reject → implement → validate)
        → dual/luna-reviewer (contract compliance + repo truth + validation verification)
        → (luna/security-review if security-sensitive)
        → report
```

The key property: **the planner is never authoritative**. `luna/build` is explicitly instructed to verify the contract against repository evidence and amend or reject it. If the builder reports a conflict, the orchestrator evaluates it with a targeted read rather than blindly re-planning.

## 8. File layout and placement

- `agents/` — only real agents. Any `.md` here becomes an agent (default `mode: all`), so **README.md and docs are kept outside** `agents/`. Subdirectories scope families: `agents/luna/*`, `agents/v4/*`, `agents/glm/*`, `agents/dual/*`, `agents/route/*`.
- `README.md`, `docs/` — documentation, stored at the OpenCode config directory root, the parent of `agents/`.
- External measurement/scheduling layers (not part of the agent graph, never injected into model context): `config/model-pricing.json` (cost-accounting assumptions), `plugins/opencode-telemetry.ts` (optional append-only telemetry writing `.telemetry/`), `scripts/` (cost analyzer, off-peak direct-DeepSeek batch launcher, routing dry-run), `benchmarks/` (real-task harness). `.telemetry/` and `benchmarks/results/` are git-ignored runtime data.
- Project-specific behavior — lives in the project's `AGENTS.md`, never in these global agents.
