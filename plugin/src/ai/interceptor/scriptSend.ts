/**
 * Sending a message through an interceptor script: the chat's side of it.
 *
 * The message is in the chat at once, as a draft with the script's name on it, and on disk
 * before the script starts: whatever the script does — hangs, throws, the app closes — the
 * message is not lost. What the script decides is applied only if this is still the same
 * conversation and the draft is still waiting; a chat cleared or reopened meanwhile is left
 * alone.
 */
import { Notice } from 'obsidian'
import { nanoid } from 'nanoid'
import type { Message } from '@/ai/client'
import type { ChatMessage } from '@/ai/types'
import type { ChatInterceptor, InterceptRoute } from '@/ai/ChatInterceptor'
import { buildInterceptInput, type InterceptSource } from './context'
import type { ToolPolicy } from './policy'

/** What the chat lends this: its conversation, and the ways a turn is started or saved. */
export interface ScriptSendHost {
  readonly interceptor: ChatInterceptor
  /** Moves whenever the conversation is replaced — cleared, reopened. */
  generation(): number
  /** The visible conversation, before this message joins it. */
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

export async function sendThroughScript(
  host: ScriptSendHost,
  route: Extract<InterceptRoute, { kind: 'script' }>,
  content: string,
  attachments?: string[]
): Promise<void> {
  const gen = host.generation()
  const earlier = host.visible()

  const bubble: ChatMessage = {
    id: nanoid(),
    role: 'user',
    content,
    attachments: attachments?.length ? attachments : undefined,
    timestamp: Date.now(),
    draft: true,
    interceptorName: route.script,
    interceptorScript: true,
    interceptorChat: [],
  }
  host.append(bubble)
  await host.save()

  const input = buildInterceptInput(
    { text: content, attachments: attachments ?? [] },
    host.source(earlier)
  )
  const outcome = await host.interceptor.runScript(route.script, input)
  if (gen !== host.generation() || !host.find(bubble.id)?.draft) return

  const notes = route.broken
    ? [`The pattern does not compile (${route.broken}), so every message goes to the script.`]
    : []
  const settle = (patch: Partial<ChatMessage>, more: string[]) =>
    annotate(host, bubble.id, [...notes, ...more], patch)
  const current = () => host.find(bubble.id) ?? bubble

  switch (outcome.kind) {
    case 'hold':
    case 'stopped': {
      settle({}, [
        outcome.kind === 'hold'
          ? outcome.reason
          : 'Stopped before the script decided. Send it, change it or delete it.',
      ])
      await host.save()
      // Held, the chat is free again: what was typed while the script decided goes on. Stopped,
      // the queue went back to the composer with the stop.
      if (outcome.kind === 'hold') await host.drainQueue()
      return
    }
    case 'reply': {
      settle({ draft: false, interceptorCollapsed: !notes.length }, [])
      host.countUserMessage()
      const answer: ChatMessage = {
        id: nanoid(),
        role: 'assistant',
        content: outcome.text,
        timestamp: Date.now(),
      }
      host.remember(await host.modelMessage(current()))
      host.append(answer)
      host.remember({
        role: 'assistant',
        content: [{ type: 'text', text: outcome.text }],
        model: '',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        stopReason: 'stop',
        timestamp: answer.timestamp,
        chatMessageId: answer.id,
      } as Message)
      await host.save()
      await host.drainQueue()
      return
    }
    case 'failed': {
      const why = `Not checked: ${outcome.reason}. Sent as written.`
      new Notice(`${route.script}: ${why}`, 10000)
      settle({ draft: false, interceptorCollapsed: false }, [why])
      return host.runTurnFor(current())
    }
    case 'send': {
      const was = attachments ?? []
      const more = outcome.rewritten
        ? [
            `Changed by the script. Typed: ${content}` +
              (sameList(was, outcome.attachments)
                ? ''
                : ` (attached: ${was.join(', ') || 'nothing'})`),
          ]
        : []
      settle(
        {
          draft: false,
          content: outcome.text,
          attachments: outcome.attachments.length ? outcome.attachments : undefined,
          interceptorCollapsed: !notes.length,
        },
        more
      )
      return host.runTurnFor(current(), outcome.policy)
    }
  }
}

/** Lines from the interceptor beside a message, and whatever else changes on it. */
function annotate(
  host: ScriptSendHost,
  id: string,
  lines: string[],
  patch: Partial<ChatMessage>
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
      })),
    ],
  }))
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}
