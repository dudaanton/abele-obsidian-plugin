/**
 * Sending a message through the chat's interceptors, one after another: the chat's side of it.
 *
 * The message is in the chat at once, as a draft with the name of whoever reads it, and on disk
 * before the first one starts: whatever an interceptor does — hangs, throws, the app closes — the
 * message is not lost. Each one is given the text the one before returned. A script decides by
 * what it returns; a reviewing agent says what it thinks and the message waits for the person,
 * whose Send goes on with the next one; a reply-only one comments beside it and passes the text on
 * unchanged. One that fails stops the message there with the reason: Retry runs that one again,
 * Send as is sends it without the rest. What is decided is applied only if this is still the same
 * conversation and the draft is still waiting; a chat cleared or reopened meanwhile is left alone.
 */
import { Notice } from 'obsidian'
import { nanoid } from 'nanoid'
import type { Message } from '@/ai/client'
import type { ChatMessage, ChatReplyTo } from '@/ai/types'
import type { ChatInterceptor } from '@/ai/ChatInterceptor'
import { buildInterceptInput, type InterceptSource } from './context'
import type { ToolPolicy } from './policy'
import { placeOf, runChain, type ChainStep } from './chain'

/** What the chat lends this: its conversation, and the ways a turn is started or saved. */
export interface ScriptSendHost {
  readonly interceptor: ChatInterceptor
  /** Moves whenever the conversation is replaced — cleared, reopened. */
  generation(): number
  /** The visible conversation. */
  visible(): ChatMessage[]
  source(earlier: ChatMessage[]): InterceptSource
  append(message: ChatMessage): void
  update(id: string, change: (message: ChatMessage) => ChatMessage): void
  find(id: string): ChatMessage | undefined
  save(): Promise<void>
  /** The model's message for a person's bubble, as a send builds it. */
  modelMessage(bubble: ChatMessage): Promise<Message>
  /** Puts messages into the history the next turn is built from. */
  remember(...messages: Message[]): void
  countUserMessage(): void
  runTurnFor(bubble: ChatMessage, policy?: ToolPolicy): Promise<void>
  drainQueue(): Promise<void>
}

/** How one interceptor ended the run of them, short of letting the message through. */
type Stop =
  /** Held for the person: a reviewer said what it thinks, or a script held it. */
  | { kind: 'held' }
  /** Failed or stopped: the reason is on the message. */
  | { kind: 'failed' }
  /** A script answered in the agent's place. */
  | { kind: 'reply'; text: string }
  /** The conversation moved on, or the draft was sent or removed meanwhile. */
  | { kind: 'gone' }

/** Puts a new message in the chat as a draft and runs the chat's interceptors over it. */
export async function sendThroughChain(
  host: ScriptSendHost,
  content: string,
  attachments?: string[],
  replyTo?: ChatReplyTo[]
): Promise<void> {
  const first = host.interceptor.chain('message')[0]
  const bubble: ChatMessage = {
    id: nanoid(),
    role: 'user',
    content,
    attachments: attachments?.length ? attachments : undefined,
    ...(replyTo?.length ? { replyTo } : {}),
    timestamp: Date.now(),
    draft: true,
    interceptorName: first ? host.interceptor.nameOf(first) : 'Interceptor',
    ...(first?.script ? { interceptorScript: true } : {}),
    interceptorChat: [],
  }
  host.append(bubble)
  return continueChain(host, bubble.id, 0, undefined, true)
}

/**
 * The person pressed Send on a held message. Held by an interceptor's say, it goes on with the
 * next one; stopped by a failure, it is sent as it is, without the rest.
 */
export async function sendHeld(host: ScriptSendHost, id: string): Promise<void> {
  const bubble = host.find(id)
  if (!bubble?.draft) return
  const wait = bubble.interceptorWait
  if (!wait || wait.error)
    return settleAndRun(
      host,
      id,
      wait ? ['Sent as is, without the interceptors after this one.'] : []
    )
  const chain = host.interceptor.chain('message')
  host.update(id, (m) => ({ ...m, interceptorCollapsed: true }))
  return continueChain(host, id, placeOf(chain, wait) + 1)
}

