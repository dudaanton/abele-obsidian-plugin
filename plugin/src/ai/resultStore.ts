import type { AgentTool, AgentToolResult, Message } from './client'
import { contentHash } from './readGuard'
import { estimateTokens } from './tokens'

/**
 * A tool answer too big to send is kept whole, and the agent is sent the start of it and a key.
 *
 * Every result stays in the conversation for the rest of it and is sent again with every later
 * request, so one answer of fifty thousand tokens — every task in a large vault, a folder of
 * six thousand notes — is paid for on every step after it, and on a small model does not fit at
 * all. Cutting it would lose what the agent asked for. So the whole text travels on the result
 * message as `stored`, which is saved with the chat like everything else on it (and so survives
 * the chat being closed and opened again) but is never sent to the model; the model gets the
 * first few thousand tokens, a line saying exactly how much is missing, and the key
 * `read_result` takes to page through the rest or search it. The idea is rtk's
 * (github.com/rtk-ai/rtk): a filtered answer plus a way to recall the unfiltered one, without
 * running the command again — which for a vault that has since changed would not even give
 * the same answer.
 *
 * Decisions, for whoever changes this:
 * - A result that carries a file's text for the read guard (`seen`) is left alone. `read` caps
 *   itself by lines, so what the guard records is what was shown — a window, not the whole —
 *   and the file itself is where the rest is read from.
 * - `read_result` is never stored again: it answers a page at a time, within the same budget.
 * - What a person sees under the tool call is what the agent was sent, as with screenshots.
 * - Scripts call tools directly and get whole answers; only agents go through a store.
 */

/** Tokens one `read` of a file returns at most; see `createReadFileTool`. */
export const READ_BUDGET = 10000
/** Over this, a result is stored and only its start is sent. */
export const STORE_OVER = 6000
/** How much of a stored result the agent is sent at once, the first time and per page. */
export const PREVIEW_TOKENS = 2500
export const PAGE_TOKENS = 5000
/** A line longer than this is cut into pieces for paging; each piece counts as a line. */
export const PIECE_CHARS = 2000

export const READ_RESULT = 'read_result'

/** Keys are made from the call id, so they are the same wherever the message is read back. */
export function resultKey(callId: string): string {
  return 'r' + contentHash(callId).padStart(8, '0').slice(-8)
}

/** The text as paging sees it: lines, with a line past `PIECE_CHARS` cut into pieces. */
export function pieces(text: string): { text: string; continued: boolean }[] {
  const out: { text: string; continued: boolean }[] = []
  for (const line of text.split('\n')) {
    if (line.length <= PIECE_CHARS) {
      out.push({ text: line, continued: false })
      continue
    }
    for (let at = 0; at < line.length; at += PIECE_CHARS) {
      out.push({ text: line.slice(at, at + PIECE_CHARS), continued: at > 0 })
    }
  }
  return out
}

/** Pieces `from` onwards (1-based) that fit in `budget` tokens — always at least one. */
function fit(all: { text: string }[], from: number, budget: number, until = all.length): number {
  let used = 0
  let to = from - 1
  while (to < until) {
    const cost = estimateTokens(all[to].text) + 1
    if (to >= from && used + cost > budget) break
    used += cost
    to++
  }
  return to
}

const n = (x: number) => x.toLocaleString('en-US')

/** What the agent is sent in place of a stored result: its start, and how to get the rest. */
export function previewOf(text: string, key: string, toolName: string): string {
  const all = pieces(text)
  const to = fit(all, 1, PREVIEW_TOKENS)
  const shown = all
    .slice(0, to)
    .map((p) => p.text)
    .join('\n')
  const split = all.length !== text.split('\n').length
  return (
    `${shown}\n\n[This is lines 1–${n(to)} of ${n(all.length)} — about ${n(estimateTokens(shown))} ` +
    `of ${n(estimateTokens(text))} tokens. The rest of this ${toolName} result is not in this ` +
    `message: it is kept whole under the key ${key}. Read on with ${READ_RESULT} ` +
    `{key: "${key}", start_line: ${to + 1}}, or search all of it with ${READ_RESULT} ` +
    `{key: "${key}", grep: "..."}.` +
    (split ? ` Lines longer than ${n(PIECE_CHARS)} characters count as several lines.` : '') +
    `]`
  )
}

export interface ResultStoreHost {
  /** Every message of the conversation, the ones no longer sent to the model included. */
  messages(): readonly Message[]
}

/** One conversation's store. See the top of this file. */
export class ResultStore {
  /** Results of the turn still running, not yet in the conversation's messages. */
  private live = new Map<string, { text: string; tool: string }>()

  constructor(private readonly host: ResultStoreHost) {}

  /** The running turn's messages are in the conversation now, or were dropped with it. */
  settle(): void {
    this.live.clear()
  }

