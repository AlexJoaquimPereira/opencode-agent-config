# Cost Metrics

How the harness measures tokens, cache, cost, success, and escalation — and how it turns raw telemetry into decisions-useful economics. The objective is **cost per successful task**, not price per million tokens.

## 1. Principles

- Prices are **accounting assumptions** in `config/model-pricing.json` (dated). They are never routing instructions and never appear in agent prompts.
- The economic objective is `expected cost per successful task` for a route.
- Telemetry is external measurement: it is stored append-only under `.telemetry/`, git-ignored, and never injected into model context.
- Success is defined objectively (tests/build/behavior), never by "looks good".

## 2. Pricing configuration

`config/model-pricing.json` holds, per model, the accounting rates:

| Model | Source | Rate notes (USD / 1M tokens) |
|---|---|---|
| DeepSeek V4 | DeepSeek direct, peak | cache_hit 0.014, input 0.44, output 1.32 |
| DeepSeek V4 | DeepSeek direct, off-peak | cache_hit 0.007, input 0.22, output 0.66 |
| DeepSeek V4 | OpenRouter (pinned model) | input 0.065, cache_read 0.016, output 0.18 (cache write billed at input) |
| GLM-5.3 Flash | OpenRouter (dated) | input 0.075, cache_read 0.015, output 0.25; not assumed permanent |
| GPT-5.6 Luna | OpenRouter ≤272k | input 0.20, cache_read 0.02, cache_write 0.25, output 1.20, web_search $10/1k calls |
| GPT-5.6 Luna | OpenAI Flex reference (≤272k) | input 0.10, cache_read 0.01, cache_write 0.125, output 0.60 |
| OpenRouter overhead | — | `credit_multiplier = 1.055` applied to the OpenRouter subtotal, explicit |

Luna web search is blocked in this harness, so normal sessions record `web_search_calls = 0`. Do not enable it.

## 3. Cost formulas

Per attempt:

```text
input_cost        = uncached_input_tokens × input_price          (per 1M)
cache_read_cost   = cached_input_tokens × cache_read_price       (per 1M)
cache_write_cost  = cache_write_tokens × cache_write_price       (per 1M)
output_cost       = output_tokens × output_price                 (per 1M)
web_search_cost   = web_search_calls × web_search_price          (per 1000 calls)
subtotal          = sum of the above
credit_fee        = subtotal × (credit_multiplier − 1)           (OpenRouter only)
total_attempt_cost = subtotal + credit_fee
```

Per task (sum across all attempts belonging to the task):

```text
task_cost = Σ total_attempt_cost over attempts(task_id)
```

`scripts/analyze-cost.mjs` implements these exactly. The V4 attempt + GLM escalation + Luna escalation example is one task cost, never a per-agent-only number.

## 4. Success-adjusted metrics

Computed separately by **model**, **agent**, **provider**, **task class**, **escalation reason**, and **routing path**:

```text
cost_per_attempt        mean total_attempt_cost
cost_per_success        task_cost for a task that ultimately succeeded
tokens_per_attempt      mean total_tokens
tokens_per_success      total_tokens of successful tasks
success_rate            successful tasks / tasks
escalation_rate         tasks that escalated ≥1 model family / tasks
average_turns           mean turn_count
average_tool_calls      mean tool_call_count
human_intervention_rate tasks requiring human intervention / tasks
```

The most important tables:

```text
V4 | GLM | Luna                      (per-model economics)
V4 → GLM | V4 → Luna | V4 → GLM → Luna   (route economics)
cost / successful task
tokens / successful task
```

All attempts of a task are accounted, including attempts on intermediate tiers.

## 5. Route-level economics

The analyzer compares:

```text
V4 only      vs  V4 → GLM   vs  V4 → Luna   vs  V4 → GLM → Luna
```

using **observed historical values** (no statistical prediction model yet):

```text
expected cost per successful task = cost(initial route) + P(escalation) × cost(escalated path)
```

Where the probabilities and costs are computed from recorded telemetry (`route` + `success` + `cost` per task). This is the basis for the later learned-routing phase.

## 6. Where data comes from

- `.telemetry/attempts.jsonl` — per model call: task_id, attempt_id, parent ids, agent, model, provider, token breakdown (input/cached/cache_write/output/reasoning/total), timestamps, status, escalation fields, human_intervention.
- `.telemetry/tasks.jsonl` — root sessions (task ids) with titles and timestamps.
- `benchmarks/results/*.jsonl` — objective PASS/FAIL/BLOCKED per (task, route) with wall time.

Costs are computed from token counts + `config/model-pricing.json` (not from the provider bill). The provider-reported `cost_reported_usd` is also captured when the runtime exposes it, for later reconciliation.

## 7. Running the analyzer

```bash
node scripts/analyze-cost.mjs                 # from a project with .telemetry/
node scripts/analyze-cost.mjs --json          # machine-readable
node scripts/analyze-cost.mjs --direct-deepseek  # price DeepSeek at first-party rates
node benchmarks/analyze.mjs                   # benchmark PASS/FAIL tables
```

## 8. Accounting assumptions disclaimer

These are assumptions used for **accounting**, not routing instructions. Real bills may differ; prices change and must be updated in `config/model-pricing.json` (update `as_of`), never in agent prompts.
