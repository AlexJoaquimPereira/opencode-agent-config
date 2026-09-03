# Provider Policy

How each model family is served by a provider layer. This document defines provider *strategy* only. Automatic provider selection, benchmarking, scheduling, quantization, and price scraping are **not** implemented — they are later phases.

The harness runs models through provider layers configured in `opencode.json` (typically OpenRouter as the interactive layer). Agents declare `model` only; they never contain provider routing logic or prices.

## 1. DeepSeek V4

- **Role:** primary general implementation model (default workhorse).
- **Provider layer:** OpenRouter is the preferred interactive provider layer.
- **Selection basis (when provider choice is made):** effective cache cost, cache hit rate, output cost, latency, reliability, and quantization quality. Do not equate "cheapest listed provider" with "cheapest real provider": cache-read/write pricing and hit rates materially change effective cost.

## 2. GLM

- **Role:** difficult autonomous coding / intermediate escalation.
- **Provider layer:** OpenRouter.
- **Preference:** provider configurations with good effective cache economics and acceptable quality/latency.

## 3. Luna

- **Role:** high-risk, architecture, difficult reasoning, final escalation.
- **Provider path:** OpenAI Flex is the intended production path. Keep the existing OpenRouter Luna configuration available (it is already required by the current repository) — do not redesign it in this phase.
- **Constraints:** no web-search capability; existing Luna context optimization is preserved and unchanged.

## 4. Shared principles

- **No hard-coded prices** in agent prompts or routing logic. Providers and costs are configuration concerns, not agent concerns.
- **Cache economics matter.** Cache-read pricing and hit rates are first-order cost drivers; stable prefixes and cache-friendly context are designed for in CACHE-STRATEGY.md and TOKEN-EFFICIENCY.md.
- **No provider selection logic is implemented in this phase.** The routing matrix (ROUTING.md) decides *which model*; provider choice remains manual configuration until the later provider-optimization phase.
- **No web on Luna or GLM**, regardless of provider; only V4 research agents may use the web.

## 5. Out of scope

Automatic provider benchmarking, automatic quantization selection, automatic model price scraping, DeepSeek off-peak scheduling, direct DeepSeek launchers, time-zone logic, MiMo, and telemetry/cost dashboards. These are later phases and must not be introduced into agent prompts or this policy.
