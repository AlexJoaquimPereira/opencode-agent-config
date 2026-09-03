# Orchestration

How the system decides who does what, when — deterministically, with bounded fan-out and no uncontrolled recursion.

## 1. Deterministic escalation rules

The primaries (`luna/build`, `v4/build`, `glm/build`, `dual/orchestrator`, `route/orchestrator`) follow explicit escalation rules. The same task shape always maps to the same delegation plan. **Specialists are never invoked en masse** — each escalation adds only the agents the task shape requires. Single-model primaries escalate only within their own family (or emit the escalation contract); `dual/orchestrator` and `route/orchestrator` are the cross-model conductors (Modes C and R).

| Task shape | Pipeline |
|---|---|
| Simple, atomic change (single file, local) | Builder only |
| Multi-file change | Builder → targeted reviewer and/or tester |
| Ambiguous / architectural change | Planner/architect → builder → reviewer |
| External API / framework uncertainty | Researcher → builder |
| Difficult debugging | Debugger (builder hands off) |
| Security-sensitive change | Builder → security-review |
| High-risk / large change | Planner → builder → tester → reviewer |
| Two-model (Mode C) | V4 recon/research/plan → Luna build → Luna review |
| Adaptive routing (Mode R) | Router classifies → V4/GLM/Luna per ROUTING.md → bounded escalation |

Classification heuristics (in the builder prompts):

- **Size**: >3 files touched or >1 module boundary → treat as multi-file.
- **Ambiguity**: the task mentions architecture, design, tradeoffs, migration, or "how should we" → escalate to planner/architect first.
- **Risk**: touching auth, network, file I/O, persistence, concurrency, public API contracts, or removing code → flag for reviewer and possibly security-review.
- **Externality**: task references an API/framework/dependency the agent cannot verify from the repo → researcher first.
- **Debugging**: task is "bug", "fix", "failing test", "crash", "regression", or reproduction needed → debugger workflow.

## 2. Implementation contract

The single artifact passed between planner and builder. This is deliberate: **the builder receives only the contract, never the planner's reasoning or exploration transcripts.**

```
OBJECTIVE          — what is being accomplished and why
SCOPE              — what is in scope, what is explicitly out of scope
ARCHITECTURE       — design approach, modules touched, data flow
FILES              — concrete file paths and what changes in each
DEPENDENCIES       — new or changed dependencies, versions
INVARIANTS         — properties that must hold before/after (never violated)
VALIDATION         — how to prove success (commands, tests, expected output)
RISKS              — what could break, and mitigation
OPEN QUESTIONS     — unresolved items the builder must resolve from repo evidence
```

Rules around the contract:

- **Compact**: `<50` lines. No narrative. No "thinking out loud".
- **Non-authoritative**: the planner says so explicitly. The builder treats it as a hypothesis, not a spec.
- **Verifiable**: every section must be checkable against repository evidence.
- **Amendable/rejectable**: the builder must inspect the repo and, if the contract conflicts with repository evidence, amend or reject it before implementing.

## 3. Cross-family escalation contract

Single-model builders (`v4/build`, `glm/build`) stay single-model: they only call their own family's specialists. When a task genuinely needs a different model family, they finish with their best validated state and emit the shared **escalation contract** — defined in full in `docs/ESCALATION.md`:

```
## Escalation
STATUS: CONTINUE | ESCALATE | BLOCKED
TARGET: NONE | V4 | GLM | LUNA
REASON: ARCHITECTURE | DEBUGGING | SECURITY | COMPLEXITY |
        REPEATED_FAILURE | CONTEXT_LIMIT | MODEL_UNCERTAINTY |
        EXTERNAL_DEPENDENCY | QUALITY_REVIEW
SEVERITY: LOW | MEDIUM | HIGH | CRITICAL

EVIDENCE:
- ...

LAST_VALIDATION:
- command:
- result:

RECOMMENDED_HANDOFF:
- ...
```

Rules:

- **Compact**: fixed enums, concrete evidence, no narrative, no transcripts, no pricing/scheduling/telemetry.
- **Descriptive, not routing**: emitting `ESCALATE` does not spawn a cross-model agent. The permission model prevents it. The contract records the handoff point.
- **Same schema across V4 and GLM builders**, so the router can consume either family's output identically.
- **Handoff discipline**: carries only task, state, changed files, validation failure/error output, reason, severity, constraints — never chain-of-thought or full transcripts (keeps the fresh-session handoff cheap).
- Under **`route/orchestrator`** (Mode R), an emitted `ESCALATE`/`BLOCKED` contract drives the bounded next-tier route (see §5 and ROUTING.md). Run standalone (or under `dual/orchestrator`), the caller/user reads the contract and selects the next model manually.

## 4. Mode C pipeline (two-model)

```
request
  │
  ├─(if repo unfamiliar)──▶ v4/explorer       → recon report
  │
  ├─(if external facts needed)──▶ dual/v4-researcher → evidence packet(s)
  │
  ├─▶ dual/v4-planner     → implementation contract
  │
  ├─▶ luna/build          → VERIFY contract vs repo (amend/reject)
  │                          → implement
  │                          → validate (compiler/tests/runtime)
  │                          → inspect diff
  │
  ├─(if debugging hard)──▶ luna/debugger      → root cause + fix + regression
  │
  ├─(if security-sensitive)──▶ luna/security-review
  │
  ├─▶ dual/luna-reviewer  → contract compliance + repo truth + validation
  │                          verdict: ACCEPT | ACCEPT WITH CHANGES | REJECT
  │
  └─▶ report (structured summary)
```

