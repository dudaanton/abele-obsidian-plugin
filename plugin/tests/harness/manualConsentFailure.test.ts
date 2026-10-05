import { readFileSync } from 'node:fs'
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript'
import { expect, it, vi } from 'vitest'

/** Captures the actual E2E consumer callback with transport mocks; it never drives Obsidian. */
function actualConsumer(faults: {
  probe?: Error
  browser?: Error
  resize?: Error
  reload?: Error
}) {
  const callbacks: Array<() => Promise<void>> = []
  const raw = readFileSync('tests/e2e/manualKeyConsent.e2e.test.ts', 'utf8').replace(
    /^import[\s\S]*?from '[^']+'\n/gm,
    ''
  )
  const js = transpileModule(raw, {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext },
  }).outputText
  const evalLong = vi.fn(async (code: string) => {
    if (code === 'sample-setup') {
      if (faults.probe) throw faults.probe
      return '[]'
    }
    if (code.includes('s.cleanup()')) {
      if (faults.browser) throw faults.browser
      return JSON.stringify({
        aiRestored: true,
        localRestored: true,
        keyRemoved: true,
        modalClosed: true,
        activeRestored: true,
        layoutRestored: true,
        keyboard: 0,
        windowRestored: true,
        themeRestored: true,
        panesRestored: true,
      })
    }
    if (code.includes('identity')) return JSON.stringify({ assets: [] })
    if (code.includes('s.shot')) return JSON.stringify('/sample.png')
    return JSON.stringify({
      blockedBefore: true,
      callsBefore: 0,
      empty: true,
      masked: true,
      summary: true,
      secretAbsentFromText: true,
      outside: [],
      ringCuts: [],
      exactProtectedValue: true,
      pair: ['http://192.168.42.12:8123'],
      secretAbsentFromSettings: true,
      secretAbsentFromLocal: true,
      callsAfterConsent: 0,
      literalUnchanged: true,
      retry: true,
      callsAfterRetry: 1,
      blockedAfterRemoval: true,
      callsAfterRemoval: 1,
    })
  })
  const evalRaw = vi.fn((code: string) => {
    if (code.includes('1280,800') && faults.resize) throw faults.resize
    return 'ok'
  })
  const reloadApp = vi.fn(async (code: string) => {
    if (code.includes('false') && faults.reload) throw faults.reload
  })
  const describe = {
    skipIf: () => ({
      each: (modes: string[]) => (_name: string, callback: (mode: string) => void) =>
        modes.forEach(callback),
    }),
  }
  const deps = {
    describe,
    expect,
    it: (_name: string, callback: () => Promise<void>) => callbacks.push(callback),
    existsSync: () => true,
    readFileSync: () => '',
    createHash: () => ({ update: () => ({ digest: () => '' }) }),
    join: (...x: string[]) => x.join('/'),
    evalJson: () => [1280, 800],
    evalLong,
    evalRaw,
    hasTestApi: () => true,
    isObsidianRunning: () => true,
    reloadApp,
    driver: vi.fn(),
    shotDir: () => '/sample',
    onPhone: () => false,
    targets: () => {},
    manualKeyConsentProbe: () => 'sample-setup',
    stagedNativeControl: vi.fn(),
    nativeControlFrame: vi.fn(),
  }
  new Function(...Object.keys(deps), js)(...Object.values(deps))
  return { run: callbacks[1], evalLong, evalRaw, reloadApp }
}

it.each(['resize', 'reload'] as const)(
  'keeps first probe failure primary when browser cleanup and %s restoration also fail',
  async (stage) => {
    const probe = new Error('sample first probe failure'),
      browser = new Error('sample browser cleanup failure'),
      last = new Error('sample restoration failure')
    const c = actualConsumer({ probe, browser, [stage]: last })
    await expect(c.run()).rejects.toBe(probe)
    expect(c.reloadApp.mock.calls.filter(([code]) => code.includes('false'))).toHaveLength(1)
  }
)
it('keeps browser-cleanup failure primary when reload later fails after an otherwise successful probe', async () => {
  const browser = new Error('sample first cleanup failure'),
    reload = new Error('sample later reload failure')
  await expect(actualConsumer({ browser, reload }).run()).rejects.toBe(browser)
})
it('fails a sole restoration error instead of hiding it behind successful checks', async () => {
  const reload = new Error('sample sole reload failure')
  await expect(actualConsumer({ reload }).run()).rejects.toBe(reload)
})
