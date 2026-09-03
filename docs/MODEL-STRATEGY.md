# Model Strategy

Why GPT-5.6 Luna, DeepSeek V4 Flash, and GLM-5.3 Flash are assigned to their specific roles, and how the operating modes work.
## 1. The three models

| | GPT-5.6 Luna | DeepSeek V4 Flash | GLM-5.3 Flash |
|---|---|---|---|
| Model ID | `openrouter/openai/gpt-5.6-luna` | `openrouter/deepseek/deepseek-v4-flash-0731` | `openrouter/z-ai/glm-5.3-flash` |
| Profile | Deep reasoning, high-quality implementation | Fast, cheap, broad | Fast, cheap, self-contained |
| Context | ~1.05M (configurable cap + auto-compaction) | ~1.3M | ~1.3M |
| Web | **No** (hard requirement) | **Yes** (OpenRouter/Exa available) | **Yes, role-appropriate** (repo-first; explorer repo-only) |
| Temperature support | No (reasoning model) | Yes | Yes |
| Cost | ~10x V4 | ~1x | Comparable to V4 |

The core principle: **use Luna where depth matters, use V4 where breadth, speed, or web research matters, use GLM where a fast self-contained GLM-only workflow is wanted.**

These are the only three model families this harness references.

## 2. Mode A — Luna only (primary: `luna/build`)

Luna is the implementation authority. Its strengths — deep reasoning, careful multi-step modification, high-confidence review — are exactly what implementation, debugging, and testing need. Its weakness (no web) is neutralized by design: it operates on repository source, LSP, grep/glob, git, shell, tests, compilers, and project documentation. Nothing in the Luna workflow requires the web; external facts that genuinely matter arrive as **evidence packets** produced by V4 researchers in Mode C (see §4), never fetched by Luna itself.

