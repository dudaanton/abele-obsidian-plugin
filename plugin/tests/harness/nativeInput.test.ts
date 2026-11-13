import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  utimesSync,
} from 'node:fs'
import { spawn } from 'node:child_process'
import { buildSync } from 'esbuild'
import { join } from 'node:path'
import Module from 'node:module'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { withNativeInput, nativeInputProbe } from '../e2e/helpers/nativeInput'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(process.cwd(), 'node_modules/native-input-test-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

it('serves an already waiting gesture before a newly arriving gesture', async () => {
  const lock = join(dir, 'fair.lock')
  const events: string[] = []
  let finish!: () => void
  const held = new Promise<void>((resolve) => {
    finish = resolve
  })
  const first = withNativeInput(() => held, lock)
  const waiting = withNativeInput(() => {
    events.push('waiting')
  }, lock)
  await new Promise((resolve) => setTimeout(resolve, 20))
  finish()
  await first
  const newcomer = withNativeInput(() => {
    events.push('newcomer')
  }, lock)
  await Promise.all([waiting, newcomer])
  expect(events).toEqual(['waiting', 'newcomer'])
})

it('keeps complete input sequences together, not individual events', async () => {
  const events: string[] = []
  const lock = join(dir, 'input.lock')
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const first = withNativeInput(async () => {
    events.push('down-a')
    await held
    events.push('up-a')
  }, lock)
  const second = withNativeInput(() => {
    events.push('down-b', 'up-b')
  }, lock)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(events).toEqual(['down-a'])
  release()
  await Promise.all([first, second])
  expect(events).toEqual(['down-a', 'up-a', 'down-b', 'up-b'])
})

it('releases a failed sequence without retrying its events', async () => {
  const lock = join(dir, 'input.lock')
  let calls = 0
  await expect(
    withNativeInput(() => {
      calls++
      throw new Error('lost key answer')
    }, lock)
  ).rejects.toThrow('lost key answer')
  await withNativeInput(() => {
    calls++
  }, lock)
  expect(calls).toBe(2)
})

it('serializes sequences in independent worker processes', async () => {
  const bundle = join(dir, 'input.mjs')
  buildSync({
    entryPoints: [join(__dirname, '../e2e/helpers/nativeInput.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundle,
  })
  const lock = join(dir, 'process.lock'),
    log = join(dir, 'events')
  const worker = (name: string) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
      import { withNativeInput } from ${JSON.stringify(bundle)}
      import { appendFileSync } from 'node:fs'
      await withNativeInput(async () => {
        appendFileSync(${JSON.stringify(log)}, 'down-${name}\\n')
        await new Promise(r => setTimeout(r, 100))
        appendFileSync(${JSON.stringify(log)}, 'up-${name}\\n')
      }, ${JSON.stringify(lock)})
    `,
        ],
        { stdio: 'pipe' }
      )
      child.on('error', reject)
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error('input worker exited: ' + code))
      )
    })
  await Promise.all([worker('a'), worker('b')])
  const events = readFileSync(log, 'utf8').trim().split('\n')
  expect(events).toEqual(
    events[0] === 'down-a'
      ? ['down-a', 'up-a', 'down-b', 'up-b']
      : ['down-b', 'up-b', 'down-a', 'up-a']
  )
})

it('never steals an old lock held by a live worker', async () => {
  const lock = join(dir, 'input.lock')
  mkdirSync(lock)
  writeFileSync(join(lock, String(process.pid)), '')
  utimesSync(lock, new Date(0), new Date(0))
  await expect(withNativeInput(() => {}, lock, 0)).rejects.toThrow('native input lock')
  expect(readdirSync(lock + '.queue')).toEqual([])
})

it('reaps a dead waiting worker before serving the next gesture', async () => {
  const lock = join(dir, 'dead-waiter.lock')
  mkdirSync(lock + '.queue')
  writeFileSync(join(lock + '.queue', '0000000000000000-2147483647-stale'), '')
  await withNativeInput(() => {}, lock, 0)
  expect(readdirSync(lock + '.queue')).toEqual([])
})

it('leaves the lane free between probe gestures and releases a failed down', async () => {
  const lock = join(dir, 'probe.lock')
  const source = `(async () => {
    const cdp = (method, params) => debuggerApi.sendCommand(method, params)
    await between()
    await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'End' })
  })()`
  const events: string[] = []
  const debuggerApi = {
    sendCommand: async (_method: string, params: { type: string }) => {
      events.push(params.type)
      if (params.type === 'rawKeyDown') throw new Error('lost answer')
    },
  }
  const between = () =>
    withNativeInput(
      () => {
        events.push('other gesture')
      },
      lock,
      0
    )
  const execute = new Function(
    'require',
    'debuggerApi',
    'between',
    `return ${nativeInputProbe(source, lock)}`
  )
  const nodeRequire = Module.createRequire(import.meta.url)
  const requireProbe = (name: string) =>
    name === '@electron/remote'
      ? { getCurrentWebContents: () => ({ debugger: debuggerApi }) }
      : nodeRequire(name)
  await expect(execute(requireProbe, debuggerApi, between)).rejects.toThrow('lost answer')
  expect(events).toEqual(['other gesture', 'rawKeyDown', 'keyUp'])
  await withNativeInput(() => {}, lock, 0)
})

it('holds touch, drag and keyboard pairs but frees the lane during probe idle work', async () => {
  const lock = join(dir, 'probe.lock')
  const events: string[] = []
  const source = `(async () => {
    const cdp = (method, params) => debuggerApi.sendCommand(method, params)
    for (const [method, down, up] of pairs) {
      await between()
      await cdp(method, { type: down })
      held()
      await cdp(method, { type: up })
      await between()
    }
    await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel' })
    await between()
    return 'finished'
  })()`
  const debuggerApi = {
    sendCommand: async (_method: string, params: { type: string }) => {
      expect(existsSync(lock)).toBe(true)
      events.push(params.type)
    },
  }
  const nodeRequire = Module.createRequire(import.meta.url)
  const requireProbe = (name: string) =>
    name === '@electron/remote'
      ? { getCurrentWebContents: () => ({ debugger: debuggerApi }) }
      : nodeRequire(name)
  const execute = new Function(
    'require',
    'debuggerApi',
    'pairs',
    'between',
    'held',
    `return ${nativeInputProbe(source, lock)}`
  )
  const pairs = [
    ['Input.dispatchTouchEvent', 'touchStart', 'touchEnd'],
    ['Input.dispatchMouseEvent', 'mousePressed', 'mouseReleased'],
    ['Input.dispatchKeyEvent', 'rawKeyDown', 'keyUp'],
  ]
  const between = () => withNativeInput(() => {}, lock, 0)
  const held = () => expect(existsSync(lock)).toBe(true)
  await expect(execute(requireProbe, debuggerApi, pairs, between, held)).resolves.toBe('finished')
  expect(events).toEqual([...pairs.flatMap(([, down, up]) => [down, up]), 'mouseWheel'])
  expect(existsSync(lock)).toBe(false)
})

it('rejects a probe without an explicit input port instead of silently running unlocked', () => {
  expect(() => nativeInputProbe('(async () => {})()')).toThrow('no explicit CDP port')
})

it('ends an interrupted gesture before the probe detaches its debugger', async () => {
  const lock = join(dir, 'probe.lock')
  const events: string[] = []
  const source = `(async () => {
    const cdp = (method, params) => debuggerApi.sendCommand(method, params)
    try {
      await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 1, y: 1 }] })
      throw new Error('probe interrupted')
    } finally {
      debuggerApi.detach()
    }
  })()`
  const debuggerApi = {
    sendCommand: async (_method: string, params: { type: string }) => {
      expect(existsSync(lock)).toBe(true)
      events.push(params.type)
    },
    detach: () => {
      expect(existsSync(lock)).toBe(false)
      events.push('detach')
    },
  }
  const nodeRequire = Module.createRequire(import.meta.url)
  const requireProbe = (name: string) =>
    name === '@electron/remote'
      ? { getCurrentWebContents: () => ({ debugger: debuggerApi }) }
      : nodeRequire(name)
  const execute = new Function('require', 'debuggerApi', `return ${nativeInputProbe(source, lock)}`)
  await expect(execute(requireProbe, debuggerApi)).rejects.toThrow('probe interrupted')
  expect(events).toEqual(['touchStart', 'touchEnd', 'detach'])
})
