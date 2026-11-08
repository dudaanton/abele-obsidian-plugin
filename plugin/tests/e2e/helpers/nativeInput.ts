import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const INPUT_LOCK = join(tmpdir(), 'abele-e2e-native-input.lock')

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
  const release = await acquireNativeInput(lock, timeoutMs, fs, process)
  try {
    return await sequence()
  } finally {
    release()
  }
}

// Self-contained so the same lock protocol can run inside a renderer probe.
async function acquireNativeInput(
  lock: string,
  timeoutMs: number,
  fileSystem: typeof fs,
  owner: Pick<NodeJS.Process, 'pid' | 'kill'>
): Promise<() => void> {
  const deadline = Date.now() + timeoutMs
  const ownerFile = lock + '/' + owner.pid
  for (;;) {
    try {
      fileSystem.mkdirSync(lock)
      fileSystem.writeFileSync(ownerFile, '')
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const owners = fileSystem.readdirSync(lock)
        if (owners.length === 1 && /^\d+$/.test(owners[0])) {
          try {
            owner.kill(Number(owners[0]), 0)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
              // Only the worker that removed this owner's file reaps the directory. A second
              // waiter must not unlink a new owner's lock after the first has taken it away.
              fileSystem.unlinkSync(lock + '/' + owners[0])
              fileSystem.rmdirSync(lock)
            }
          }
        }
      } catch {
        /* Released between attempts. */
      }
      if (Date.now() >= deadline) throw new Error('native input lock was not released in time')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  return () => {
    fileSystem.unlinkSync(ownerFile)
    fileSystem.rmdirSync(lock)
  }
}

type SendInput = (method: string, params: Record<string, unknown>) => Promise<unknown>

/** Pair native downs and ups while leaving setup, idle waits and captures outside the lane. */
function createInputDispatch(send: SendInput, acquire: () => Promise<() => void>) {
  let release: (() => void) | undefined
  let ending: [string, Record<string, unknown>] | undefined
  const close = async () => {
    try {
      if (ending) await send(...ending)
    } finally {
      ending = undefined
      release?.()
      release = undefined
    }
  }
  const dispatch: SendInput = async (method, params) => {
    if (!method.startsWith('Input.')) return send(method, params)
    if (!release) release = await acquire()
    const type = params.type
    if (type === 'keyDown' || type === 'rawKeyDown') ending = [method, { ...params, type: 'keyUp' }]
    else if (type === 'mousePressed')
      ending = [method, { ...params, type: 'mouseReleased', buttons: 0 }]
    else if (type === 'touchStart') ending = [method, { type: 'touchEnd', touchPoints: [] }]
    try {
      const result = await send(method, params)
      if (type === 'keyUp' || type === 'mouseReleased' || type === 'touchEnd') ending = undefined
      return result
    } catch (error) {
      // A lost down response may still mean the event was delivered. Release its native state.
      await close()
      throw error
    } finally {
      if (!ending) {
        release?.()
        release = undefined
      }
    }
  }
  return { dispatch, close }
}

/** Add gesture-scoped locking to a renderer probe's explicit CDP port. */
export function nativeInputProbe(source: string, lock = INPUT_LOCK): string {
  const port = 'const cdp = (method, params) => debuggerApi.sendCommand(method, params)'
  if (!source.includes(port)) throw new Error('Native input probe has no explicit CDP port')
  const wrapped = source
    .replace(port, 'const cdp = nativeDispatch.dispatch')
    .replaceAll('debuggerApi.detach()', '(await nativeDispatch.close(), debuggerApi.detach())')
  return `(async () => {
    const debuggerApiPort = require('@electron/remote').getCurrentWebContents().debugger
    const nativeDispatch = (${createInputDispatch.toString()})(
      (method, params) => debuggerApiPort.sendCommand(method, params),
      () => (${acquireNativeInput.toString()})(${JSON.stringify(lock)}, 60000, require('node:fs'),
        { pid: ${process.pid}, kill: (...args) => require('node:process').kill(...args) })
    )
    try { return await (${wrapped}) }
    finally { await nativeDispatch.close() }
  })()`
}
