/** Transport-independent routing between existing conversations. */
export interface LetterChat {
  id: string
  title: string
  folder?: string
  path?: string
}

export interface ChatLetter {
  to: LetterChat
  reply?: string
  refusal?: string
}

export interface LetterEndpoint extends LetterChat {
  agent: string
  state: string
  receive(message: string, from: LetterChat, signal?: AbortSignal): Promise<string>
}

export class ChatLetters {
  private readonly waiting = new Map<string, Map<string, number>>()
  private readonly receiving = new Map<string, Promise<void>>()

  constructor(private readonly openChats: () => LetterEndpoint[]) {}

  list(caller: string): Omit<LetterEndpoint, 'receive'>[] {
    return this.openChats()
      .filter((chat) => chat.id !== caller)
      .map(({ id, title, folder, path, agent, state }) => ({
        id,
        title,
        folder,
        path,
        agent,
        state,
      }))
  }

  async send(
    caller: string,
    target: string,
    message: string,
    signal?: AbortSignal
  ): Promise<string> {
    if (caller === target) throw new Error('Cannot send a message to your own chat')
    const chats = this.openChats()
    const from = chats.find((chat) => chat.id === caller)
    const to = chats.find((chat) => chat.id === target)
    if (!from || !to) throw new Error('The chat is closed or unknown')
    if (!message.trim()) throw new Error('The message is empty')
    const seen = new Set<string>()
    const pending = [target]
    while (pending.length) {
      const next = pending.pop()
      if (next === undefined) continue
      if (next === caller) throw new Error('The target chat is waiting for this chat')
      if (seen.has(next)) continue
      seen.add(next)
      pending.push(...(this.waiting.get(next)?.keys() ?? []))
    }
    if (signal?.aborted) throw new Error('Message cancelled')
    const targets = this.waiting.get(caller) ?? new Map<string, number>()
    targets.set(target, (targets.get(target) ?? 0) + 1)
    this.waiting.set(caller, targets)
    // The receiver owns its turn until it settles, even if a queued sender stops waiting.
    const delivery = (this.receiving.get(target) ?? Promise.resolve()).then(() => {
      if (signal?.aborted) throw new Error('Message cancelled')
      const open = this.openChats()
      if (!open.some((chat) => chat.id === caller) || !open.some((chat) => chat.id === target))
        throw new Error('The chat is closed or unknown')
      return to.receive(
        message,
        { id: from.id, title: from.title, folder: from.folder, path: from.path },
        signal
      )
    })
    const tail = delivery.then(
      (): void => undefined,
      (): void => undefined
    )
    this.receiving.set(target, tail)
    void tail.then(() => {
      if (this.receiving.get(target) === tail) this.receiving.delete(target)
    })
    let cancel: (() => void) | undefined
    try {
      return await new Promise<string>((resolve, reject) => {
        cancel = () => reject(new Error('Message cancelled'))
        signal?.addEventListener('abort', cancel, { once: true })
        delivery.then(resolve, reject)
      })
    } finally {
      if (cancel) signal?.removeEventListener('abort', cancel)
      const remaining = (targets.get(target) ?? 1) - 1
      if (remaining) targets.set(target, remaining)
      else targets.delete(target)
      if (!targets.size) this.waiting.delete(caller)
    }
  }
}