### Handoff rules (enforced in the orchestrator prompt)

1. Pass the **contract** to `luna/build`, plus the original user request. Nothing else from the planner.
2. Instruct the builder: *"Verify this contract against the repository. If it conflicts with repository evidence, amend or reject it. Then implement."*
3. If the builder reports a **plan conflict** (amended/rejected), the orchestrator reads the relevant files itself to adjudicate: if the builder's objection is repo-evident, accept the amendment; only if the contract was fundamentally wrong does it re-plan.
4. Each specialist is invoked **at most once per pipeline stage**; the orchestrator never re-invokes a specialist to "retry harder" without a concrete, evidence-backed reason.
5. All subagent results are **compact** (contracts, verdicts, reports) — never full transcripts. The orchestrator relays summarized findings.

### When stages are skipped

- Trivial tasks: skip planner entirely; hand the request (or a minimal contract) straight to the builder. Verified end-to-end in the smoke test: the orchestrator read the files, judged the task trivial, and skipped the planner.
- No external facts needed: skip researcher.
- Repo already understood: skip explorer.
- Not security-sensitive: skip security-review.
- Builder's validation is authoritative: skip reviewer only when the change is tiny and the builder's test output is unambiguous (still default to review for multi-file changes).

## 5. Mode R — adaptive routing (`route/orchestrator`)

`route/orchestrator` is a separate, general-purpose multi-model router. Where Mode C is a fixed V4→Luna pipeline, Mode R classifies each request and picks a tier:

```
request
  │
  ├─ classify (V4 default; GLM intermediate; Luna high-risk/architecture)
  │
  ├─(if repo unfamiliar)──▶ v4/explorer (cheap recon)
  ├─(if external facts needed)──▶ v4/researcher
  │
  ├─ normal / non-trivial ──▶ v4/build → (v4/tester|v4/reviewer)
  ├─ complex-but-conventional ──▶ (v4/planner) → glm/build → (glm/tester|glm/reviewer)
  ├─ architecture / security / critical ──▶ v4/planner → luna/build | luna/architect
  │                                                          → luna/security-review (security)
  │
  ├─(builder returns ESCALATE)──▶ inspect contract → next tier (bounded)
  │     V4 → GLM (complexity/debug) | Luna (architecture/security/critical)
  │     GLM → Luna (final tier)
  │     BLOCKED → report BLOCKED; never loop
  │
  └─▶ report (## Routed result)
```

Rules (also see ROUTING.md):

- **Planning is conditional**: never `route → planner → builder` unconditionally. Simple/normal tasks skip the planner. Planner tokens are only spent where the target tier (GLM/Luna) will actually use the contract.
- **Bounded escalation**: one cross-model step after the first builder, one after GLM; the path terminates in `SUCCESS` or `BLOCKED`. No V4→GLM→V4→GLM, V4→GLM→Luna→GLM, or other recursion.
- **Escalation contract is the interface**: the router reads the builder-emitted contract (`docs/ESCALATION.md`) and routes by `REASON`/`SEVERITY`; it never invents a second protocol.
- **Handoff discipline**: the router forwards compact contracts/failure packets only — never its own reasoning or prior transcripts.
- **dual/orchestrator is not part of routing**: selecting `route/orchestrator` routes among V4/GLM/Luna specialists; the fixed `dual/*` pipeline remains a separate manual high-assurance workflow.

## 6. Failure / recovery behavior

| Failure | Detection | Recovery |
|---|---|---|
| Planner contract conflicts with repo | Builder reports amend/reject | Orchestrator reads evidence, accepts amendment or re-plans once |
| Builder validation fails | Test/compiler output non-green | Orchestrator hands back to builder (or debugger) with the exact failure output |
| Debugger stuck (no hypothesis confirmed) | No reproduction in budget | Report the isolation results; escalate to reviewer to re-derive hypotheses |
| Reviewer returns CHANGES REQUIRED | Verdict | Orchestrator passes the review's concrete corrections back to the builder once |
| Security-review returns HIGH RISK | Verdict | Builder must address findings; pipeline blocks on security for that stage |
| Subagent exhausts steps | Forced text-only summary | Orchestrator uses the summary as a status report and decides next step |
| Luna unreachable / budget exceeded | API error / context full | Fall back to `v4/build` (Mode B) — same workflows exist on V4 |
| Orchestrator's own context grows | — | It delegates everything heavy; its own reads are targeted; harness compaction handles the rest |

**Boundedness invariant:** with `subagent_depth: 1`, only the primary can spawn; subagents cannot spawn. The orchestrator's allowlist names exactly 9 specialists. Therefore the worst-case delegation graph is: 1 primary → ≤9 leaves, one level deep. No uncontrolled recursion is possible.

## 7. Why the conductors run V4

The orchestrators' work is routing and synthesis — broad and cheap. Running it on V4 keeps orchestration economical, keeps judgment work (implementation, review, security) on the specialist tier, and keeps the conductor's own prefix small and cache-stable. It is also why both `dual/orchestrator` and `route/orchestrator` are **read-only and bash-restricted**: they have no reason to mutate or run commands, so they simply cannot.

## 8. Concurrency

All delegation is **sequential** by default: recon → research → plan → build → review. This is deliberate:

- The contract depends on research; the build depends on the contract; review depends on the build.
- Sequential handoff keeps each subagent's context clean (fresh session per specialist) and avoids the orchestrator juggling parallel transcripts.
- Parallel exploration across multiple subagents is possible only if a future version splits recon by concern (e.g., separate explorers for separate modules) — the current design favors reliability over latency.
