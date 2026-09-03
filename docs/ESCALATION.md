# Escalation Contract

One compact, machine-friendly protocol for describing handoffs between model families. Emitted by the single-model builders (`v4/build` and `glm/build`) when a task warrants out-of-family escalation; any future agent that needs to describe a cross-family handoff uses the same schema. A future multi-model router will consume this contract to decide routing — no routing exists yet.

## 1. Purpose

Each single-model builder is self-contained: it can do its own family's work and may call its own family's specialists. When a task genuinely needs a **different model family**, the builder must not fake its way through. Instead it finishes with its best validated state and emits the escalation contract **describing** what an orchestrator may do later. The contract is:

- **Compact** — a fixed field set, no narrative, no pricing, no scheduling, no telemetry.
- **Deterministic** — fixed enums, so routing decisions are cheap and unambiguous.
- **Not a routing call** — emitting `ESCALATE` does not spawn a cross-model agent. It records the handoff point.

## 2. Schema

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

## 3. Field semantics

| Field | Values | Meaning |
|---|---|---|
| `STATUS` | `CONTINUE` | The emitting agent completed; no out-of-family handoff is needed. `TARGET` must be `NONE`. |
| | `ESCALATE` | A different model family is the correct next step. Fill `TARGET`, `REASON`, `SEVERITY`, evidence. |
| | `BLOCKED` | Cannot proceed and no model-family handoff resolves it (missing credentials, impossible requirement, destructive ambiguity). Stop and report. |
| `TARGET` | `NONE` / `V4` / `GLM` / `LUNA` | The model family recommended to continue. Only meaningful when `STATUS: ESCALATE`. |
| `REASON` | see enum | Why escalation is warranted. One primary reason; add a second only if genuinely co-equal. |
| `SEVERITY` | `LOW` / `MEDIUM` / `HIGH` / `CRITICAL` | Impact if the task is not escalated correctly. `CRITICAL` = security or data-loss surface. |
| `EVIDENCE` | bullets | Concrete, verifiable observations: exact error text, `file:line`, commands run, output excerpts. Never chain-of-thought or full transcripts. |
| `LAST_VALIDATION` | `command:` + `result:` | The most recent validation attempt and its observed outcome, even if it failed. Required when `ESCALATE` or `BLOCKED`. |
| `RECOMMENDED_HANDOFF` | bullets | Minimum information for the receiving model: original task, current state, changed files, exact validation failure, escalation reason, constraints. No prose padding. |

## 4. Reason → target guidance

| Reason | Typical target | Why |
|---|---|---|
| `ARCHITECTURE` | `LUNA` | Deep design analysis benefits from the strongest reasoning model. |
| `DEBUGGING` | `LUNA` | Difficult root-cause work benefits from deep reasoning. |
| `SECURITY` | `LUNA` | Security-sensitive review/implementation on the highest-confidence model. |
| `COMPLEXITY` | `LUNA` | Task complexity exceeds the emitting model's reliable depth. |
| `REPEATED_FAILURE` | `LUNA` | Multiple failed validation attempts warrant a fresh, stronger model. |
| `CONTEXT_LIMIT` | `NONE` (report) | The agent is out of context; compact the session / hand to a fresh session of the same or another family, not a routing fix. |
| `MODEL_UNCERTAINTY` | `V4` | Unverifiable from repo + no web on this model; V4 can research (when web is available). |
| `EXTERNAL_DEPENDENCY` | `V4` | External API/framework/dependency behavior unknown; V4 research resolves it. |
| `QUALITY_REVIEW` | `LUNA` | A high-confidence final review is required before the work is considered done. |

These are defaults, not a routing algorithm. A future router combines the contract with cost, availability, and cache state — none of that lives here.

## 5. Handoff discipline

The contract exists to keep cross-model handoff as cheap as a fresh-session start. It therefore enforces the repository's existing context-efficiency architecture:

**Pass only:**
- original task;
- relevant implementation contract (see ORCHESTRATION.md §2) if one exists;
- current state (done / partial / failing);
- changed files;
- exact validation failure and relevant error output;
- escalation reason and severity;
- relevant constraints.

**Never pass:**
- chain-of-thought;
- full previous transcripts;
- irrelevant tool history;
- complete exploratory logs;
- large redundant repository dumps.

If the emitter has more context than the contract fields allow, it is the **router's/orchestrator's** job to decide whether a specialist needs more — not the emitter's job to dump it into the contract.

## 6. Relationship to the implementation contract

The **implementation contract** (planner → builder, within and across families) tells a builder *what to build*. The **escalation contract** (this document) tells a router *who should act next and why*. They are complementary:

- A planner/builder handoff uses the implementation contract.
- A builder stuck or routed-out uses the escalation contract.
- Both are compact; neither carries reasoning transcripts.
