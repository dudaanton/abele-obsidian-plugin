import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Execute the real lifecycle body, with feature work replaced by named no-ops. This tests
// the placement of the boundaries without importing the entire plugin into the fake DOM.
const source = readFileSync('src/main.ts', 'utf8')
const file = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true)
const plugin = file.statements.find(ts.isClassDeclaration)!
const body = plugin.members.find((m) => m.name?.getText(file) === 'onload') as ts.MethodDeclaration
const js = ts.transpile(`async function load() ${body.body!.getText(file)}`, {
  target: ts.ScriptTarget.ES2022,
})

describe('startup mark boundaries', () => {
  it.each([false, true])('brackets every synchronous phase with AI enabled=%s', async (enabled) => {
    for (const ready of [false, true]) {
      const events: string[] = ['evalStart', 'evalEnd']
      const callbacks: Array<() => void> = []
      const workspace = {
        onLayoutReady(fn: () => void) {
          ready ? fn() : callbacks.push(fn)
        },
      }
      const noop = () => {}
      const config = { init: noop, ai: { enabled } }
      const names = {
        markLoad: (name: string) => events.push(name),
        beginStartup: noop,
        dayjs: { extend: noop },
        weekday: {},
        updateLocale: {},
        dayOfYear: {},
        AbeleConfig: { getInstance: () => config },
        window: {},
        document: { body: { classList: { add: noop } } },
        startupStepAsync: async (name: string) => {
          events.push(name)
        },
        startupStep: (name: string) => {
          events.push(name)
        },
        createPluginSecrets: () => ({}),
        setSecrets: noop,
        initializeDestinations: noop,
        setRequestGuard: noop,
        setKeyboardDiagnostics: noop,
        process: { env: { NODE_ENV: 'production' } },
        AbeleSettingTab: class {},
        registerFocusRelease: noop,
        console: { debug: noop },
      }
      const load = new Function(...Object.keys(names), `${js}; return load`)(
        ...Object.values(names)
      )
      const instance = { app: { workspace }, starting: true, addSettingTab: noop }
      await load.call(instance)
      expect(events.at(-1)).toBe('onloadEnd')
      callbacks.forEach((fn) => fn())
      expect(instance.starting).toBe(false)
      for (const name of [
        'evalStart',
        'evalEnd',
        'onloadStart',
        'onloadEnd',
        'layoutStart',
        'layoutEnd',
      ]) {
        expect(
          events.filter((e) => e === name),
          name
        ).toHaveLength(1)
      }
      const before = (a: string, b: string) =>
        expect(events.indexOf(a), `${a} before ${b}`).toBeLessThan(events.indexOf(b))
      before('evalStart', 'evalEnd')
      before('evalEnd', 'onloadStart')
      before('onloadStart', 'onloadEnd')
      before('layoutStart', 'layoutEnd')
      before('links', 'onloadEnd')
      before('time tracking index', 'layoutEnd')
      before(ready ? 'layoutEnd' : 'onloadEnd', ready ? 'onloadEnd' : 'layoutStart')
    }
  })
})