/** Retry on a message stopped by a failure: that interceptor again, and the rest after it. */
export async function retryHeld(host: ScriptSendHost, id: string): Promise<boolean> {
  const bubble = host.find(id)
  const wait = bubble?.draft ? bubble.interceptorWait : undefined
  if (!wait?.error) return false
  const chain = host.interceptor.chain('message')
  host.update(id, (m) => ({ ...m, interceptorWait: { ...wait, error: undefined } }))
  await continueChain(host, id, placeOf(chain, wait))
  return true
}

async function continueChain(
  host: ScriptSendHost,
  id: string,
  from: number,
  carried?: ToolPolicy,
  fresh = false
): Promise<void> {
  const gen = host.generation()
  const { interceptor } = host
  const chain = interceptor.chain('message')
  let policy = carried
  let saved: Promise<void> | null = fresh ? null : Promise.resolve()
  const live = () => gen === host.generation() && !!host.find(id)?.draft

  const result = await runChain<Stop>(
    chain,
    from,
    host.find(id)?.content ?? '',
    async (step: ChainStep, text) => {
      if (!live()) return { kind: 'stop', result: { kind: 'gone' } }
      const { entry, at, of } = step
      const name = interceptor.nameOf(entry)
      const wait = { entry: entry.id, at, of }
      host.update(id, (m) => ({
        ...m,
        interceptorName: name,
        interceptorScript: entry.script ? true : undefined,
        interceptorWait: wait,
      }))
      const notes = step.broken
        ? [`The pattern does not compile (${step.broken}), so every message goes to ${name}.`]
        : []
      const bubble = host.find(id)
      const route = interceptor.routeOf(entry, step.broken)
      const input = () =>
        buildInterceptInput(
          { text, attachments: bubble.attachments ?? [] },
          host.source(before(host.visible(), id))
        )

      if (entry.replyOnly) {
        // Beside the message, in its own time: the next one is given the text unchanged.
        const reviewing =
          route.kind === 'script'
            ? interceptor.reviewScriptReply(id, route, input())
            : interceptor.reviewReply(id, entry)
        void reviewing.catch((err) => console.error('[Abele interceptor save]', err))
        if (notes.length) annotate(host, id, notes, name)
        return { kind: 'pass', text }
      }

      if (route.kind === 'agent') {
        const said = interceptor.review(id, entry)
        saved ??= host.save()
        const ok = await said
        if (!live()) return { kind: 'stop', result: { kind: 'gone' } }
        if (notes.length) annotate(host, id, notes, name)
        const error = interceptor.error.value
        if (!ok && error) {
          fail(host, id, wait, name, error)
          return { kind: 'stop', result: { kind: 'failed' } }
        }
        return { kind: 'stop', result: { kind: 'held' } }
      }

      // Started before the save is awaited: the chat counts as busy from this moment, so nothing
      // sent meanwhile starts a turn of its own, and a stop or a reset reaches the script.
      const deciding = interceptor.runScript(route.script, input())
      if (saved === null) {
        saved = host.save()
        await saved
      }
      const outcome = await deciding
      if (!live()) return { kind: 'stop', result: { kind: 'gone' } }

      switch (outcome.kind) {
        case 'send': {
          const was = bubble.attachments ?? []
          const more = outcome.rewritten
            ? [
                (of > 1 ? `Changed by ${name}. It was given: ` : 'Changed by the script. Typed: ') +
                  text +
                  (sameList(was, outcome.attachments)
                    ? ''
                    : ` (attached: ${was.join(', ') || 'nothing'})`),
              ]
            : []
          annotate(host, id, [...notes, ...more], name, {
            content: outcome.text,
            attachments: outcome.attachments.length ? outcome.attachments : undefined,
          })
          // Each script answers for the calls of the turn its text starts; the last one to say
          // anything is the one whose text the agent reads.
          if (outcome.policy) policy = outcome.policy
          return { kind: 'pass', text: outcome.text }
        }
        case 'hold':
          annotate(host, id, [...notes, outcome.reason], name)
          return { kind: 'stop', result: { kind: 'held' } }
        case 'stopped':
          annotate(host, id, notes, name)
          fail(host, id, wait, name, 'stopped before it decided')
          return { kind: 'stop', result: { kind: 'failed' } }
        case 'failed':
          annotate(host, id, notes, name)
          fail(host, id, wait, name, outcome.reason)
          new Notice(`${name}: ${outcome.reason}`, 10000)
          return { kind: 'stop', result: { kind: 'failed' } }
        case 'reply':
          annotate(host, id, notes, name)
          return { kind: 'stop', result: { kind: 'reply', text: outcome.text } }
      }
    }
  )

  if (saved !== null) await saved
  if (!live()) return
  if (result.kind === 'done') {
    const noted = Boolean(host.find(id)?.interceptorChat?.some((m) => m.role === 'assistant'))
    return settleAndRun(host, id, [], policy, !noted)
  }
  switch (result.result.kind) {
    case 'gone':
      return
    case 'held':
    case 'failed':
      await host.save()
      // Waiting for the person, the chat is free again: what was typed meanwhile goes on.
      await host.drainQueue()
      return
    case 'reply': {
      const text = result.result.text
      host.update(id, (m) => ({ ...m, draft: false, interceptorWait: undefined }))
      host.countUserMessage()
      const answer: ChatMessage = {
        id: nanoid(),
        role: 'assistant',
        content: text,
        timestamp: Date.now(),
      }
      host.remember(await host.modelMessage(host.find(id)))
      host.append(answer)
      host.remember({
        role: 'assistant',
        content: [{ type: 'text', text }],
        model: '',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        stopReason: 'stop',
        timestamp: answer.timestamp,
        chatMessageId: answer.id,
      })
      await host.save()
      await host.drainQueue()
      return
    }
  }
}

