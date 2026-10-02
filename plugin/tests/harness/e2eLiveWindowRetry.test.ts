import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { transformSync } from 'esbuild'
import { expect, it, vi } from 'vitest'

it('does not wrap an exhausted helper retry in another retry at the file boundary', () => {
  const source = readFileSync(join(__dirname, '../e2e/helpers/liveWindow.ts'), 'utf8')
  const code = transformSync(source, { loader: 'ts', format: 'cjs' }).code
  let setup!: () => void
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
      beforeAll: (fn: () => void) => {
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
  expect(setup).toThrow('3 attempts')
  expect(focus).toHaveBeenCalledOnce()
})
