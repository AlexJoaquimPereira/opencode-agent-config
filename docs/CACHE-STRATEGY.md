# Cache Strategy

How the harness is designed to be cache-friendly for both DeepSeek V4 Flash (via OpenRouter) and GPT-5.6 Luna (via OpenRouter/OpenAI), and how it cooperates with existing observability/caching plugins rather than duplicating them.

## 1. What the platform already does (verified)

- **DeepSeek prompt caching**: automatic, disk-based, no config. A request whose prefix fully matches a previously seen "prefix unit" (Sliding Window Attention) gets a cache hit for that unit. Hits/misses are reported as `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`. Best-effort; evicted after hours-days idle.
- **OpenRouter caching for DeepSeek**: automated. Cache reads are 0.1× input price; cache writes are charged at input price.
- **OpenRouter caching for OpenAI GPT-5.6+ (Luna)**: automatic; cache writes cost 1.25× input, reads 0.25×–0.5×; minimum cacheable prompt ~1024 tokens.
- **Provider sticky routing**: after a cached request, OpenRouter routes same-model requests to the same provider endpoint to keep the cache warm (expires after ~10 min idle). When a config pins providers explicitly (`provider.order` / `provider.only`), explicit ordering takes priority.
- **Optional observability plugin**: a cache-observability plugin can hash the system+tools prefix, record hit-rate to a metrics file, and on session compaction append a `## Session digest (cache-stable continuation block)` with Goal / Decisions made / Pending / Active files. Such plugins **observe** — they do not rewrite history or tools.

**Consequence:** the agent layer does NOT need to implement caching, set cache TTLs, or manage `prompt_cache_breakpoint`/`prompt_cache_options`. What it must do is **keep the prefix stable** and **minimize avoidable churn**, so the automatic caches hit.

## 2. What the harness does to keep caches warm

1. **Stable system prompts.** Every agent has a fixed system prompt; nothing task-specific mutates it. The model + tools prefix is byte-stable across turns and across sessions of the same agent. This is the largest, most cacheable prefix (DeepSeek prefix units; OpenAI 1024-token minimum).
2. **Model-stable routing.** Each model is pinned to a single provider domain (`provider.order` / `provider.only`, no fallbacks) and every agent declares its model explicitly, so the same provider/model endpoint is hit repeatedly → sticky routing keeps the cache warm, and no fallback provider breaks prefix continuity.
3. **Namespaced, per-role prefixes.** Because `luna/*` and `v4/*` are separate agents with distinct prompts, each role has its own stable prefix; V4 research bursts don't pollute Luna's cache prefix and vice versa.
4. **One-shot research.** `v4/build`, `v4/researcher`, `dual/v4-researcher` do web research **once per task** and summarize compactly. No multi-round browsing that would fragment context.
5. **Fresh specialist sessions with compact results.** Subagent sessions are short and uniform per role, so their prefixes repeat session-to-session (high hit rate). Only the small result crosses back to the orchestrator.
6. **No mid-session prefix changes.** Agents don't append huge files, dump full diffs, or splice external transcripts into the middle of context — which would invalidate prefix-based caching.
7. **Bounded, non-repeating tool loops.** `steps` caps iteration; prompts forbid re-searching and re-reading unchanged files, so consecutive turns keep a stable, growing prefix (append-friendly for the cache) rather than re-fetching the same data.

## 3. Cache economics per model

| | V4 Flash | Luna |
|---|---|---|
| Cache read cost | 0.1× input | 0.25×–0.5× input |
| Cache write cost | 1× input | 1.25× input |
| Goal | Maximize hit rate on a stable prefix | Minimize cache-write volume near context limit |
| Harness contribution | Stable agent prefixes, one-shot research, fresh uniform specialist sessions | Dense, compact context (see TOKEN-EFFICIENCY.md); avoid growing context with stale tool output |

Luna's economics are the sharper constraint: near a configured hard context cap, cache writes are at a premium. The harness responds by making Luna sessions **information-dense and short**, not by pushing context toward its limit.

## 4. Interaction with optional plugins

- Cache-observability plugins own **hit-rate metrics** and any **compaction digest block**. The harness does not replicate either.
- If a plugin appends a digest on compaction, agents don't need to know about it — they just keep producing structured output, and the digest preserves goal/decisions/pending/active-files across the compacted boundary.
- A thinking-preservation plugin keeps V4 reasoning content across turns. The harness does nothing that would break that (it doesn't strip reasoning; agents' prompts don't forbid reasoning output).

## 5. Verification

Use a cache-observability plugin's metrics output (hit rate as read/(read+write)) and provider usage reporting to observe real hit-rates per session. Expected behavior:

- Consecutive sessions with the **same agent** (e.g., repeated `v4/build` runs) should show rising hit rates on the prompt/tool prefix.
- Mode C runs keep the orchestrator prefix stable and small; V4 planner/researcher prefixes stay uniform across runs.
- Luna runs should show comparatively small, dense contexts rather than sprawling ones.
