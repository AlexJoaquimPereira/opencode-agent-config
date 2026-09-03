# Routing

How `route/orchestrator` maps a request to a model tier and a specialist. This is the **actual routing matrix** implemented by the router. It is distinct from provider selection (PROVIDER-POLICY.md) and from the qualitative model roles (MODEL-POLICY.md). Routing is deterministic policy — no scoring algorithm, no pricing.

## 1. The routing matrix

| Task shape | Path | Rationale |
|---|---|---|
| Simple atomic change | `v4/build` | Cheapest tier that is correct for the job. |
| Normal but non-trivial (multi-file, clear) | `v4/build` → optional `v4/tester` / `v4/reviewer` | Multi-file ≠ hard; do not escalate on breadth alone. |
| Ordinary bug fix / routine refactor / TDD | `v4/build` | V4 workhorse. |
| Difficult autonomous implementation (complex-but-conventional, long-horizon) | `glm/build` (optional `glm/architect` first) | GLM is the intermediate capability tier. |
| Difficult debugging (failure not critical) | `glm/debugger` / `glm/build` | Stronger autonomous pass than V4 without Luna cost. |
| Architecture / cross-module design | `v4/planner` → `luna/architect` or `luna/build` | High-assurance design tier. |
| Security-sensitive change | `luna/build` + `luna/security-review` (or `glm/build` + `glm/security-review` for non-critical) | Security sits on the highest-assurance tier by default. |
| Critical correctness / subtle concurrency / data migration | `v4/planner` → `luna/build` | High cost to fail. |
| External API/framework/dependency uncertainty (web) | `v4/researcher` → then route on evidence | Only V4 researchers have web. |
| Local dependency/documentation question | `glm/researcher` or `v4/researcher` (repo-first) | Web avoided unless required. |
| High-value/high-risk, or V4/GLM already failed | `luna/*` | Final escalation tier. |

## 2. Escalation-driven routing (from the shared escalation contract)

Specialists emit the escalation contract (`docs/ESCALATION.md`). `route/orchestrator` maps it as follows:

| Escalation reason / signal | Route to |
|---|---|
| `ARCHITECTURE`, `SECURITY`, `QUALITY_REVIEW` | Luna |
| `DEBUGGING`, `REPEATED_FAILURE`, `COMPLEXITY`, `MODEL_UNCERTAINTY` (low/med severity) | GLM first |
| same, but severity HIGH/CRITICAL or GLM also fails | Luna |
| `EXTERNAL_DEPENDENCY`, `MODEL_UNCERTAINTY` needing web | V4 researcher first |
| `CONTEXT_LIMIT` | fresh session, same tier (not a tier change) |
| `BLOCKED` | report BLOCKED; never loop |
| `CRITICAL` severity anywhere | Luna |

### V4 failure path (default)

```
route → v4/build → failure/escalation → inspect contract
  → REASON implementation-complexity / REPEATED_FAILURE (non-critical) → glm/debugger or glm/build
  → REASON architecture/security/critical → luna/*
```

Choose GLM when the task is difficult but not high-risk, failure stems from implementation complexity, repeated failures make V4 uneconomical, or a stronger autonomous coding pass is warranted. Do not blindly route every V4 failure to Luna.

### GLM failure path

```
v4 → glm → failure/escalation → inspect contract → luna/*
```

Luna is the **final** model tier. A GLM failure uses the same escalation contract. There is no tier above Luna.

### Direct Luna path

Go straight to `v4/planner` → `luna/build`/`luna/architect` when the task is unambiguously high-risk/high-value (security, architecture, critical migration, subtle concurrency/correctness, high-cost-to-fail debugging). Do not forward the router's full reasoning to Luna — pass the compact implementation contract only.

## 3. Bounded escalation

- At most **one** cross-model escalation step after the first builder.
- At most **one** escalation step after GLM (which lands on Luna).
- Model path must terminate in `SUCCESS` or `BLOCKED`.
- Forbidden loops: V4→GLM→V4→GLM, V4→GLM→Luna→GLM, or any other recursion.

## 4. Planning is conditional

| Request | Pipeline |
|---|---|
| Simple | `route → v4/build` |
| Normal but non-trivial | `route → v4/build` |
| Complex | `route → v4/planner → glm/build` |
| Architecture / high-risk | `route → v4/planner → luna/*` |

Do not spend planner tokens on work V4 can execute directly. There is no unconditional `route → planner → builder` pipeline.

## 5. Handoff discipline

For every cross-agent handoff pass only: original task, implementation contract, current state, relevant files, relevant constraints, exact test/validation results, relevant error output, escalation reason. Never pass chain-of-thought, full transcripts, irrelevant tool logs, duplicate repository dumps, or unnecessary research history. This preserves the repository's compact-contract / fresh-session strategy.

## 6. Relationship to the other workflows

- **`dual/orchestrator`** remains a separate, manually selectable deterministic V4→Luna high-assurance workflow. It is not part of the routing matrix and does not depend on `route/orchestrator`.
- **`route/orchestrator`** is the general-purpose adaptive router. Selecting it is the *only* way to get automatic cross-model behavior; every single-model agent and `dual/orchestrator` remains directly selectable without it.

## 7. Out of scope

Telemetry, cost analytics, scheduling, off-peak launchers, provider benchmarking, and automatic quantization are not part of routing. Routing decides *which model and agent*; provider policy decides *which provider endpoint*.
