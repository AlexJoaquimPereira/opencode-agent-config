import type { Plugin } from "@opencode-ai/plugin"
import type { Event, Session } from "@opencode-ai/sdk"
import { mkdirSync, appendFileSync } from "node:fs"
import { join } from "node:path"

// ---------------------------------------------------------------------------
// opencode-telemetry
//
// Append-only, task/attempt telemetry for the multi-model harness.
//   - Captures per-attempt (assistant-message) token/cost/model/provider data
//     that the OpenCode runtime exposes on `message.updated`.
//   - Reconstructs the task tree from `session.created` parent links: a task is
//     the root session (no parent); attempts under it carry task_id + attempt_id
//     + parent_task_id.
//   - Writes two append-only JSONL stores under <project>/.telemetry/:
//       tasks.jsonl    (root sessions -> task ids)
//       attempts.jsonl (per model call)
//   - NEVER injects telemetry into model prompts. It only observes + records.
//
// Fields the runtime does not expose are recorded as null rather than guessed.
// Requires plugin auto-load (drop into the OpenCode plugins dir, e.g.
// ~/.config/opencode/plugins/) or a plugin entry in config. Best-effort: every
// handler is defensive and never throws into the session loop.
// ---------------------------------------------------------------------------

export const telemetry: Plugin = async ({ directory, worktree }) => {
  const root = directory || worktree || process.cwd()
  const telemetryDir = join(root, ".telemetry")

  // sessionID -> { parentID, agent?, title, created }
  const sessions = new Map<string, { parentID?: string; agent?: string; title?: string; created?: number }>()
  // attemptID -> summary already flushed (dedupe repeated terminal updates)
  const flushed = new Set<string>()
  // sessionID -> { tools, userMsgs } lightweight counters (best-effort)
  const counters = new Map<string, { tools: number; turns: number }>()

  const store = (file: string, record: Record<string, unknown>) => {
    try {
      mkdirSync(telemetryDir, { recursive: true })
      appendFileSync(join(telemetryDir, file), JSON.stringify(record) + "\n", "utf8")
    } catch {
      /* best-effort: never break the session */
    }
  }

  const counter = (sid: string) => {
    let c = counters.get(sid)
    if (!c) {
      c = { tools: 0, turns: 0 }
      counters.set(sid, c)
    }
    return c
  }

  const rootTask = (sid: string): string => {
    // Walk the session parent chain to the root session; that root is the task.
    let cur: string | undefined = sid
    const guard = new Set<string>()
    while (cur && !guard.has(cur)) {
      guard.add(cur)
      const s = sessions.get(cur)
      if (!s?.parentID) return cur
      cur = s.parentID
    }
    return sid
  }

  const writeAttempt = (sid: string, info: any) => {
    if (!info || info.role !== "assistant" || !info.tokens) return
    const id = info.id
    if (flushed.has(id)) return
    // Only flush a message once it looks terminal.
    const terminal = info.error !== undefined || info.finish !== undefined || info.time?.completed !== undefined
    if (!terminal) return
    flushed.add(id)

    const task = rootTask(sid)
    const t = info.time || {}
    const cache = info.tokens?.cache || {}
    const err = info.error
    const parentTask = sessions.get(task)?.parentID || null
    store("attempts.jsonl", {
      schema: "opencode-telemetry/attempt/v1",
      timestamp: new Date().toISOString(),
      task_id: task,
      attempt_id: id,
      parent_attempt_id: info.parentID && info.parentID !== sid ? info.parentID : null,
      parent_task_id: parentTask,
      session_id: sid,
      agent: info.mode || sessions.get(sid)?.agent || null,
      model: info.modelID || null,
      provider: info.providerID || null,
      duration_ms: t.created && t.completed ? t.completed - t.created : null,
      input_tokens: info.tokens?.input ?? null,
      cached_input_tokens: cache.read ?? null,
      uncached_input_tokens:
        info.tokens?.input != null && cache.read != null ? Math.max(0, info.tokens.input - cache.read) : null,
      cache_write_tokens: cache.write ?? null,
      output_tokens: info.tokens?.output ?? null,
      reasoning_tokens: info.tokens?.reasoning ?? null,
      total_tokens:
        info.tokens?.input != null && info.tokens?.output != null
          ? info.tokens.input + info.tokens.output + (cache.write ?? 0)
          : null,
      turn_count: null,
      tool_call_count: null,
      status: err ? "error" : "success",
      success: !err,
      failure_reason: err ? String(err.message || err.name || JSON.stringify(err)) : info.finish === "error" ? "error" : null,
      escalated: null,
      escalation_target: null,
      escalation_reason: null,
      human_intervention: null,
      cost_reported_usd: typeof info.cost === "number" ? info.cost : null,
    })
  }

  const handleEvent = (event: Event) => {
    try {
      switch (event.type) {
        case "session.created": {
          const s = (event as any).properties?.info as Session
          if (s?.id) sessions.set(s.id, { parentID: s.parentID, agent: s.title, title: s.title, created: s.time?.created })
          const parent = s?.parentID
          if (s?.id && !parent) {
            // Root session -> task record.
            store("tasks.jsonl", {
              schema: "opencode-telemetry/task/v1",
              task_id: s.id,
              timestamp: new Date().toISOString(),
              title: s.title ?? null,
              created_ms: s.time?.created ?? null,
              parent_task_id: null,
            })
          }
          break
        }
        case "message.updated": {
          const info = (event as any).properties?.info
          const sid = info?.sessionID
          if (sid) writeAttempt(sid, info)
          break
        }
        default:
          break
      }
    } catch {
      /* best-effort */
    }
  }

  return {
    event: async ({ event }) => {
      handleEvent(event)
    },
    "tool.execute.after": async ({ sessionID }) => {
      counter(sessionID).tools += 1
    },
    "chat.message": async ({ sessionID }) => {
      counter(sessionID).turns += 1
    },
    "permission.ask": async () => {
      // A permission prompt surfaced to the human; recorded best-effort on next
      // attempt flush via counters below is not attached; store nothing here.
    },
  }
}

export default telemetry
