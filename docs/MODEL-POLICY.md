# Model Policy

Qualitative role of each model family in the harness. This document states *which model does what and why*; provider selection and routing mechanics live in PROVIDER-POLICY.md and ROUTING.md respectively. No token prices are hard-coded anywhere in the agents or this policy.

## 1. The three model families

| Family | Model ID | Qualitative role |
|---|---|---|
| V4 | `openrouter/deepseek/deepseek-v4-flash-0731` | Default implementation workhorse; fast, cheap execution and web research |
| GLM | `openrouter/z-ai/glm-5.3-flash` | Difficult autonomous coding; intermediate complexity tier between V4 and Luna |
| Luna | `openrouter/openai/gpt-5.6-luna` | High-risk, architecture, difficult reasoning, final escalation; highest assurance |

Each family is a first-class, **independently selectable** set of agents: `v4/*`, `glm/*`, and `luna/*` can each be selected directly and run that model only. A `glm/build` session is GLM-only; a `v4/build` session is V4-only; a `luna/build` session is Luna-only.

## 2. Model roles

### V4 — default workhorse

- Straightforward implementation, ordinary bug fixes, routine refactoring.
- Clear multi-file changes and test-driven implementation.
- Low/medium-risk work where failure is inexpensive.
- Web research (`v4/researcher`) for external API/framework/dependency uncertainty.
- Default tier: used when the task does not justify a higher capability or assurance tier.

### GLM — difficult autonomous coding / intermediate escalation

- Complex-but-conventional implementation spanning a longer horizon.
- Difficult autonomous coding where V4 would likely need many iterations.
- Difficult debugging whose failure consequence is not critical.
- The intermediate-quality/complexity tier between ordinary V4 execution and high-assurance Luna work.
- Role-appropriate web: GLM may use the web where the specialist role benefits (build, researcher, architect, debugger, tester, reviewer, security-review) — repo-first, restricted per role. `glm/explorer` is repo-only.

### Luna — high-risk, architecture, difficult reasoning, final escalation

- Architecture decisions, cross-module reasoning, subtle concurrency/correctness.
- Security-sensitive changes.
- Critical data migrations and high-cost-to-fail debugging.
- Final escalation: independent strong reasoning pass when V4 and/or GLM failed.
- No web, by hard requirement; operates on repository source, LSP, grep/glob, git, shell, tests, and compilers. Existing Luna context-window optimization and context discipline are preserved and must not be altered.

### dual — deterministic V4 → Luna high-assurance workflow

The `dual/orchestrator` workflow is a **separate manual path**: deterministic V4 planning/research followed by Luna implementation/review. It is not a routing tier and does not depend on `route/orchestrator`. It remains directly selectable for users who want the explicit two-model high-assurance pipeline.

## 3. Isolation guarantees

- `v4/*` remains V4-only; `luna/*` remains Luna-only; `glm/*` remains GLM-only; `dual/*` keeps its V4→Luna workflow; `route/*` is the only cross-model router.
- No specialist is a generic model alias: each keeps its concrete responsibility and permission shape.
- Cross-model delegation is centralized in `route/orchestrator`. Specialist agents never gain task permissions for another family (no `glm/*`→`luna/*`, no `luna/*`→`v4/*`, etc.), except existing in-family delegation.
- GLM web is role-appropriate: allowed on builders/researchers/architects/debuggers/testers/reviewers/security-review (repo-first), denied on `glm/explorer` (repo-only). Luna has no web access in any mode. The router and dual conductor deny web (research is delegated).

## 4. Escalation semantics

When a single-model builder cannot finish, it emits the shared escalation contract (`docs/ESCALATION.md`). The intended tier ladder is:

```
V4  ──failure/needs-depth──▶  GLM  ──failure──▶  LUNA
                                │                    │
                                └── non-critical ────┘  (final tier)
```

- V4 failure driven by implementation complexity → GLM.
- V4 failure driven by architecture/security/critical severity → Luna.
- GLM failure → Luna (final tier).
- Bounded: maximum cross-model escalation depth is **2**. Allowed: V4→GLM, V4→Luna, GLM→Luna, V4→GLM→Luna. Forbidden: Luna→GLM, Luna→V4, GLM→V4, and any cycle. The path terminates in `SUCCESS` or `BLOCKED`.

## 5. Telemetry, cost, and scheduling policy (non-routing layers)

Measurement and scheduling are **external layers** — they never alter the model policy above and never enter model prompts.

- **Telemetry**: measure tokens, cache (read/write), cost, success, escalation, and human intervention per task/attempt (`.telemetry/`, git-ignored).
- **Cost**: optimize **cost per successful task**, not price per million tokens (`docs/COST-METRICS.md`, `config/model-pricing.json`).
- **Scheduling**: direct DeepSeek is a separate **off-peak batch path** (IST weekday peak windows 06:30–09:30 and 11:30–15:30) used only for explicit batch/background work (`scripts/opencode-direct-deepseek.mjs`). Interactive `route/orchestrator` is never clock-routed.

## 6. What is out of scope

Learned/automatic routing thresholds, automatic provider benchmarking/quantization/price scraping, automatic model selection from benchmark statistics, a default `route/orchestrator`, and any model family other than V4/GLM/Luna. These are later phases; this phase only collects the data they will need.
