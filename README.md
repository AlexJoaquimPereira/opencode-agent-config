# OpenCode Multi-Model Engineering Harness

A general-purpose, model-aware agent system for OpenCode V2 that runs on two models — **GPT-5.6 Luna** (deep implementation) and **DeepSeek V4 Flash** (fast planning/research) — independently or together.

The system behaves like a small software-engineering organization: builders, architects, explorers, debuggers, testers, reviewers, security reviewers, and a two-model orchestrator. It is reusable across arbitrary repositories with no project-specific customization. Project behavior belongs in the project's `AGENTS.md`, not here.

## Layout

```
<config-dir>/            ← e.g. ~/.config/opencode/ (global), or .opencode/ (per-project)
├── README.md            ← this file
├── docs/                ← design + operations documentation
│   ├── ARCHITECTURE.md
│   ├── AGENT-MATRIX.md
│   ├── MODEL-STRATEGY.md
│   ├── PERMISSIONS.md
│   ├── ORCHESTRATION.md
│   ├── TOKEN-EFFICIENCY.md
│   ├── CACHE-STRATEGY.md
│   ├── INSTALLATION.md
│   └── OPERATING-GUIDE.md
└── agents/              ← auto-discovered agent definitions
    ├── luna/            ← Mode A: Luna-only specialists
    │   ├── build.md             (primary)
    │   ├── architect.md
    │   ├── explorer.md
    │   ├── debugger.md
    │   ├── tester.md
    │   ├── reviewer.md
    │   └── security-review.md
    ├── v4/              ← Mode B: V4 Flash-only specialists
    │   ├── build.md             (primary)
    │   ├── planner.md
    │   ├── explorer.md
    │   ├── researcher.md
    │   ├── debugger.md
    │   ├── tester.md
    │   ├── reviewer.md
    │   └── security-review.md
    └── dual/            ← Mode C: two-model orchestration
        ├── orchestrator.md      (primary)
        ├── v4-planner.md
        ├── v4-researcher.md
        └── luna-reviewer.md
```

> **Placement note:** agents live under `agents/` because OpenCode discovers every `.md` file there as an agent. README and docs deliberately live **outside** `agents/` so they are not parsed as agents.

## Quick start

```bash
# pick your operating mode (Tab in the TUI, or --agent in run)
opencode            # then Tab → luna/build | v4/build | dual/orchestrator
opencode run --agent luna/build "…"
opencode run --agent v4/build "…"
opencode run --agent dual/orchestrator "…"
```

Three modes:

| Mode | Primary agent | Model | When |
|------|--------------|-------|------|
| A — Luna only | `luna/build` | GPT-5.6 Luna | Highest-quality implementation, no web access |
| B — V4 Flash only | `v4/build` | DeepSeek V4 Flash | Cheap and fast, occasional web research |
| C — Two-model | `dual/orchestrator` | V4 Flash conductor, Luna builder/reviewer | Best of both: V4 plans, Luna implements & verifies |

## Agent naming

Subdirectory agents get path-prefixed IDs: `luna/build`, `v4/planner`, `dual/orchestrator`. Primary agents are selected directly; subagents are invoked by primaries via the task tool (or by you with `@luna/reviewer` etc.).

## Documentation index

- **docs/ARCHITECTURE.md** — how the system is structured and why each agent exists.
- **docs/AGENT-MATRIX.md** — every agent: responsibility, model, tools, permissions, escalation.
- **docs/MODEL-STRATEGY.md** — why each model is assigned to each role; reasoning, cost, latency tradeoffs.
- **docs/PERMISSIONS.md** — least-privilege rationale for every permission block.
- **docs/ORCHESTRATION.md** — the two-model pipeline and deterministic escalation rules.
- **docs/TOKEN-EFFICIENCY.md** — how the agents stay context-lean and compaction-compatible.
- **docs/CACHE-STRATEGY.md** — DeepSeek + OpenRouter prompt-cache economics and stable prefixes.
- **docs/INSTALLATION.md** — prerequisites, install, config, verification steps.
- **docs/OPERATING-GUIDE.md** — day-to-day usage, failure/recovery, extension.

## Design principles

1. **Evidence over plausibility.** Compiler/test/runtime output is authoritative. No agent claims completion without validation evidence.
2. **Least privilege.** Read-only agents never edit; reviewers never edit; researchers never edit; builders hold full but guarded permissions.
3. **Deterministic escalation.** Primaries follow explicit escalation rules — no random agent proliferation, no uncontrolled recursive agent trees.
4. **Context discipline.** Focused reads, structured contracts instead of transcripts, no restating history. The harness's compaction handles context management; agents just stay efficient before it triggers.
5. **Model honesty.** Luna has no web permission by design. V4 researchers/web access is used only when repository evidence is insufficient.
