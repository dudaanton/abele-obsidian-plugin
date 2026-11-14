import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import Module from 'node:module'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { script, endScript, followScript, handoffScript } from '../e2e/helpers/chatScrollMatrix'
import { nativeInputProbe, withNativeInput } from '../e2e/helpers/nativeInput'

vi.mock('../e2e/helpers/shots', () => ({ shotDir: () => '/sample-shots' }))

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(process.cwd(), 'node_modules/gesture-ownership-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const probes = [
  ['matrix', (phone: boolean) => script('short', 'idle', phone)],
  ['End', (phone: boolean) => endScript('short', 'text', phone)],
  ['follow', followScript],
  ['handoff', handoffScript],
] as const

it.each(probes.flatMap(([name, build]) => [false, true].map((phone) => ({ name, build, phone }))))(
  'owns all receipt waits and final measurement in $name (touch=$phone)',
  async ({ build, phone }) => {
    await checkGesture(build(phone), phone, false)
  }
)

it.each([false, true])('releases an interrupted measured gesture (touch=%s)', async (phone) => {
  await checkGesture(script('short', 'idle', phone), phone, true)
})

async function checkGesture(source: string, phone: boolean, fail: boolean) {
  // Execute the generated probe's actual measured gesture, supplying only its
  // surrounding fixture. This catches gaps at the 24ms wait and after touchend.
  const start = source.indexOf('  const gesture = async ')
  const end = source.indexOf('  const hold = async ', start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  const lock = join(dir, 'input.lock')
  const events: string[] = []
  let competing: Promise<void> | undefined
  const element = {
    get scrollTop() {
      expect(existsSync(lock)).toBe(true)
      return 1000
    },
    scrollHeight: 5000,
    clientHeight: 400,
    getBoundingClientRect: () => {
      expect(existsSync(lock)).toBe(true)
      return { left: 0, top: 0, width: 300, height: 400 }
    },
    querySelector: () => null,
  }
  const debuggerApi = {
    sendCommand: async (_method: string, params: { type: string }) => {
      expect(existsSync(lock)).toBe(true)
      events.push(params.type)
    },
  }
  const held = (ms: number) => {
    expect(existsSync(lock)).toBe(true)
    events.push(`wait-${ms}`)
    competing ??= withNativeInput(() => {
      events.push('competitor')
    }, lock)
    if (fail) throw new Error('receipt interrupted')
  }
  const between = async () => {
    await competing
    await withNativeInput(() => {}, lock, 0)
  }
  const nodeRequire = Module.createRequire(import.meta.url)
  const requireProbe = (name: string) =>
    name === '@electron/remote'
      ? { getCurrentWebContents: () => ({ debugger: debuggerApi }) }
      : nodeRequire(name)
  const program = `(async () => {
    const cdp = (method, params) => debuggerApi.sendCommand(method, params)
    const inputGesture = async run => run()
    const box = () => element, visibleAnchor = () => null, offset = () => 0, item = () => null
    const phone = ${phone}, size = 'short', state = 'idle', session = { messages: { value: [] } }
    const row = { move: 'one screen up', moved: 0, requested: 0, lost: 0 }, trace = []
    let gestureIndex = 0, receivedInputs = 0, deliveredDelta, touchY, pendingDirection, direction
    let gestureAnchor, measureInputStart, measureWheelReceipt, measureFollowingOrigin, boundaryGeometry
    let gestureActive = false, touchDown = false
    const wait = async ms => { held(ms); await Promise.resolve() }
    ${source.slice(start, end)}
    await between()
    try { await gesture(-120, 3) }
    finally {
      // The full probe also has this outer fallback. A gesture scope that has
      // already ended native touch must retire its caller's flag before this fallback.
      if (touchDown) await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    await between()
    return row.gestures.length
  })()`
  const execute = new Function(
    'require',
    'debuggerApi',
    'element',
    'held',
    'between',
    `return ${nativeInputProbe(program, lock)}`
  )
  try {
    const result = execute(requireProbe, debuggerApi, element, held, between)
    if (fail) await expect(result).rejects.toThrow('receipt interrupted')
    else {
      await expect(result).resolves.toBe(1)
      expect(events).toContain('wait-24')
      expect(events).toContain('wait-100')
    }
  } finally {
    await competing
  }
  expect(events.at(-1)).toBe('competitor')
  if (phone) expect(events.filter((event) => event === 'touchEnd')).toHaveLength(1)
  expect(existsSync(lock)).toBe(false)
}
