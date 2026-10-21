/** Transport-independent routing between existing conversations. */
export interface LetterChat {
  id: string
  title: string
  folder?: string
  path?: string
  unknown?: boolean
}

export class LetterRefusal extends Error {
  constructor(
    readonly reason: 'self' | 'unknown' | 'closed' | 'cycle' | 'node',
    readonly title = ''
  ) {
    super(
      reason === 'self'
        ? 'That is this chat.'
        : reason === 'unknown'
          ? 'No chat by that name.'
          : reason === 'closed'
            ? `${title} is closed. Open it from the chat tree first.`
            : reason === 'cycle'
              ? `${title} is waiting on this chat; asking it back would go in a circle.`
              : "Chats on a node can't be asked yet."
    )
  }
}

export interface ChatLetter {
  to: LetterChat
  reply?: string
  refusal?: string
}

export interface LetterEndpoint extends LetterChat {
  agent: { id: string; name: string } | null
  state: 'idle' | 'waiting' | 'working' | 'failed'
  receive(message: string, from: LetterChat, signal?: AbortSignal): Promise<string>
}

export class ChatLetters {
  private readonly waiting = new Map<string, Map<string, number>>()
  private readonly receiving = new Map<string, Promise<void>>()

  constructor(
    private readonly openChats: () => LetterEndpoint[],
    private readonly knownChat: (id: string) => LetterChat | undefined = () => undefined
  ) {}

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
    if (caller === target) throw new LetterRefusal('self')
    const chats = this.openChats()
    const from = chats.find((chat) => chat.id === caller)
    const to = chats.find((chat) => chat.id === target)
    if (!from || !to) {
      const known = this.knownChat(target)
      throw new LetterRefusal(known ? 'closed' : 'unknown', known?.title)
    }
    if (!message.trim()) throw new Error('The message is empty')
    const seen = new Set<string>()
    const pending = [target]
    while (pending.length) {
      const next = pending.pop()
      if (next === undefined) continue
      if (next === caller) throw new LetterRefusal('cycle', to.title)
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
        throw new LetterRefusal('closed', to.title)
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
