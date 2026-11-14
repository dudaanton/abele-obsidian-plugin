import { afterEach, expect, it, vi } from 'vitest'

type Callback = () => unknown
type Suite = {
  name: string
  setup: Callback[]
  before: Callback[]
  cleanup: Callback[]
  cases: Callback[]
}

const suites: Suite[] = []
let current: Suite
const evaluate = vi.fn<(code: string, timeout: number) => string>()
const tap = vi.fn()
let canSaveEvidence = true

afterEach(() => {
  vi.doUnmock('vitest')
  vi.doUnmock('../e2e/helpers/obsidianCli')
  vi.doUnmock('../e2e/helpers/phone')
  vi.doUnmock('../e2e/helpers/columnFlightEvidence')
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

async function collect(arm?: string) {
  vi.resetModules()
  vi.stubEnv('E2E_TARGET', 'phone')
  vi.stubEnv('ABELE_COLUMNS_STRESS', arm)
  vi.spyOn(console, 'info').mockImplementation(() => {})
  suites.length = 0
  evaluate
    .mockReset()
    .mockImplementation((code) => (code.includes('return localStorage.getItem') ? 'null' : 'true'))
  tap.mockReset()
  canSaveEvidence = true
  const test = Object.assign((_: string, callback: Callback) => current.cases.push(callback), {
    each: (values: number[]) => (_: string, callback: (start: number) => unknown) => {
      for (const value of values) current.cases.push(() => callback(value))
    },
  })
  vi.doMock('vitest', () => ({
    expect,
    it: test,
    describe: {
      runIf: (enabled: boolean) => (name: string, callback: Callback) => {
        if (!enabled) return
        current = { name, setup: [], before: [], cleanup: [], cases: [] }
        suites.push(current)
        callback()
      },
    },
    beforeAll: (callback: Callback) => current.setup.push(callback),
    beforeEach: (callback: Callback) => current.before.push(callback),
    afterAll: (callback: Callback) => current.cleanup.push(callback),
  }))
  vi.doMock('../e2e/helpers/obsidianCli', () => ({ evalRaw: evaluate }))
  vi.doMock('../e2e/helpers/phone', () => ({ tap }))
  vi.doMock('../e2e/helpers/columnFlightEvidence', () => ({
    saveColumnFlightAfterRecovery: () => canSaveEvidence,
  }))
  await import('../e2e/columnsFreezeStress.e2e.test')
  return { suites, evaluate, tap }
}

it('does no device work when the opt-in variable is absent', async () => {
  const f = await collect()
  expect(f.suites).toHaveLength(0)
  expect(f.evaluate).not.toHaveBeenCalled()
  expect(f.tap).not.toHaveBeenCalled()
})

it('does not restore an active recorder over unsaved evidence during cleanup', async () => {
  const f = await collect('on')
  f.evaluate.mockImplementation((code) =>
    code.includes('return localStorage.getItem') ? '"123"' : 'true'
  )
  for (const setup of f.suites[0].setup) await setup()
  canSaveEvidence = false
  const before = f.evaluate.mock.calls.length
  for (const cleanup of f.suites[0].cleanup) await cleanup()
  expect(
    f.evaluate.mock.calls.slice(before).some(([code]) => code.includes('localStorage.setItem'))
  ).toBe(false)
})

it.each(['off', 'on'])(
  'selects the %s recorder arm and opens a source editor before stress',
  async (arm) => {
    const f = await collect(arm)
    expect(f.suites.map((suite) => suite.cases.length)).toEqual([11, 10])
    for (const setup of f.suites[1].setup) await setup()
    const scripts = f.evaluate.mock.calls.map(([code]) => code)
    expect(
      scripts.some((code) =>
        code.includes(arm === 'on' ? 'localStorage.setItem' : 'localStorage.removeItem')
      )
    ).toBe(true)
    expect(
      scripts.some((code) => code.includes('leaf.setViewState') && code.includes('mode:"source"'))
    ).toBe(true)
  }
)

it('names a hung iteration and step, bounds transport attempts, and stops later device work', async () => {
  const f = await collect('on')
  const suite = f.suites[0]
  for (const setup of suite.setup) await setup()
  for (const before of suite.before) await before()
  f.evaluate.mockImplementation(() => {
    throw new Error('the phone gave no answer')
  })
  await expect(suite.cases[1]()).rejects.toThrow(
    'nested arm=on iteration=1 step=replace editor source: eval did not answer'
  )
  expect(f.evaluate.mock.calls.at(-1)?.[1]).toBe(8000)
  const calls = f.evaluate.mock.calls.length
  expect(() => suite.before[0]()).toThrow('Phone stopped answering')
  for (const cleanup of suite.cleanup) await cleanup()
  expect(f.evaluate).toHaveBeenCalledTimes(calls)
})
