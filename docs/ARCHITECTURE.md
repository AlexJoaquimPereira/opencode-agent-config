# Architecture

This document explains how the harness is structured and why each part exists. It is the design record; companion docs cover the agent matrix, model strategy, permissions, orchestration, token efficiency, and caching.

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

Two constraints shape everything: **GPT-5.6 Luna has no web access** (hard requirement), and **context is expensive** for both models, so agents must carry high information density rather than maximum context utilization.

## 2. Operating modes

The user runs three configurations. Each is a first-class mode, not a variant of one agent:

- **Mode A — Luna only.** Primary: `luna/build`. Deep implementation, debugging, testing, review, architecture. No web, by design.
- **Mode B — V4 Flash only.** Primary: `v4/build`. Fast, cheap implementation with web research available but discouraged unless repository evidence is insufficient.
- **Mode C — Two-model.** Primary: `dual/orchestrator`. V4 Flash plans/researches; Luna verifies, implements, and reviews.

Because the two models are used together in Mode C, every agent declares an explicit `model`, so delegation is deterministic regardless of which primary spawned the subagent.

## 3. Agent namespaces

Subdirectories under `agents/` produce path-prefixed agent IDs:

```
agents/luna/build.md        → luna/build        (primary)
agents/v4/planner.md        → v4/planner        (subagent)
agents/dual/orchestrator.md → dual/orchestrator (primary)
```

Namespacing serves three purposes:

- **No collisions.** A JSON-defined `luna` agent in `opencode.json` coexists with `luna/*` markdown agents because names differ.
- **Task-scoped delegation.** Primary agents allow task calls via glob patterns like `luna/*`, `v4/*`. Last-match-wins makes `"*": "deny"` + `"namespace/agent": "allow"` the reliable way to whitelist exactly the intended set.
- **Model scoping.** All `luna/*` agents run GPT-5.6 Luna; all `v4/*` agents run DeepSeek V4 Flash; `dual/*` mixes: conductor and planners on V4, reviewers on Luna.

## 4. Agent roles and why they exist

Only roles that map to real engineering workflows were created. Each has a concrete responsibility, an explicit reason for existing, a model, a tool set, a bounded step count, a permission policy, a concise prompt, and clear output expectations.

### 4.1 Primary (mode: `primary`)

| Agent | Model | Why it is a primary |
|---|---|---|
| `luna/build` | Luna | Main implementation engineer for Mode A. Can be selected directly and can spawn Luna specialists. |
| `v4/build` | V4 Flash | Main implementation engineer for Mode B. |
| `dual/orchestrator` | V4 Flash | Conductor for Mode C. Delegates planning/research to V4 agents and implementation/review to Luna agents. Read-only by design: it never edits directly. |

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
- **Dependency/API researcher** — folded into `v4/researcher` / `dual/v4-researcher`, which cover both docs and dependency behavior.

## 5. Delegation and nesting

- Only primaries spawn subagents (via the `task` tool). Every primary has a `task` permission block with `"*": "deny"` followed by an explicit allowlist of the specific agents it may call.
- Specialist subagents have `task: { "*": "deny" }` — they never spawn anything. Combined with `subagent_depth: 1` (default), the delegation graph is strictly one level deep from any primary.
- Mode C is one level deep from `dual/orchestrator`: explorer/planner/researcher on V4, builder/debugger/tester/reviewer/security-review on Luna. No agent in the pipeline spawns another.

## 6. The implementation contract

The contract is the single artifact passed from planner to builder (Mode C). Format:

```
OBJECTIVE / SCOPE / ARCHITECTURE / FILES / DEPENDENCIES / INVARIANTS /
VALIDATION / RISKS / OPEN QUESTIONS
```

Why this matters:

- It is **compact** — the builder receives only the contract, not the planner's reasoning or exploration transcripts.
- It is **verifiable** — `luna/build` must check every section against repository evidence and may amend or reject it.
- It keeps the planner **non-authoritative**, which is a hard requirement of the design.

The contract schema is embedded verbatim in both `v4/planner` and `dual/v4-planner` prompts, so Mode B and Mode C produce identical artifacts.

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

- `agents/` — only real agents. Any `.md` here becomes an agent (default `mode: all`), so **README.md and docs are kept outside** `agents/`.
- `README.md`, `docs/` — documentation, stored at the OpenCode config directory root, the parent of `agents/`.
- Project-specific behavior — lives in the project's `AGENTS.md`, never in these global agents.
