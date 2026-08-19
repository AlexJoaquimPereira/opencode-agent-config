# Token Efficiency

How the harness maximizes information density and minimizes context churn, so both models stay fast and cheap — and so the surrounding OpenCode compaction mechanism does the heavy lifting rather than duplicating it in every prompt.

## 1. Guiding principle

**The harness already compacts.** OpenCode auto-compacts long sessions (e.g. with `compaction.auto: true` and a `preserve_recent_tokens` budget). Agents must not re-implement compaction inside their prompts (no "summarize your history", no "forget earlier turns" rituals). Instead, agents are designed to **stay efficient before compaction ever triggers**: the cheaper the steady-state context, the later compaction fires and the less cache-write cost accumulates.

## 2. Where context goes and how we control it

| Context consumer | Mitigation |
|---|---|
| System prompts | Short, stable, per-role. Nobody restates the whole harness. |
| Repo exploration | Delegated to explorers that return **compact reports**, not file dumps. |
| File reads | `luna/build` reads **targeted ranges** and uses LSP/grep/glob before opening files; no full-file dumps for large sources. |
| Re-reading | The builder is told not to re-read unchanged files; it tracks what it has seen via its plan/todo, not by replaying history. |
| Subagent results | Pass **contracts and verdicts**, never transcripts. This is the single biggest win for Mode C. |
| Web research | One-shot, compact evidence packets (V4); Luna never fetches. |
| Repeated searches | Explorers do breadth-first, bounded searches once and return a structured map. |
| Planner reasoning | Discarded. Only the contract crosses the plan→build boundary. |
| Redundant review | Escalation rules pick the minimal reviewer set; not every task gets every reviewer. |

## 3. Design choices that cut tokens

1. **Fresh sessions per specialist.** Each subagent runs in a clean context (subagents get their own session), so the orchestrator's context never accumulates exploration transcripts — only one-paragraph results.
2. **Compact report schemas.** Every specialist has a fixed output shape (Explorer report, Evidence packet, Implementation contract, Validation report, Debug report, Verdict). The caller reads a schema, not a log.
3. **Bounded steps.** `steps` caps iterations (e.g., explorer 25–30, reviewer 35–40, builder 120–150). No agent can spin in a tool loop indefinitely, which is both a token and a reliability guard.
4. **Targeted tool use before broad tool use.** Grep/glob/LSP first; read the specific range; edit the minimal span. Prompts state this ordering explicitly.
5. **No file dumps, no full diffs for review.** Reviewers inspect `git diff` scoped to the change and trace behavior, rather than re-reading entire modules.
6. **Evidence-based stop.** Builders validate with the fastest meaningful check first (quick → targeted → full). They stop when the current validation tier satisfies the task; they don't run the full suite for every tiny change.
7. **Stable prompts.** Prompts are static per agent; only task-specific content flows through. This keeps the system prompt prefix stable (critical for caching — see CACHE-STRATEGY.md).

## 4. Luna-specific economics

Luna has a hard context limit and auto-compaction, and **cache-write cost as context approaches its limit** is a primary concern. Therefore:

- **Design for high information density before compaction**, not maximum context utilization. A Luna agent that finishes a task in 40k dense tokens beats one that used 120k of comfortable-but-sparse context.
- **Minimize stale tool output.** `luna/build` is instructed to avoid dumping large tool results into context (e.g., use `grep`/`rg` on big outputs, `git diff --stat`, targeted reads).
- **Do not repeat historical information.** The builder never restates the task, the plan, or its own prior findings; it works from its todo list and file state.
- **Reasoning effort over verbosity.** Luna agents that need depth use `reasoning_effort: high` (cheap relative to wasted tool calls), while simpler roles use default/`medium`.

## 5. V4-specific economics

V4 is ~10x cheaper than Luna, so token efficiency there is about **latency and cache stability** more than money:

- Keep system + tool prefixes **identical across turns** (stable prefix → cache hits on DeepSeek).
- One-shot web research (at most once per task) instead of multi-search sessions.
- Compact evidence packets so the planner and builder don't pay to re-fetch.

## 6. Context pollution resistance

- The orchestrator never pulls planner reasoning into its context; it holds only the contract + verdicts.
- Read-only specialists never write, so their output is the only thing that leaks (and it's structured).
- `external_directory` defaults to `ask`, preventing accidental reads of unrelated trees that would bloat context.
- The `dual/v4-researcher` and `v4/researcher` only cite URLs they actually fetched, so downstream readers aren't chasing phantom references.

## 7. Anti-patterns the prompts explicitly forbid

- Restating the user request or the contract back to the user.
- Narrating each tool call ("Now I will read X...") — commentary is kept to findings.
- Re-exploring what an explorer already mapped.
- Invoking every specialist on every task.
- Passing full chat transcripts between agents.
- Re-reading unchanged files after an edit (only the edited ranges).

## 8. Compaction interaction

When compaction does fire, `preserve_recent_tokens` keeps the latest turn verbatim. Because agents avoid stale output and repetition, the compacted middle is small and lossless. A plugin-emitted "Session digest" continuation block can further keep cache-stable continuity across compaction — agents need no special handling for it; they just keep producing structured, dense output.
