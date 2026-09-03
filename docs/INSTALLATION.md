# Installation

## 1. Prerequisites

- **OpenCode 1.18.x** (the harness was validated against 1.18.18). Any recent OpenCode V2 with markdown agents, permissions, `task` delegation, and `subagent_depth` works.
- **Providers configured** in `opencode.json`:
  - `openrouter` provider with the three harness models:
    - `openai/gpt-5.6-luna`
    - `deepseek/deepseek-v4-flash` (any recent dated build)
    - `z-ai/glm-5.3-flash`
  - Set your preferred context/output limits and provider pinning per OpenCode's provider config.
- **Optional**: observability and caching plugins (e.g., prompt-cache metrics, DeepSeek thinking preservation) — the harness is designed around their presence (see CACHE-STRATEGY.md) and degrades gracefully if some are absent.
- **Optional**: `OPENCODE_ENABLE_EXA=1` or an OpenCode-provider session if you want the `websearch` tool actually available to V4 research agents. Without it, V4 agents still work — `webfetch` remains usable, and research falls back to fetching known official URLs.

## 2. Install the harness

Copy the tree so that the **agents** land under OpenCode's global agent directory and the **docs** land outside it (any `.md` inside the agents dir would be parsed as an agent):

```bash
# from a checkout of this harness
cp -r agents ~/.config/opencode/agents/
cp -r docs ~/.config/opencode/docs/
cp README.md ~/.config/opencode/README.md
```

Resulting layout:

```
~/.config/opencode/
├── README.md
├── docs/
└── agents/
    ├── luna/   (7 agents)
    ├── v4/     (8 agents)
    ├── glm/    (4 agents)
    └── dual/   (4 agents)
```

No merge needed if these names don't already exist; if you have an existing `agents/` dir, copy only the `luna/`, `v4/`, `glm/`, `dual/` subdirectories.

## 3. Verify discovery and frontmatter

```bash
# agent lookup (should return JSON with mode/model/permission, no parse errors)
opencode debug agent luna/build
opencode debug agent v4/build
opencode debug agent glm/build
opencode debug agent glm/reviewer
opencode debug agent dual/orchestrator
opencode debug agent luna/reviewer
opencode debug agent dual/luna-reviewer

# full list of discovered agents
opencode agent ls
```

Each command should print a resolved agent config. Any frontmatter error surfaces here.

## 4. Verify the key invariants

1. **No web on Luna**: `opencode debug agent luna/build` → permission list must contain `webfetch → deny` and `websearch → deny`. Check all 7 `luna/*` agents + `dual/luna-reviewer`.
2. **No web on GLM**: `opencode debug agent glm/build` → `webfetch → deny`, `websearch → deny`. Check all 4 `glm/*` agents.
3. **Web on V4 researchers**: `opencode debug agent v4/researcher` → `webfetch → allow`, `websearch → allow`.
4. **Models**: `luna/*` → `openrouter/openai/gpt-5.6-luna`; `v4/*`, `dual/orchestrator`, `dual/v4-*` → `openrouter/deepseek/deepseek-v4-flash-0731`; `glm/*` → `openrouter/z-ai/glm-5.3-flash`.
5. **Delegation allowlists**: `debug agent` shows the `task` rules; confirm the catch-all `deny` precedes specific `allow`s (last-match-wins), and that `glm/build` only allows `glm/*` specialists (no cross-family task path).
6. **subagent_depth**: leave at the default `1` (or set `"subagent_depth": 1` explicitly in `opencode.json`). This keeps agent trees one level deep — no recursive spawning.

## 5. Smoke test each mode

In a scratch directory (e.g., a tiny Node repo with `src/math.js` and `test.js`):

```bash
# Mode A — Luna only
opencode run --agent luna/build --auto "Add a multiply function to src/math.js, export it, and verify with node test.js"

# Mode B — V4 only
opencode run --agent v4/build --auto "Add a subtract function to src/math.js, export it, and verify with node test.js"

# Mode D — GLM only
opencode run --agent glm/build --auto "Add an exponent function to src/math.js, export it, and verify with node test.js"

# Mode C — two-model
opencode run --agent dual/orchestrator --auto "Add a divide function to src/math.js, export it, extend test.js to verify it"
```

Successful behavior (verified against 1.18.x):

- Mode A: builder edits, runs `node test.js`, reports green.
- Mode B: same, with V4.
- Mode D: same, with GLM, web-free and GLM-only.
- Mode C: orchestrator delegates, Luna builder **verifies/amends** the contract (e.g., fixed an import path in the smoke test), implements, validates; orchestrator reports a structured result.

## 6. TUI usage

```bash
opencode
```

Press **Tab** to cycle primary agents: `luna/build` → `v4/build` → `glm/build` → `dual/orchestrator` → built-in `build`/`plan`. Pick the mode you want and start typing. Invoke subagents directly with `@luna/reviewer`, `@v4/researcher`, `@glm/reviewer`, etc.

## 7. Uninstall

```bash
rm -rf ~/.config/opencode/agents/luna ~/.config/opencode/agents/v4 ~/.config/opencode/agents/glm ~/.config/opencode/agents/dual
```

Docs and README can stay (they're documentation) or be removed with the same pattern.
