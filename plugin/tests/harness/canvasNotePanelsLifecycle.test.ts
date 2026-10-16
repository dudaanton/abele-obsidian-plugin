import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'

const source = readFileSync(resolve(__dirname, '../e2e/canvasNotePanels.e2e.test.ts'), 'utf8')
const cleanup = source.match(/const CLEANUP = `([\s\S]*?)`\n/)![1]
const section = source.match(/const waitForNoteSection = async \(\) => \{([\s\S]*?)\n\}/)![1]
const poll = source.match(/const until = async \(condition: string\) => \{([\s\S]*?)\n\}/)![1]
const diagnostics = source.match(/const NOTE_SECTION_DIAGNOSTICS = `([\s\S]*?)`\n/)![1]

it('reports the active view, file, editor state, anchors and footer presence on timeout', async () => {
  const root = document.createElement('div')
  const anchor = document.createElement('div')
  anchor.setAttribute('data-abele-anchor', 'section:tasks')
  root.append(anchor)
  const app = {
    workspace: {
      activeLeaf: {
        view: {
          getViewType: () => 'markdown',
          file: { path: 'sample.md' },
          getState: () => ({ mode: 'preview' }),
          containerEl: root,
        },
      },
    },
  }
  const run = (body: string) => new Function('app', body)(app)
  const until = async () => {
    throw new Error('Sample timeout')
  }
  const wait = new Function(
    'run',
    'until',
    'NOTE_SECTION_DIAGNOSTICS',
    `return async () => {${section}}`
  )(run, until, diagnostics)
  const error = await wait().catch((error: Error) => error)
  expect(error).toBeInstanceOf(Error)
  expect(JSON.parse(error.message.replace('Note footer section did not appear: ', ''))).toEqual({
    type: 'markdown',
    file: 'sample.md',
    state: { mode: 'preview' },
    anchors: ['section:tasks'],
    footerRoot: false,
  })
  const footer = document.createElement('div')
  footer.className = 'abele-footer-widget-container'
  root.append(footer)
  expect(run(diagnostics).footerRoot).toBe(true)
  app.workspace.activeLeaf = null as never
  expect(run(diagnostics)).toEqual({
    type: null,
    file: null,
    state: null,
    anchors: [],
    footerRoot: false,
  })
})

it('waits for the footer after the note activates', async () => {
  const run = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValue(true)
  const until = new Function('expect', 'run', `return async condition => {${poll}}`)(expect, run)
  const wait = new Function('expect', 'run', 'until', `return async () => {${section}}`)(
    expect,
    run,
    until
  )
  await wait()
  expect(run).toHaveBeenCalledTimes(3)
})

it.each([false, true])(
  'cleans canvas and Markdown leaves and tolerates another cleanup (flush failure: %s)',
  async (fail) => {
    const failure = new Error('Sample flush failure')
    const detach = vi.fn()
    const ordinaryDetach = vi.fn()
    const unrelatedDetach = vi.fn()
    let folder: object | null = {}
    const app = {
      workspace: {
        iterateAllLeaves: (visit: (leaf: unknown) => void) => {
          visit({
            view: {
              file: { path: 'sample/sample.canvas' },
              editor: {
                flush: async () => {
                  if (fail) throw failure
                },
              },
            },
            detach,
          })
          visit({ view: { file: { path: 'sample/note.md' }, editor: {} }, detach: ordinaryDetach })
          visit({ view: { file: { path: 'other/note.md' } }, detach: unrelatedDetach })
        },
      },
      vault: {
        getAbstractFileByPath: () => folder,
        delete: vi.fn(async () => {
          folder = null
        }),
      },
    }
    const run = new Function('app', 'dir', `return (async () => {${cleanup}})()`)
    if (fail) await expect(run(app, 'sample')).rejects.toThrow()
    else await run(app, 'sample')
    expect(folder).toBeNull()
    expect(detach).toHaveBeenCalledOnce()
    expect(ordinaryDetach).toHaveBeenCalledOnce()
    expect(unrelatedDetach).not.toHaveBeenCalled()
    app.workspace.iterateAllLeaves = () => {}
    await run(app, 'sample')
    expect(app.vault.delete).toHaveBeenCalledOnce()
  }
)
