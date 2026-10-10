import AttentionWorker from '@/ai/chatAttention.worker?worker&inline'
import { parseChatAttention, type ChatAttentionSnapshot } from '@/ai/ChatLog'

/** One lazy worker for oversized records and legacy JSON, with a cooperative portable fallback. */
export class AttentionReader {
  private worker?: Worker
  private unavailable = false
  private disposed = false
  private nextId = 0
  private readonly pending = new Map<
    number,
    {
      resolve: (snapshot: ChatAttentionSnapshot) => void
      reject: (error: Error) => void
    }
  >()

  async read(content: string, yieldControl: () => Promise<void>): Promise<ChatAttentionSnapshot> {
    if (this.disposed) throw new Error('Attention discovery stopped')
    if (content.length < 256 * 1024 || this.unavailable || typeof Worker === 'undefined')
      return parseChatAttention(content, yieldControl)
    if (!this.worker) {
      try {
        this.worker = new AttentionWorker()
        this.worker.onmessage = (
          event: MessageEvent<{
            id: number
            snapshot: ChatAttentionSnapshot
            error?: string
          }>
        ) => {
          const pending = this.pending.get(event.data.id)
          this.pending.delete(event.data.id)
          if (event.data.error) pending?.reject(new Error(event.data.error))
          else pending?.resolve(event.data.snapshot)
        }
        this.worker.onerror = () => this.stopWorker()
      } catch {
        this.unavailable = true
        return parseChatAttention(content, yieldControl)
      }
    }
    const worker = this.worker
    return new Promise((resolve, reject) => {
      const id = ++this.nextId
      this.pending.set(id, { resolve, reject })
      try {
        worker.postMessage({ id, content })
      } catch {
        this.stopWorker()
      }
    })
  }
  private stopWorker(): void {
    this.worker?.terminate()
    this.worker = undefined
    this.unavailable = true
    for (const pending of this.pending.values())
      pending.reject(new Error('Conversation could not be checked'))
    this.pending.clear()
  }
  destroy(): void {
    this.disposed = true
    this.stopWorker()
  }
}
