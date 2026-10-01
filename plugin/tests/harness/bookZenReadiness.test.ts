import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WAIT_PRELUDE } from '../e2e/helpers/wait'

const source = readFileSync(resolve(__dirname, '../e2e/bookZen.e2e.test.ts'), 'utf8')
const template = source.match(/const PRELUDE = `([\s\S]*?)`\n/)![1]
const prelude = new Function('WAIT_PRELUDE', 'SHOTS', `return \`${template}\``)(WAIT_PRELUDE, '')

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('rejects a zen transition with visible navigation and reports the active leaf and chrome', async () => {
  vi.useFakeTimers()
  const containerEl = {
    classList: { contains: () => true },
    querySelector: (selector: string) => ({
      getBoundingClientRect: () => ({ height: selector.includes('stage') ? 900 : 40 }),
    }),
    getAnimations: () => [],
  }
  const view = {
    containerEl,
    contentEl: containerEl,
    model: { zenPeek: false },
    zenChrome: { host: { phone: true, front: () => true } },
  }
  const leaf = { id: 'sample-book', view }
  const document = {
    body: { classList: { contains: () => false } },
    querySelector: () => ({ isConnected: true, getAnimations: () => [] }),
  }
  const waitZen = new Function(
    'window',
    'require',
    'app',
    'document',
    'getComputedStyle',
    `${prelude}; return waitZen`
  )(
    { __abeleTest: { reader: { zen: { state: () => ({ on: true }) } } } },
    () => ({ getCurrentWebContents: () => ({ debugger: {} }) }),
    {
      isMobile: true,
      mobileNavbar: { hideNavigation() {}, restoreNavigation() {} },
      workspace: { activeLeaf: leaf },
    },
    document,
    () => ({ opacity: '1' })
  ) as (
    leaf: unknown,
    view: unknown,
    on: boolean,
    beforeHeight: number,
    phone: boolean
  ) => Promise<void>
  const result = waitZen(leaf, view, true, 800, true).catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(16000)
  const error = (await result) as Error
  expect(error).toBeInstanceOf(Error)
  expect(error.message).toContain('zen transition')
  expect(error.message).toContain('sample-book')
  expect(error.message).toContain('"on":true')
  expect(error.message).toContain('"hidden":false')
  expect(error.message).toContain('"navbarOpacity":"1"')
})

it('reloads phone emulation at the confirmed narrow viewport before opening the reader', async () => {
  const setup = source
    .match(/it\('on a phone,[\s\S]*?async \(\) => \{([\s\S]*?)\n {4}const r = run</)![1]
    .replace(/evalJson<boolean>/g, 'evalJson')
  const steps: string[] = []
  await new Function(
    'reload',
    'evalRaw',
    'WINDOW',
    'until',
    'evalJson',
    `return (async () => { ${setup} })()`
  )(
    async (how: string) => {
      steps.push(how)
    },
    () => {
      steps.push('resize')
    },
    'sampleWindow',
    async (condition: () => boolean) => {
      steps.push('viewport ready')
      return condition()
    },
    () => true
  )
  expect(steps).toEqual([
    'app.emulateMobile(true)',
    'resize',
    'viewport ready',
    'location.reload()',
  ])
})

it('restores desktop emulation and the viewport even when fixture cleanup fails, without re-enabling debug', async () => {
  const cleanup = source
    .match(/afterAll\(async \(\) => \{([\s\S]*?)\n {2}\}, 120_000\)/)![1]
    .replace(/evalJson<boolean>/g, 'evalJson')
  const evalRaw = vi.fn((code: string) => {
    if (code.includes('const dir =')) throw new Error('fixture cleanup failed')
    return code.includes('String(app.isMobile)') ? 'true' : 'ok'
  })
  const reloadApp = vi.fn().mockResolvedValue(undefined)
  const reload = vi.fn()
  const restore = new Function(
    'evalRaw',
    'reloadApp',
    'reload',
    'evalJson',
    'until',
    'DIR',
    'savedReader',
    'size',
    'WINDOW',
    `return (async () => { ${cleanup} })()`
  )
  await expect(
    restore(
      evalRaw,
      reloadApp,
      reload,
      () => true,
      (condition: () => boolean) => condition(),
      'sample-books',
      {},
      [1280, 800],
      'sampleWindow'
    )
  ).rejects.toThrow('fixture cleanup failed')
  expect(reloadApp).toHaveBeenCalledExactlyOnceWith('app.emulateMobile(false)')
  expect(reload).not.toHaveBeenCalled()
  expect(evalRaw.mock.calls.some(([code]) => code.includes('setContentSize(1280, 800)'))).toBe(true)
})

it('rejects an unready zen reader rather than continuing after the polling deadline', async () => {
  vi.useFakeTimers()
  const leaf = {
    setViewState: vi.fn().mockResolvedValue(undefined),
    view: { model: { status: 'loading', panel: false } },
  }
  const open = new Function('window', 'require', 'app', `${prelude}; return open`)(
    { __abeleTest: { reader: {} } },
    () => ({ getCurrentWebContents: () => ({ debugger: {} }) }),
    { workspace: { getLeavesOfType: () => [], getLeaf: () => leaf } }
  ) as (path: string) => Promise<unknown>
  const result = open('sample-book.epub').catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(16000)
  expect(await result).toBeInstanceOf(Error)
  expect(((await result) as Error).message).toMatch(/reader.*ready/i)
})
