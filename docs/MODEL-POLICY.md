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
- No web by default: GLM works from repository/local evidence; genuine web research is routed to V4.

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
- No GLM agent has web access; Luna has no web access in any mode.

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
- Bounded: one cross-model escalation step after the first builder, and one after GLM; the path terminates in `SUCCESS` or `BLOCKED`. No V4→GLM→V4→GLM or V4→GLM→Luna→GLM loops.

## 5. What is out of scope

Telemetry, cost dashboards, usage collection, automated cost/success calculations, off-peak scheduling, direct-provider launchers, time-zone logic, automatic provider benchmarking/quantization/price scraping, and any model family other than V4/GLM/Luna are **not** part of the model policy. They are later phases.
