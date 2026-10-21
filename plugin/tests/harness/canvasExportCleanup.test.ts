import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { expect, it, vi } from 'vitest'
import { closeFixtureLeaves } from '../e2e/helpers/fixtureBoundary'

it('closes a failed case image modal and every extra file leaf before the next case', async () => {
  let cleanup: (() => void) | undefined
  const events: string[] = []
  const canvas = { view: { file: { path: 'sample.canvas' } } }
  const extra = {
    view: {
      file: { path: 'auto-opened.png' },
      save: async () => {
        events.push('save')
      },
    },
    setViewState: async () => {
      events.push('empty')
    },
    detach: () => {
      events.push('detach')
    },
  }
  const modal = document.createElement('div')
  modal.className = 'modal-container'
  const button = document.createElement('button')
  button.className = 'modal-close-button'
  button.onclick = () => {
    events.push('close modal')
    modal.remove()
  }
  modal.append(button)
  document.body.append(modal)
  const app = {
    workspace: {
      iterateAllLeaves: (visit: (leaf: unknown) => void) => [canvas, extra].forEach(visit),
      revealLeaf: vi.fn(),
    },
  }
  const state = { leaves: [canvas], modals: [], canvas }
  const imports: Record<string, unknown> = {
    'node:crypto': { randomUUID: () => 'sample-run' },
    vitest: {
      describe: { skipIf: () => (_: string, body: () => void) => body() },
      beforeAll: () => {},
      afterAll: () => {},
      it: () => {},
      afterEach: (hook: () => void) => {
        cleanup = hook
      },
    },
    './helpers/githubLive': {
      evalAsync: (script: string) =>
        new Function('app', 'window', 'document', `return ${script}`)(
          app,
          {
            __canvasExport: state,
            __abeleTest: {
              createAgentTools: () => [],
              ScopeResolver: class {
                setFullVaultAccess() {}
              },
            },
          },
          document
        ),
    },
    './helpers/obsidianCli': { hasTestApi: () => true, isObsidianRunning: () => true },
    './helpers/target': { targets: () => {} },
    './helpers/phone': {},
    './helpers/nativeInput': {},
    './helpers/shots': { shotDir: () => 'sample-shots' },
    './helpers/ownNotices': { dismissOwnNotices: () => {} },
    './helpers/fixtureBoundary': { closeFixtureLeaves },
  }
  const code = transformSync(readFileSync(__dirname + '/../e2e/canvasExport.e2e.test.ts', 'utf8'), {
    loader: 'ts',
    format: 'cjs',
  }).code
  new Function('require', code)((name: string) => imports[name])
  expect(cleanup).toBeTypeOf('function')
  await cleanup!()
  expect(events).toEqual(['close modal', 'save', 'empty', 'detach'])
  expect(app.workspace.revealLeaf).toHaveBeenCalledWith(canvas)
  expect(document.querySelector('.modal-container')).toBeNull()
})
