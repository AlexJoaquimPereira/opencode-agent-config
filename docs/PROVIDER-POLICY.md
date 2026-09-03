# Provider Policy

How the harness separates **task routing** (which model), **model agents** (which agent), and **provider selection** (which upstream). Provider selection is a static, session-level configuration concern — it is never decided by the router or by agent prompts.

## 1. Three-layer architecture

| Layer | Owner | Decides |
|---|---|---|
| Task routing | `route/orchestrator` | which model family: V4 / GLM / Luna |
| Model agent | `v4/*`, `glm/*`, `luna/*`, `dual/*` | the concrete agent and its workflow |
| Provider selection | `opencode.json` + OpenRouter static config | which upstream provider serves the chosen model |

A model agent must **not** select an OpenRouter provider. The router must **not** select an OpenRouter provider. OpenRouter must **not** silently fall back to another provider. This is a hard cache-stability invariant: switching the upstream provider mid-session would invalidate the prompt cache and destabilize the prefix.

## 2. Router layer

`route/orchestrator` chooses the **model family** only (`V4`, `GLM`, or `Luna`) per the routing matrix in `docs/ROUTING.md`. It never:
- selects, reorders, or switches an OpenRouter provider during a task;
- performs automatic provider failover;
- inspects provider health to switch providers mid-session;
- enables OpenRouter fallbacks.

A transient model/API failure is treated as a **task/runtime failure**, not as permission to silently move the task to another provider. Recovery is retry on the same provider or an explicit user decision.

## 3. OpenRouter layer (static configuration)

The provider is chosen by the static `opencode.json` config, exactly as currently configured:

```jsonc
// opencode.json (openrouter.models.*.options.provider)
"openai/gpt-5.6-luna":      { "only": ["openai/flex", "azure", "openai"], "allow_fallbacks": false }
"deepseek/deepseek-v4-flash-0731": { "sort": "price", "allow_fallbacks": false }
"z-ai/glm-5.3-flash":       { "sort": "price", "allow_fallbacks": false }
```

Intended policy summary:

| Model | Provider selection | Fallback |
|---|---|---|
| DeepSeek V4 | `sort = price` | `allow_fallbacks = false` |
| GLM-5.3 Flash | `sort = price` | `allow_fallbacks = false` |
| GPT-5.6 Luna | `only = [openai/flex, azure, openai]` | `allow_fallbacks = false` |

`allow_fallbacks: false` is preserved everywhere and must never be overridden by an agent prompt or the router.

## 4. Cache stability rule

- **Provider selection is a session-level concern.** A single OpenCode task/session stays on the provider selected by the static configuration at session start.
- **Do not switch provider during a session.**
- **Do not retry the same task through another OpenRouter provider merely to recover from latency/errors.**

## 5. Price-sorting caveat

`sort: price` is intentional for DeepSeek and GLM because provider price matters. But actual economic optimization is **not** nominal price:

```text
effective cost
≈ cache-read cost
+ uncached input cost
+ output cost
+ token consumption
+ failure/retry cost
```

A "cheaper listed provider" is not necessarily the cheapest real provider once cache economics and reliability are included. The benchmark/telemetry system (see `docs/COST-METRICS.md`) will later determine whether `sort: price` remains optimal for the workload. A dynamic replacement for `sort: price` is **not** implemented and must not be added yet.

## 6. Pricing assumptions

All token prices used for accounting are **assumptions**, stored only in `config/model-pricing.json`, dated, and documented as accounting inputs — never as routing instructions and never inside agent prompts. OpenRouter's prepaid-credit overhead is represented explicitly as `credit_multiplier = 1.055` rather than being silently baked into token prices.

## 7. Batch/off-peak direct DeepSeek

A separate, explicit batch path (`scripts/opencode-direct-deepseek.mjs`) targets the DeepSeek **first-party direct** provider outside IST weekday peak windows. It is for batch/background work only and does not affect interactive routing (see `docs/OPERATING-GUIDE.md` §Off-peak batch mode). Interactive sessions always use the configured OpenRouter path and never change providers by clock time.

## 8. Web access by provider

Web capability is a model/agent permission, not a provider property:

- **Luna**: web denied everywhere (hard requirement), regardless of provider.
- **GLM**: web allowed where the role benefits (repo-first); `glm/explorer` is repo-only.
- **V4**: existing policy unchanged (researchers/planners/builders may use web).
- **Router** and **dual conductor**: web denied (research is delegated).
