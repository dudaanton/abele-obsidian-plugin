type Call = { operation: string; path: string; startedAt: number; returned: boolean }
const pending = new Map<number, Call>()
let next = 0,
  count = 0

/** Promise-boundary evidence only: no payloads, polling, or retained promise objects. */
export async function observePortableIo<T>(
  operation: string,
  path: string,
  invoke: () => T | PromiseLike<T>
): Promise<T> {
  const id = ++next
  const row = { operation, path, startedAt: Date.now(), returned: false }
  count++
  if (pending.size < 64) pending.set(id, row)
  try {
    const result = invoke()
    row.returned = true
    return await result
  } finally {
    count--
    pending.delete(id)
  }
}

export function portableIoSnapshot() {
  const now = Date.now()
  return {
    pendingCount: count,
    pending: [...pending.values()]
      .slice(0, 16)
      .map((row) => ({ ...row, elapsedMs: now - row.startedAt })),
  }
}
