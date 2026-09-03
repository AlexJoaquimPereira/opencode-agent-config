# Permissions

Least-privilege rationale for every permission block in the harness. Permission keys follow OpenCode's documented syntax; actions are `allow` / `ask` / `deny`. Rules are evaluated in order with **last-match-wins** — so every allowlist is written as a catch-all `*: deny` first, then specific allows.

## 1. Principles

1. **A role's permissions match its contract.** Read-only agents cannot edit; researchers cannot edit; reviewers cannot edit; only builders and debuggers can modify files.
2. **Web is a capability, not a default.** Luna agents deny web by hard requirement. GLM agents allow web where the role benefits (repo-first), with `glm/explorer` repo-only by design. V4 research/planning agents allow it; V4 repo agents, the router, and Luna deny it to protect context and cache prefixes.
3. **Shell is the riskiest surface.** It is allowed broadly only where the role genuinely needs it (builders, debuggers, testers), and even there, destructive patterns are gated to `ask` and dangerous ones to `deny`.
4. **Delegation is whitelisted.** Every primary's `task` permission denies everything except its explicit specialist set; every subagent denies task entirely (they never spawn agents).
5. **Bounded steps.** `steps` caps agentic iterations so runaway loops are structurally impossible.

## 2. Permission blocks by role

### Builders (`luna/build`, `v4/build`, `glm/build`)

```yaml
permission:
  read: allow
  edit: allow
  glob: allow
  grep: allow
  list: allow
  lsp: allow
  todowrite: allow
  bash:
    "*": allow
    "git push*": ask
    "git reset --hard*": ask
    "git clean*": ask
    "rm -rf*": ask
    "sudo*": deny
  webfetch: deny        # luna/build only; v4/build + glm/build: allow
  websearch: deny       # luna/build only; v4/build + glm/build: allow
  task:
    "*": deny
    "<specialist>": allow   # only its namespace's specialists
```

**Rationale:** full implementation power, but pushes are ask-first and destructive commands require confirmation. Luna, V4 and GLM builders add `external_directory: /tmp/*: allow` for temporary work. `v4/build` and `glm/build` flip only webfetch/websearch to `allow`, because they may research when repo evidence is insufficient; `luna/build` keeps them denied. Cross-family escalation is **described** via the escalation contract (docs/ESCALATION.md), never routed through `task` — builders only ever call their own family's specialists.

### Read-only specialists (explorers, planners, architects, researchers)

```yaml
permission:
  read: allow
  glob: allow
  grep: allow
  list: allow
  lsp: allow            # explorers only
  edit: deny
  todowrite: deny
  webfetch: deny        # except v4/planner, dual/v4-planner, v4/researcher, dual/v4-researcher, glm/researcher, glm/architect → allow
  websearch: deny       # (same exceptions)
  bash:
    "*": deny
    "git log*": allow
    "git status*": allow
    "git show*": allow
    "git ls-files*": allow
    "git grep*": allow
    "rg *": allow
    "ls *": allow
  task:
    "*": deny
```

**Rationale:** these agents build understanding; they never mutate. Bash is limited to git read-only plus `rg`/`ls` for symbol search. This prevents any write path while allowing normal exploration. Web is allowed only on the research/planning roles that need it (`v4/researcher`, `dual/v4-researcher`, `v4/planner`, `dual/v4-planner`, `glm/researcher`, `glm/architect`); repo-only explorers (all families) and Luna deny web.

### Reviewers & security reviewers (incl. `glm/reviewer`, `glm/security-review`)

```yaml
permission:
  read: allow
  glob: allow
  grep: allow
  list: allow
  edit: deny
  webfetch: deny        # luna/*, dual/luna-reviewer → deny; v4/* and glm/* reviewers/security → allow
  websearch: deny       # (same)
  bash:
    "*": deny
    "git diff*": allow
    "git show*": allow
    "git log*": allow
    "git status*": allow
    "git grep*": allow
    "npm run*": allow
    "npm test*": allow
    "npx *": allow
    "yarn *": allow
    "pnpm *": allow
    "go test*": allow
    "cargo test*": allow
    "pytest*": allow
    "python *": allow
    "make*": allow
    "mvn*": allow
    "gradle*": allow
    "rg *": allow
  task:
    "*": deny
```

**Rationale:** reviewers verify behavior by running tests and inspecting diffs, but never change source. V4 reviewers may additionally fetch CVE/advisory data (`v4/security-review`).

### Debuggers (incl. `glm/debugger`)

```yaml
permission:
  read: allow
  edit: allow            # to apply the root-cause fix
  glob: allow
  grep: allow
  list: allow
  lsp: allow
  todowrite: allow
  bash:
    "*": allow
    "git push*": deny
    "sudo*": deny
  webfetch: deny         # luna/debugger → deny; v4/debugger, glm/debugger → allow (unfamiliar libs)
  websearch: deny        # (same)
  task:
    "*": deny
```

**Rationale:** debugging requires running code, reproducing failures, and editing a fix. The `deny`-only exceptions block irreversibly dangerous commands. Luna's debugger never uses the web; V4's and GLM's may look up unfamiliar-library semantics when the runtime/repo cannot explain them.

### Testers (incl. `glm/tester`)

