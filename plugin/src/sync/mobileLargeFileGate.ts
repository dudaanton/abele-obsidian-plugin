import { PHONE_FALLBACK_BYTES } from './mobileWholeRead'
import type { ChunkSource } from '@abele/sync-sdk/core'

/** One large mobile allocation/transfer at a time, across connections and vault adapters. */
export class MobileLargeFileGate {
  private active = false
  private readonly queue: { start(): void; signal?: AbortSignal; abort(): void }[] = []
  acquire(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
      const waiter = {
        signal,
        abort: () => {
          const index = this.queue.indexOf(waiter)
          if (index >= 0) this.queue.splice(index, 1)
          reject(
            signal?.reason instanceof Error ? signal.reason : new Error('Large transfer cancelled')
          )
        },
        start: () => {
          signal?.removeEventListener('abort', waiter.abort)
          this.active = true
          let released = false
          resolve(() => {
            if (released) return
            released = true
            this.active = false
            this.queue.shift()?.start()
          })
        },
      }
      if (this.active) {
        this.queue.push(waiter)
        signal?.addEventListener('abort', waiter.abort, { once: true })
      } else waiter.start()
    })
  }
}
export const mobileLargeFileGate = new MobileLargeFileGate()
export const MOBILE_LARGE_SOURCE = Symbol.for('abele.sync.mobile-large-source-v1')
export const isLargeMobileFile = (size: number) => size > PHONE_FALLBACK_BYTES

/** Acquire on first read, inside the caller's transfer budget, to preserve lock ordering. */
export function gateMobileSource(source: ChunkSource, signal?: AbortSignal): ChunkSource {
  if (!isLargeMobileFile(source.size) || Reflect.get(source, MOBILE_LARGE_SOURCE)) return source
  const cancellation = new AbortController()
  const abort = () => cancellation.abort(signal?.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  let ownership: Promise<() => void> | undefined, release: (() => void) | undefined
  let closed = false
  return Object.assign(
    {
      ...source,
      size: source.size,
      assertUnchanged: () => source.assertUnchanged(),
      read: async (offset: number, length: number, readSignal?: AbortSignal) => {
        if (closed) throw new Error('Large source closed')
        readSignal?.throwIfAborted()
        const abortRead = () => cancellation.abort(readSignal?.reason)
        readSignal?.addEventListener('abort', abortRead, { once: true })
        try {
          release = await (ownership ??= mobileLargeFileGate.acquire(cancellation.signal))
        } finally {
          readSignal?.removeEventListener('abort', abortRead)
        }
        if (closed) throw new Error('Large source closed')
        return source.read(offset, length, readSignal ?? signal)
      },
      close: async () => {
        if (closed) return
        closed = true
        cancellation.abort(new Error('Large source closed'))
        try {
          release ??= await ownership?.catch((): undefined => undefined)
          await source.close()
        } finally {
          signal?.removeEventListener('abort', abort)
          release?.()
        }
      },
    },
    { [MOBILE_LARGE_SOURCE]: true }
  )
}
