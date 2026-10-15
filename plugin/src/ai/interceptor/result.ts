/**
 * What an interceptor script's return value means.
 *
 *   return                       → send the message as written
 *   return 'text'                → send this instead
 *   return { text, attachments } → send, with either replaced
 *   return { reply: 'text' }     → answer it here; the agent is not asked
 *   return { hold: 'why' }       → keep it back as a draft, with the reason beside it
 *   approve / deny               → beside a send: what to do with the turn's tool calls
 *
 * Anything else is `invalid`, with a reason, and the caller sends the message as written.
 */
import type { ToolPolicySpec } from './policy'

export interface InterceptedMessage {
  /** The person's message before the agent reads it, or the agent's finished answer. */
  kind?: 'message' | 'answer'
  text: string
  attachments: string[]
  /** For an answer: the tool calls of the turn that produced it, oldest first. */
  tools?: InterceptedToolCall[]
}

export interface InterceptedToolCall {
  name: string
  args: Record<string, unknown>
  /** What the tool answered, or null when it never ran (refused, stopped). */
  result: string | null
  refused: boolean
}

export type InterceptResult =
  | {
      kind: 'send'
      text: string
      attachments: string[]
      rewritten: boolean
      policy?: ToolPolicySpec
    }
  | { kind: 'reply'; text: string }
  | { kind: 'hold'; reason: string }
  | { kind: 'invalid'; reason: string }

const KEYS = new Set(['text', 'attachments', 'reply', 'hold', 'approve', 'deny'])

const invalid = (why: string): InterceptResult => ({
  kind: 'invalid',
  reason: `the script returned something an interceptor cannot use: ${why}`,
})

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string')

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i])

export function readInterceptResult(value: unknown, original: InterceptedMessage): InterceptResult {
  const unchanged: InterceptResult = {
    kind: 'send',
    text: original.text,
    attachments: [...original.attachments],
    rewritten: false,
  }

  if (value === undefined || value === null || value === true) return unchanged

  if (typeof value === 'string') {
    if (!value.trim()) return invalid('an empty text (return nothing to send the message as it is)')
    return { ...unchanged, text: value, rewritten: value !== original.text }
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return invalid(Array.isArray(value) ? 'a list' : `a ${typeof value}`)
  }

  const out = value as Record<string, unknown>
  const unknown = Object.keys(out).filter((k) => !KEYS.has(k))
  if (unknown.length) return invalid(`unknown ${unknown.map((k) => `"${k}"`).join(', ')}`)

  const says = (key: string) => out[key] !== undefined
  const sending = says('text') || says('attachments') || says('approve') || says('deny')

  if (says('reply') || says('hold')) {
    if (says('reply') && says('hold')) return invalid('both "reply" and "hold"')
    if (sending) return invalid('"reply" or "hold" together with what to send')
    const key = says('reply') ? 'reply' : 'hold'
    const text = out[key]
    if (typeof text !== 'string' || !text.trim()) return invalid(`"${key}" without a text`)
    return key === 'reply' ? { kind: 'reply', text } : { kind: 'hold', reason: text }
  }

  if (says('text') && (typeof out.text !== 'string' || !out.text.trim())) {
    return invalid('"text" that is not a non-empty text')
  }
  if (says('attachments') && !isStringList(out.attachments)) {
    return invalid('"attachments" that is not a list of paths')
  }
  const approve = out.approve
  if (
    approve !== undefined &&
    approve !== true &&
    typeof approve !== 'function' &&
    !isStringList(approve)
  ) {
    return invalid('"approve" that is not true, a list of tool names or a function')
  }
  if (says('deny') && !isStringList(out.deny)) {
    return invalid('"deny" that is not a list of tool names')
  }

  const text = says('text') ? (out.text as string) : original.text
  const attachments = says('attachments')
    ? [...(out.attachments as string[])]
    : [...original.attachments]
  const policy: ToolPolicySpec | undefined =
    approve !== undefined || says('deny')
      ? {
          approve: (approve as ToolPolicySpec['approve']) ?? [],
          deny: says('deny') ? [...(out.deny as string[])] : [],
        }
      : undefined

  return {
    kind: 'send',
    text,
    attachments,
    rewritten: text !== original.text || !sameList(attachments, original.attachments),
    ...(policy ? { policy } : {}),
  }
}

/**
 * What an interceptor script's return value means for the agent's finished answer.
 *
 *   return                     → the answer stays
 *   return 'text'              → this text takes the answer's place
 *   return { text, note? }     → the same, with a line under the answer
 *   return { note: 'text' }    → the answer stays, with this line under it
 *
 * What only a person's message can take (`reply`, `hold`, attachments, tool approvals) is
 * `invalid` here, and the answer stays as it was.
 */
export type AnswerResult =
  | { kind: 'keep'; note?: string }
  | { kind: 'replace'; text: string; note?: string }
  | { kind: 'invalid'; reason: string }

const ANSWER_KEYS = new Set(['text', 'note'])

export function readAnswerResult(value: unknown, original: string): AnswerResult {
  const invalidAnswer = (why: string): AnswerResult => ({
    kind: 'invalid',
    reason: `the script returned something an answer check cannot use: ${why}`,
  })
  if (value === undefined || value === null || value === true) return { kind: 'keep' }

  if (typeof value === 'string') {
    if (!value.trim()) return invalidAnswer('an empty text (return nothing to keep the answer)')
    return value === original ? { kind: 'keep' } : { kind: 'replace', text: value }
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return invalidAnswer(Array.isArray(value) ? 'a list' : `a ${typeof value}`)
  }

  const out = value as Record<string, unknown>
  const unknown = Object.keys(out).filter((k) => !ANSWER_KEYS.has(k))
  if (unknown.length) {
    return invalidAnswer(
      `${unknown.map((k) => `"${k}"`).join(', ')}, which only a message takes; an answer takes "text" and "note"`
    )
  }
  for (const key of ['text', 'note'] as const) {
    if (out[key] !== undefined && (typeof out[key] !== 'string' || !out[key].trim()))
      return invalidAnswer(`"${key}" that is not a non-empty text`)
  }
  const note = out.note as string | undefined
  const text = out.text as string | undefined
  if (text === undefined || text === original) return { kind: 'keep', ...(note ? { note } : {}) }
  return { kind: 'replace', text, ...(note ? { note } : {}) }
}