/** The message leaves the interceptors and its turn starts. */
async function settleAndRun(
  host: ScriptSendHost,
  id: string,
  lines: string[],
  policy?: ToolPolicy,
  collapsed = true
): Promise<void> {
  annotate(host, id, lines, undefined, {
    draft: false,
    interceptorWait: undefined,
    interceptorCollapsed: collapsed && !lines.length,
  })
  const bubble = host.find(id)
  if (bubble) return host.runTurnFor(bubble, policy)
}

/** An interceptor failed: the message waits there, with who and why. */
function fail(
  host: ScriptSendHost,
  id: string,
  wait: { entry: string; at: number; of: number },
  name: string,
  reason: string
): void {
  const where = wait.of > 1 ? `${name}, ${wait.at} of ${wait.of}` : name
  const error = `${where}: ${reason}. Retry, or send it as is.`
  annotate(host, id, [], name, { interceptorWait: { ...wait, error }, interceptorCollapsed: false })
}

/** What came before the message in the conversation, as an interceptor is shown it. */
function before(visible: ChatMessage[], id: string): ChatMessage[] {
  const at = visible.findIndex((m) => m.id === id)
  return at < 0 ? visible : visible.slice(0, at)
}

/** Lines from an interceptor beside a message, and whatever else changes on it. */
function annotate(
  host: ScriptSendHost,
  id: string,
  lines: string[],
  by: string | undefined,
  patch: Partial<ChatMessage> = {}
): void {
  host.update(id, (m) => ({
    ...m,
    ...patch,
    interceptorChat: [
      ...(m.interceptorChat ?? []),
      ...lines.map((content) => ({
        id: nanoid(),
        role: 'assistant' as const,
        content,
        timestamp: Date.now(),
        ...(by ? { by } : {}),
      })),
    ],
  }))
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}
