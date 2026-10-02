import { mkdirSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const INPUT_LOCK = join(tmpdir(), 'abele-e2e-native-input.lock')
const pause = () => new Promise((resolve) => setTimeout(resolve, 50))

/**
 * Native CDP input shares Electron's keyboard/mouse state across pool windows. Hold the lock
 * from down through up, never just for a single event. Wait asynchronously so the test worker
 * stays reachable. A slow but live owner must not lose its lock, and a failed event is not replayed.
 */
export async function withNativeInput<T>(
  sequence: () => T | Promise<T>,
  lock = INPUT_LOCK,
  timeoutMs = 60_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  const ownerFile = join(lock, String(process.pid))
  for (;;) {
    try {
      mkdirSync(lock)
      writeFileSync(ownerFile, '')
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const owners = readdirSync(lock)
        if (owners.length === 1 && /^\d+$/.test(owners[0])) {
          try {
            process.kill(Number(owners[0]), 0)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
              // Only the worker that removed this owner's file reaps the directory. A second
              // waiter must not unlink a new owner's lock after the first has taken it away.
              unlinkSync(join(lock, owners[0]))
              rmdirSync(lock)
            }
          }
        }
      } catch {
        /* Released between attempts. */
      }
      if (Date.now() >= deadline) throw new Error('native input lock was not released in time')
      await pause()
    }
  }
  try {
    return await sequence()
  } finally {
    unlinkSync(ownerFile)
    rmdirSync(lock)
  }
}
