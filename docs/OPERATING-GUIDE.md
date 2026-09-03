# Operating Guide

Day-to-day usage, failure/recovery, and how to extend the harness.

## 1. Choosing a mode

| Situation | Mode | Primary |
|---|---|---|
| Default, highest-quality work | A | `luna/build` |
| Cheap/fast iteration, or lots of recon | B | `v4/build` |
| Complex feature, large change, or you want planning+review discipline | C | `dual/orchestrator` |
| You're not sure | C | `dual/orchestrator` |
| Cheap/fast, self-contained, no-web workflow | D | `glm/build` |
| Adaptive routing across models, or you want V4→GLM→Luna escalation | R | `route/orchestrator` |

In the TUI, press **Tab** to cycle primaries. For scripted runs: `opencode run --agent <primary> "…"`.

Each single-model primary (`luna/build`, `v4/build`, `glm/build`) runs its own model only, and its specialists stay within the family. `route/orchestrator` is the only agent that routes across model families automatically (V4 default, GLM intermediate, Luna high-assurance); `dual/orchestrator` is a separate deterministic V4→Luna path. When a single-model builder hits work that warrants another family, it reports an **escalation contract** (docs/ESCALATION.md); under `route/orchestrator` that contract drives the next route, otherwise you pick the next model manually.

## 2. Writing good requests

The harness behaves like an engineering org, so the request quality matters:

- **State the outcome and the evidence**, e.g. "Add pagination to `src/api.js`; all 12 existing tests must stay green." 
- **Mention constraints that matter**: public API compatibility, no new dependencies, style, performance.
- **Leave implementation details to the builder** — the system inspects the repo before deciding.
- **One request per run** works best for Mode C; the pipeline is sequential by design.

Project-specific behavior (lint commands, test commands, architecture rules, conventions) belongs in the **project's `AGENTS.md`**, not in these global agents. The harness reads and honors it automatically.

## 3. Reading the outputs

