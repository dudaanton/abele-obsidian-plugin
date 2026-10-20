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
  private readonly waiting = new Map<string, string>()
  private readonly receiving = new Set<string>()

  constructor(private readonly openChats: () => LetterEndpoint[]) {}

  list(caller: string): Omit<LetterEndpoint, 'receive'>[] {
    return this.openChats()
      .filter((chat) => chat.id !== caller)
      .map(({ receive: _receive, ...chat }) => chat)
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
    let next: string | undefined = target
    while (next && !seen.has(next)) {
      if (next === caller) throw new Error('The target chat is waiting for this chat')
      seen.add(next)
      next = this.waiting.get(next)
    }
    if (this.receiving.has(target))
      throw new Error('The target chat is busy answering another chat')
    if (this.waiting.has(caller)) throw new Error('This chat is already waiting for an answer')
    if (signal?.aborted) throw new Error('Message cancelled')
    this.waiting.set(caller, target)
    this.receiving.add(target)
    let cancel: (() => void) | undefined
    try {
      return await new Promise<string>((resolve, reject) => {
        cancel = () => reject(new Error('Message cancelled'))
        signal?.addEventListener('abort', cancel, { once: true })
        Promise.resolve()
          .then(() => {
            if (signal?.aborted) throw new Error('Message cancelled')
            return to.receive(
              message,
              { id: from.id, title: from.title, folder: from.folder, path: from.path },
              signal
            )
          })
          .then(resolve, reject)
      })
    } finally {
      if (cancel) signal?.removeEventListener('abort', cancel)
      this.waiting.delete(caller)
      this.receiving.delete(target)
    }
  }
}