```yaml
permission:
  read: allow
  edit:
    "*": deny
    "*test*": allow
    "*spec*": allow
    "test/*": allow
    "tests/*": allow
    "__tests__/*": allow
    "*.test.ts": allow
    "*.test.tsx": allow
    "*.test.js": allow
    "*.test.jsx": allow
    "*.test.py": allow
    "*_test.go": allow
  glob: allow
  grep: allow
  list: allow
  bash:
    "*": allow
    "git push*": deny
    "sudo*": deny
  webfetch: deny         # luna/tester → deny; v4/tester, glm/tester → allow
  websearch: deny        # (same)
  task:
    "*": deny
```

**Rationale:** testers validate and may write/strengthen **tests only**. The edit object is an explicit allowlist of test-file patterns with a catch-all deny, so a tester cannot accidentally modify production source. V4's and GLM's testers may consult test-framework docs online when the repo does not demonstrate the API; Luna's never uses the web.

### `dual/orchestrator` (Mode C)

```yaml
permission:
  read: allow
  glob: allow
  grep: allow
  list: allow
  lsp: allow
  edit: deny            # the orchestrator never edits; builders do
  todowrite: allow
  webfetch: deny        # research is delegated, not self-served
  websearch: deny
  bash:
    "*": deny
    "git log*": allow
    "git status*": allow
    "git diff*": allow
    "git show*": allow
    "ls *": allow
  task:
    "*": deny
    "v4/explorer": allow
    "dual/v4-researcher": allow
    "dual/v4-planner": allow
    "luna/build": allow
    "luna/debugger": allow
    "luna/tester": allow
    "luna/reviewer": allow
    "luna/security-review": allow
    "dual/luna-reviewer": allow
```

**Rationale:** the Mode C conductor coordinates and verifies by reading; it never mutates the repo, never runs arbitrary commands, and never researches directly. All execution, validation, and research is delegated to its fixed dual-set of specialists. Its own context stays small and cache-friendly (see CACHE-STRATEGY.md). Its allowlist contains no GLM agents — the dual workflow is V4/Luna only.

### `route/orchestrator` (Mode R) — the only cross-family router

Same read-only shape as `dual/orchestrator`, but its `task` allowlist spans the full v4/glm/luna specialist surface because it is the single owner of cross-model routing:

```yaml
permission:
  read: allow
  glob: allow
  grep: allow
  list: allow
  lsp: allow
  edit: deny            # the router never edits; builders do
  todowrite: allow
  webfetch: deny        # research is delegated, not self-served
  websearch: deny
  bash:
    "*": deny
    "git log*": allow
    "git status*": allow
    "git diff*": allow
    "git show*": allow
    "git ls-files*": allow
    "git grep*": allow
    "ls *": allow
  task:
    "*": deny
    "v4/explorer": allow
    "v4/researcher": allow
    "v4/planner": allow
    "v4/build": allow
    "v4/debugger": allow
    "v4/tester": allow
    "v4/reviewer": allow
    "v4/security-review": allow
    "glm/explorer": allow
    "glm/researcher": allow
    "glm/architect": allow
    "glm/build": allow
    "glm/debugger": allow
    "glm/tester": allow
    "glm/reviewer": allow
    "glm/security-review": allow
    "luna/explorer": allow
    "luna/architect": allow
    "luna/build": allow
    "luna/debugger": allow
    "luna/tester": allow
    "luna/reviewer": allow
    "luna/security-review": allow
```

**Rationale:** the router coordinates across model families by reading; it never mutates the repo, runs arbitrary commands, or researches directly. Every execution/validation/research step is delegated to a specialist that matches the chosen tier. None of those specialists may themselves call another family, so cross-model recursion is structurally impossible; the router's own context stays small and cache-friendly.

## 3. Cross-cutting guarantees

- **No agent may spawn agents except the primaries**, and each primary only spawns its own allowlist: `luna/build` → `luna/*`; `v4/build` → `v4/*`; `glm/build` → `glm/*`; `dual/orchestrator` → its dual set; `route/orchestrator` → any v4/glm/luna specialist. With `subagent_depth: 1` (the default), agent trees are strictly one level deep — no recursion, no fan-out beyond the allowlists. **Only `route/orchestrator` has a cross-family task path**, and none of the specialists it calls may themselves call another family, so cross-model recursion (GLM → Luna → GLM, …) is structurally impossible.
- **Luna never touches the web** in any mode: all seven `luna/*` agents and `dual/luna-reviewer` deny both webfetch and websearch.
- **GLM web is role-appropriate**: `glm/build`, `glm/researcher`, `glm/architect`, `glm/debugger`, `glm/tester`, `glm/reviewer`, `glm/security-review` allow web (repo-first, restricted per role); `glm/explorer` denies web (repo-only, mirroring `v4/explorer`).
- **The router and dual conductor never touch the web**: both `route/orchestrator` and `dual/orchestrator` deny websearch/webfetch (research is delegated).
- **Edits are confined to role**: builders/debuggers freely, testers only on test-file patterns, everyone else never.
- **External directory access** (`external_directory`) defaults to `ask`; builders and debuggers pre-allow `/tmp/*` for scratch work. Project worktrees are inside the worktree anyway.
- **Cross-family escalation is contractual, then routed centrally**: builders emit the escalation contract (docs/ESCALATION.md) in their output to describe a handoff; only `route/orchestrator` may act on it.

## 4. Verifying permissions

```bash
opencode debug agent luna/build
opencode debug agent dual/orchestrator
opencode debug agent route/orchestrator
opencode debug agent v4/researcher
opencode debug agent glm/build
opencode debug agent glm/researcher
opencode debug agent glm/reviewer
opencode debug agent glm/security-review
```

The resolved permission list printed by `debug agent` reflects the effective allow/ask/deny per key — use it to confirm any agent's surface before trusting it.
