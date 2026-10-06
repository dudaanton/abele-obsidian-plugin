import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { transformSync } from 'esbuild'
import { expect, it, vi } from 'vitest'

it('does not wrap an exhausted helper retry in another retry at the file boundary', async () => {
  const source = readFileSync(join(__dirname, '../e2e/helpers/liveWindow.ts'), 'utf8')
  const code = transformSync(source, { loader: 'ts', format: 'cjs' }).code
  let setup!: () => Promise<void>
  const focus = vi.fn(() => {
    throw new Error('obsidian dev:cdp gave no answer (3 attempts; idempotent retry exhausted)')
  })
  const cli = Object.fromEntries(
    [
      'assertWindowDrawn',
      'closeStrayWindows',
      'notesInEditor',
      'setBackgroundThrottling',
      'useDomMenus',
      'waitForLinkIndex',
    ].map((name) => [name, vi.fn()])
  )
  const imports: Record<string, unknown> = {
    vitest: {
      beforeAll: (fn: () => Promise<void>) => {
        setup = fn
      },
      afterAll: () => {},
      beforeEach: () => {},
    },
    './obsidianCli': { ...cli, isObsidianRunning: () => true, setFocusEmulation: focus },
    './target': { onPhone: () => false },
    './phone': {},
  }
  new Function('require', 'exports', code)((name: string) => imports[name], {})
  await expect(setup()).rejects.toThrow('3 attempts')
  expect(focus).toHaveBeenCalledOnce()
})

it('reports every cleanup failure while still checking current and saved root ownership', async () => {
  const source = readFileSync(join(__dirname, '../e2e/helpers/liveWindow.ts'), 'utf8')
  const code = transformSync(source, { loader: 'ts', format: 'cjs' }).code
  let setup!: () => Promise<void>, teardown!: () => Promise<void>
  const close = vi.fn()
  const current = vi.fn(() => {
    throw Error('current root leak')
  })
  const saved = vi.fn(async () => {
    throw Error('saved root leak')
  })
  const noop = () => {}
  const imports: Record<string, unknown> = {
    vitest: {
      beforeAll: (fn: () => Promise<void>) => {
        setup = fn
      },
      afterAll: (fn: () => Promise<void>) => {
        teardown = fn
      },
      beforeEach: noop,
    },
    './obsidianCli': {
      isObsidianRunning: () => true,
      closeStrayWindows: close,
      notesInEditor: noop,
      setBackgroundThrottling: noop,
      setFocusEmulation: noop,
      useDomMenus: noop,
      waitForLinkIndex: noop,
      assertWindowDrawn: noop,
    },
    './target': { onPhone: () => false },
    './phone': {},
    './rootViews': { snapshotRootViews: () => [], assertNoLeakedRootViews: current },
    './savedRootViews': {
      snapshotSavedRootViews: async () => ({}),
      assertNoLeakedSavedRootViews: saved,
    },
  }
  new Function('require', 'exports', code)((name: string) => imports[name], {})
  await setup()
  close.mockImplementation(() => {
    throw Error('window cleanup failure')
  })
  const failure = (await teardown().catch((error) => error)) as AggregateError
  expect(failure.errors.map(String)).toEqual([
    'Error: window cleanup failure',
    'Error: current root leak',
    'Error: saved root leak',
  ])
  expect(current).toHaveBeenCalledOnce()
  expect(saved).toHaveBeenCalledOnce()
})
