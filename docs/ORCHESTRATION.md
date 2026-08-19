# Orchestration

How the system decides who does what, when — deterministically, with bounded fan-out and no uncontrolled recursion.

## 1. Deterministic escalation rules

The primaries (`luna/build`, `v4/build`, `dual/orchestrator`) follow explicit escalation rules. The same task shape always maps to the same delegation plan. **Specialists are never invoked en masse** — each escalation adds only the agents the task shape requires.

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

## 3. Mode C pipeline (two-model)

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

## 4. Failure / recovery behavior

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

## 5. Why orchestration is V4

The orchestrator's work is routing and synthesis — broad and cheap. Running it on V4 keeps Mode C economical, keeps judgment work (implementation, review) on Luna, and keeps the orchestrator's own prefix small and cache-stable. It is also why the orchestrator is **read-only and bash-restricted**: it has no reason to mutate or run commands, so it simply cannot.

## 6. Concurrency

All delegation is **sequential** by default: recon → research → plan → build → review. This is deliberate:

- The contract depends on research; the build depends on the contract; review depends on the build.
- Sequential handoff keeps each subagent's context clean (fresh session per specialist) and avoids the orchestrator juggling parallel transcripts.
- Parallel exploration across multiple subagents is possible only if a future version splits recon by concern (e.g., separate explorers for separate modules) — the current design favors reliability over latency.