- **Mode A/B/D**: the builder reports what it changed, what it validated, and any residuals (per its prompt's report format). If a V4 or GLM builder finished with an **escalation contract** block (`STATUS: ESCALATE`/`BLOCKED`, `TARGET`, reason, evidence), that is a handoff record: under `route/orchestrator` it drives the next route automatically; run standalone, read it and pick the next model manually.
- **Mode C**: the orchestrator returns a structured `## Orchestrated result` summarizing each stage, the contract (or its amendment), validation evidence, and the reviewer verdict.
- **Mode R**: the router returns a structured `## Routed result` summarizing the tier chosen, the path taken (including any escalation), the builder's evidence, and residual risks.
- **Subagent verdicts**: reviewers return `APPROVED` / `APPROVE WITH CHANGES` / `CHANGES REQUIRED`; security returns `CLEAN` / `REVIEW RECOMMENDED` / `HIGH RISK`; the acceptance reviewer returns `ACCEPT` / `ACCEPT WITH CHANGES` / `REJECT`.

## 4. Failure / recovery

Built-in recovery (also see ORCHESTRATION.md §6):

- **Planner contract conflicts with the repo** → the builder amends or rejects it; the orchestrator/router adjudicates with a targeted read and re-plans at most once.
- **Validation fails** → the orchestrator hands the exact failing output back to the builder (or debugger) once. Under `route/orchestrator`, repeated failure triggers a bounded route to the next tier (V4→GLM→Luna).
- **Reviewer demands changes** → corrections are passed back to the builder once. If still red, report to you rather than looping.
- **Security HIGH RISK** → pipeline blocks that stage; builder must address findings.
- **Subagent step exhaustion** → returns a text-only summary; orchestrator treats it as a status report.
- **Router escalation**: builders emit the escalation contract; the router escalates at most one tier per stage (V4→GLM, GLM→Luna, or V4→Luna) and reports `BLOCKED` instead of looping when no further tier helps.

Human interventions that always work:

- Interrupt with **Esc/Ctrl-C** in the TUI; type corrective context and continue.
- `@mention` a subagent directly to force a specific role (users can always invoke any subagent, even if an orchestrator's allowlist would deny it).
- **Fall back to another mode**: if Luna is unavailable/over-budget, use `v4/build` or `glm/build`; the single-model workflows mirror each other. Prefer `dual/orchestrator` for the fixed V4→Luna path or `route/orchestrator` for adaptive routing.

## 5. Working across repositories

Nothing in the harness is project-specific:

- Agents use only generic tools (read/glob/grep/list/lsp/bash/git/task) and repo-relative paths.
- Build/test commands are discovered per-repo (from `AGENTS.md`, package manifests, makefiles, CI config) rather than hardcoded.
- The implementation contract references file paths discovered during recon, not preset paths.
- If a repo's `AGENTS.md` adds conventions or commands, every agent in this harness respects it — the global prompts never override project rules.

## 6. Observability

- `opencode debug agent <id>` — inspect any agent's resolved permissions/model/steps.
- Prompt-cache observability metrics (if a plugin is installed) — hit rates per session.
- Provider usage reporting — token/credit usage per provider.
- `opencode session` list + child-session navigation (Leader+Down / Right / Left / Up) to inspect subagent work.

## 7. Extending the harness

### Add a new specialist

1. Create `agents/<namespace>/<name>.md` with frontmatter: `description`, `mode: subagent`, `model`, `steps`, and a least-privilege `permission` block (start from a sibling specialist's block).
2. Keep the prompt under ~50 lines: responsibility, workflow, output format, explicit "do not…" rules.
3. Add it to the **primary's `task` allowlist** that should call it (append `"<id>": "allow"` after the `"*": "deny"` rule).
4. `opencode debug agent <new-id>` to validate.
5. Update `docs/AGENT-MATRIX.md`.

### Add a new primary / mode

Follow the pattern of `dual/orchestrator` or `route/orchestrator`: `mode: primary`, read-only or full per its role, with an explicit `task` allowlist and `steps`. Document the new pipeline in `docs/ORCHESTRATION.md` and add a routing row in `docs/ROUTING.md` if the primary is a router.

### Tune an existing agent

- **Depth vs speed**: Luna agents can set/raise `reasoning_effort`; V4 and GLM agents can adjust `temperature` (0.2 deterministic, 0.3 research for V4).
- **Aggression**: raise/lower `steps`. Lower for cost control (e.g., `luna/explorer` at 30 is deliberately conservative).
- **Safety**: strengthen `bash` guards (e.g., add `"git commit*": ask` to builders if you want an approval gate before commits).

### Project-level overrides

Never edit global agents for a single repo. Use the project's `AGENTS.md` (generated by `/init` or written by hand) for:

- Test/lint/build command conventions.
- Architecture constraints and invariants.
- Style rules, commit conventions, CI workflows.
- Domain knowledge the harness cannot infer.

The global harness intentionally stays generic so it remains reusable across unrelated repositories.

## 8. Operational notes

- **Agent IDs are path-prefixed**: `luna/build`, `v4/researcher`, `glm/build`, `dual/orchestrator`, `route/orchestrator`. Use full IDs in `@mentions` and task rules.
- **Do not add README/docs inside `agents/`** — any markdown there becomes an agent.
- **Keep `subagent_depth` at 1** unless you explicitly want deeper trees (you probably don't).
- **Orchestrators never edit** — if you need direct file changes in Mode C/R, they happen inside the chosen builder (`luna/build`, `v4/build`, `glm/build`). This is by design (read-only conductors).
- **Web usage is the exception, not the rule**: V4 researchers use it when repo evidence is insufficient; Luna and GLM never use it.
- **Single-model families never route cross-family** — builders emit an escalation contract instead; `route/orchestrator` is the single owner of cross-model routing. `dual/orchestrator` is a separate fixed V4→Luna path.