Temperature is intentionally **not set** on Luna agents: `gpt-5.6-luna` is a reasoning model without temperature support (verified against OpenRouter's supported-parameters list). Instead, some Luna agents set `reasoning_effort: high` (architect, debugger, reviewer, security-review, dual/luna-reviewer) or `medium` (explorer) — these are accepted by the provider and raise depth exactly where the role demands it without extra tokens for the others.

## 3. Mode B — V4 Flash only (primary: `v4/build`)

V4 Flash is the workhorse: fast repository exploration, cheap implementation, quick iteration, and optional web research. Its prompts deliberately optimize for:

- **Speed and token cost** — smaller step budgets than Luna for equivalent roles (e.g., `v4/explorer` 25 steps vs `luna/explorer` 30), temperature 0.2 for determinism.
- **Web access with restraint** — websearch/webfetch are `allow`, but the prompt instructs: use the web **only when repository evidence is insufficient**, at most once per task, and summarize compactly. This protects both the cache prefix (stable context) and the wallet.

V4 planners are explicitly **non-authoritative**: they produce a compact contract, not a directive. Even in Mode B, the builder verifies the contract against repository evidence before implementing.

## 4. Mode C — Two-model (primary: `dual/orchestrator`)

The default division of labor:

| Stage | Agent | Model | Why this model |
|---|---|---|---|
| Recon | `v4/explorer` | V4 | Broad, cheap, fast repo mapping. |
| Research | `dual/v4-researcher` | V4 | Has web access; produces sourced evidence packets. |
| Plan | `dual/v4-planner` | V4 | Fast decomposition into the implementation contract. |
| Verify + Build | `luna/build` | Luna | Inspects repo, **verifies/amends/rejects the contract**, implements with deep reasoning. |
| Debug (conditional) | `luna/debugger` | Luna | Deep root-cause work. |
| Test (conditional) | `luna/tester` | Luna | High-quality tests. |
| Review | `dual/luna-reviewer` | Luna | High-confidence final acceptance. |
| Security (conditional) | `luna/security-review` | Luna | Security-sensitive changes. |
| Conductor | `dual/orchestrator` | V4 | Cheap orchestration glue; delegates all heavy lifting. |

Mode C is a deterministic Luna + V4 workflow and remains a manually selectable high-assurance path. It is independent of the router; the router (Mode R, `route/orchestrator`, see ROUTING.md) is the separate adaptive path that selects among V4, GLM and Luna.

The **planner is never authoritative**. `luna/build` must verify the contract against repository evidence; if the contract conflicts with repository evidence, it amends or rejects it. This is enforced in both the orchestrator prompt and the builder prompt. Only the *contract* is passed to the builder — never the planner's reasoning or exploration transcripts.

### Why the conductor runs V4

The orchestrator's job is routing, ordering, and synthesis — broad, cheap work. Running it on V4 keeps Mode C economical while all *judgment* work (implementation, review, security) lands on Luna. This also means the orchestrator's own context stays small and cache-friendly.

## 5. Mode D — GLM Flash only (primary: `glm/build`)

GLM-5.3 Flash is a fast, cheap, **self-contained** workhorse. Its family (`glm/build`, `glm/explorer`, `glm/researcher`, `glm/architect`, `glm/debugger`, `glm/tester`, `glm/reviewer`, `glm/security-review`) provides full functional coverage with **role-appropriate web access** and **no cross-model delegation**: GLM runs alone, and specialists stay within the family. Prompts use:

- **Speed and token cost** — temperature 0.2 for determinism; step budgets comparable to V4 equivalents.
- **Role-appropriate web** — web is allowed where the specialist role benefits (build, researcher, architect, debugger, tester, reviewer, security-review), always repo-first and used once per task with a compact summary. `glm/explorer` denies web (repo-only, mirroring `v4/explorer`). If genuinely external facts are required during an escalation, GLM can research them itself or emit the escalation contract (see §7).
- **Bounded delegation** — `glm/build` may only call `glm/*`. No GLM → Luna → GLM recursion is possible.

Each GLM agent is a standalone GLM-only agent: explicitly selecting `glm/build` yields a GLM-only workflow. Like the V4 and Luna families, GLM agents remain independently selectable and are not assumed to be children of a router.

### 5.1 GLM as the intermediate tier

GLM occupies the middle of the capability/cost ladder: more capable and autonomous than V4 for difficult coding, but below Luna's high-assurance tier. The router (see ROUTING.md) uses GLM for complex-but-conventional implementation and difficult non-critical debugging, reserving Luna for architecture, security, and critical correctness.

### 5.2 Mode R — the router (`route/orchestrator`)

`route/orchestrator` runs on V4 (cheap orchestration glue) and is the **only** cross-model router. It classifies each request and routes deterministically: V4 by default, GLM for the intermediate tier, Luna for high-risk/architecture/security and as the final escalation. It consumes the escalation contract emitted by single-model builders and enforces bounded escalation (no recursion; terminate in SUCCESS or BLOCKED). It is read-only and web-free; research and execution are always delegated.

## 6. Model assignment invariants

1. **Every agent declares an explicit model.** Delegation is deterministic regardless of which primary spawned a subagent (subagents otherwise inherit the invoking agent's model).
2. **All `luna/*` + `dual/luna-reviewer`** → Luna, and **all** have `webfetch: deny` + `websearch: deny`. Luna never has web, in any mode.
3. **All `v4/*` except `v4/explorer`**, plus `dual/orchestrator`, `dual/v4-planner`, `dual/v4-researcher`, and `route/orchestrator` → V4. Web allowed on researchers/planners/build; `v4/explorer`, `dual/orchestrator`, and `route/orchestrator` deliberately deny web (repo-only / delegates research).
4. **All `glm/*`** → GLM-5.3 Flash (`openrouter/z-ai/glm-5.3-flash`). Web is role-appropriate: allowed on builders/researchers/architects/debuggers/testers/reviewers/security-review (repo-first), denied on `glm/explorer` (repo-only). Luna never has web; GLM does where its role benefits.
5. **Temperature on V4 and GLM agents** (0.2 implementation/planning/review/debug/architecture/exploration/testing/security, 0.3 research for V4). Luna agents omit temperature.
6. **Reasoning effort** is used to tune Luna depth per-role without raising temperature (unsupported) or wasting tokens.

## 7. Cross-family escalation (the shared contract)

Single-model builders (`v4/build`, `glm/build`) remain **single-model**: they never invoke another family. When a task genuinely warrants a different family, they finish with their best validated state and emit the shared **escalation contract** (`docs/ESCALATION.md`) — `STATUS / TARGET / REASON / SEVERITY / EVIDENCE / LAST_VALIDATION / RECOMMENDED_HANDOFF`. The `route/orchestrator` router (Mode R) is the single consumer that performs the actual cross-model routing; routing terminates in SUCCESS or BLOCKED with bounded escalation (see §8).

## 8. Failure semantics across models

- If **V4 produces a poor contract** (conflicts with repo evidence), the Luna builder amends/rejects it — the design has a built-in correction loop, not a trust boundary.
- If **Luna is unavailable or over budget**, fall back to Mode B (`v4/build`) — the same workflows exist on V4.
- If **web research is unavailable** in Mode B, V4 agents degrade gracefully to repo-only evidence (web is an enhancement, not a dependency).
- If a **GLM or V4 builder escalates**, it emits the escalation contract; under `route/orchestrator` this triggers a bounded route (V4→GLM or V4→Luna; GLM→Luna; never looping). Without the router, the caller/user reads the contract and chooses the next model manually.
- **Tier termination:** GLM is never the last tier when Luna is reachable; a GLM failure routes to Luna. If Luna fails, the router reports `BLOCKED` — there is no tier above Luna and no recursion.