  /** Stores `result` and shortens what it sends, when it is too big to send whole. */
  keep(toolName: string, callId: string, result: AgentToolResult): void {
    if (toolName === READ_RESULT || result.seen || result.stored) return
    const text = result.content.map((c) => c.text).join('')
    // No script has fewer characters than tokens, so a short text cannot be over.
    if (text.length <= STORE_OVER || estimateTokens(text) <= STORE_OVER) return
    const key = resultKey(callId)
    this.live.set(key, { text, tool: toolName })
    result.stored = { key, text }
    result.content = [{ type: 'text', text: previewOf(text, key, toolName) }]
  }

  /** The whole text stored under `key`, and the tool that answered it. */
  lookup(key: string): { text: string; tool: string } | null {
    const live = this.live.get(key)
    if (live) return live
    for (const m of this.host.messages()) {
      if (m.role === 'toolResult' && m.stored?.key === key) {
        return { text: m.stored.text, tool: m.toolName }
      }
    }
    return null
  }
}

/** A plain substring, case-insensitive; `/.../flags` is a regular expression. */
function matcher(grep: string): (line: string) => boolean {
  const re = /^\/(.+)\/([a-z]*)$/.exec(grep)
  if (re) {
    const regex = new RegExp(re[1], re[2].replace('g', ''))
    return (line) => regex.test(line)
  }
  const needle = grep.toLowerCase()
  return (line) => line.toLowerCase().includes(needle)
}

export const READ_RESULT_DESCRIPTION =
  'Read more of a tool answer that was too long to send whole — its closing note names the key. ' +
  'start_line/end_line read on a page at a time; grep returns only the numbered lines containing ' +
  'the text (case-insensitive, /regex/ for a pattern). It is the answer as it was then: for the ' +
  'current state, call the tool again.'

/** The tool that reads a stored result. One per conversation, bound to its store. */
export function createReadResultTool(store: ResultStore): AgentTool {
  return {
    name: READ_RESULT,
    label: 'Read result',
    description: READ_RESULT_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The key the shortened result named' },
        start_line: { type: 'number', description: 'First line to read, 1-based' },
        end_line: { type: 'number', description: 'Last line to read, inclusive' },
        grep: {
          type: 'string',
          description: 'Only the lines containing this (or matching /regex/), numbered',
        },
      },
      required: ['key'],
    },
    execute: async (_id, params) => {
      const key = String(params.key ?? '').trim()
      const found = key ? store.lookup(key) : null
      if (!found) {
        throw new Error(
          `No stored result "${key}" in this conversation. The key is in the note at the end of ` +
            `a shortened result; call the tool again if that result is gone.`
        )
      }
      const all = pieces(found.text)
      const total = all.length
      const grep = typeof params.grep === 'string' ? params.grep : ''

      if (grep) {
        let test: (line: string) => boolean
        try {
          test = matcher(grep)
        } catch (err) {
          throw new Error(`Not a regular expression: ${grep} (${(err as Error).message})`)
        }
        const hits = all.map((p, i) => ({ ...p, no: i + 1 })).filter((p) => test(p.text))
        if (!hits.length) return text(`No line of ${key} (${n(total)} lines) matches ${grep}.`)
        const rows = hits.map((h) => ({ text: `${h.no}\t${h.text}` }))
        const shown = fit(rows, 1, PAGE_TOKENS)
        const head = `${key} (${found.tool}) — ${n(hits.length)} of ${n(total)} lines match ${grep}`
        const body = rows.slice(0, shown).map((r) => r.text)
        if (shown < hits.length) {
          body.push(
            `[${n(hits.length - shown)} more matches from line ${hits[shown].no} on: narrow the ` +
              `search, or read from there with start_line.]`
          )
        }
        return text([head, ...body].join('\n'))
      }

      const from = Math.min(Math.max(1, Math.floor(Number(params.start_line) || 1)), total)
      const asked = Math.floor(Number(params.end_line) || total)
      const until = Math.min(total, Math.max(from, asked))
      const to = fit(all, from, PAGE_TOKENS, until)
      const body = all.slice(from - 1, to).map((p) => p.text)
      const out = [`${key} (${found.tool}) — lines ${n(from)}–${n(to)} of ${n(total)}`, ...body]
      if (to < total) {
        out.push(
          to < until
            ? `[Stopped at line ${n(to)} to keep this page small: read on with start_line: ${to + 1}.]`
            : `[Lines ${n(to + 1)}–${n(total)} follow: start_line: ${to + 1}.]`
        )
      }
      return text(out.join('\n'))
    },
  }
}

const text = (t: string): AgentToolResult => ({ content: [{ type: 'text', text: t }] })

/**
 * The tools with `store` behind them, plus `read_result`, for an agent that runs without a
 * session — one a script starts. Its run is one turn, so its store never needs settling.
 */
export function withResultStore(tools: AgentTool[], store: ResultStore): AgentTool[] {
  const wrapped = tools.map((tool) => ({
    ...tool,
    execute: async (id: string, params: Record<string, unknown>, signal?: AbortSignal) => {
      const result = await tool.execute(id, params, signal)
      store.keep(tool.name, id, result)
      return result
    },
  }))
  return [...wrapped, createReadResultTool(store)]
}
