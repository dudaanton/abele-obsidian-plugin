/**
 * The dialog a script or template from elsewhere is confirmed in, as `reviewScript()` opens it:
 * why it waits, the path, the code read-only, its buttons, and that only Confirm says yes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { closeComponentDialogs } from '@/modal/componentDialog'
import { ShellModal } from '@/modal/ShellModal'
import { reviewScript, type ReviewRequest } from '@/scripting/reviewScript'
import type { ParsedScript } from '@/scripting/types'
import { useVault } from '../helpers/testEnv'

const script: ParsedScript = {
  path: 'Scripts/sample.js',
  hash: 'sample-hash',
  source: '// @name Sample\nreturn 1',
  code: 'return 1',
  commandId: '',
  meta: { name: 'Sample', description: '', params: [] },
}
const template = { path: 'Templates/sample.md', name: 'Sample template', source: 'Sample body' }

let app: ReturnType<typeof useVault>
beforeEach(() => (app = useVault([])))
afterEach(() => {
  closeComponentDialogs()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const dialog = () => document.querySelector<HTMLElement>('.modal.abele-script-review')
const buttons = () => [
  ...dialog()!.querySelectorAll<HTMLButtonElement>('.abele-modal__footer button'),
]
const press = (text: string) =>
  buttons()
    .find((b) => b.textContent === text)!
    .click()
const ask = (request: ReviewRequest, signal?: AbortSignal) =>
  reviewScript(app as never, request, signal)

describe('reviewScript', () => {
  it('shows a new script: title, why, path, the code and Not now before Confirm', async () => {
    const answer = ask({ script })
    expect(dialog()).not.toBeNull()
    expect(dialog()!.classList.contains('mod-lg')).toBe(true)
    expect(dialog()!.querySelector('.abele-script-review__why')!.textContent).toBe(
      'This script appeared without being written on this device — through sync or another app. Buttons, automations, startup and agents will not run it until you confirm it here.'
    )
    const path = dialog()!.querySelector('.abele-script-review__path')!
    expect(path.textContent).toBe('Scripts/sample.js')
    expect(path.classList.contains('setting-item-description')).toBe(true)
    const code = dialog()!.querySelector('.abele-script-review__code')!
    expect(code.querySelector('.cm-editor')).not.toBeNull()
    expect(code.querySelector('.cm-content')!.textContent).toContain('return 1')
    expect(code.querySelector('.cm-content')!.getAttribute('contenteditable')).toBe('false')
    expect(buttons().map((b) => b.textContent)).toEqual(['Not now', 'Confirm'])
    expect(buttons()[1].classList.contains('mod-cta')).toBe(true)
    press('Not now')
    await expect(answer).resolves.toBe(false)
    expect(dialog()).toBeNull()
  })

  it('titles the dialog with what it confirms', async () => {
    const shown = vi.spyOn(ShellModal.prototype, 'setTitle')
    const answer = ask({ template })
    expect(shown).toHaveBeenCalledWith('Confirm template "Sample template"')
    press('Not now')
    await answer
    ask({ script })
    expect(shown).toHaveBeenLastCalledWith('Confirm script "Sample"')
  })

  it('resolves true only on Confirm, and tears the editor down', async () => {
    const destroyed = vi.spyOn(EditorView.prototype, 'destroy')
    const answer = ask({ script })
    press('Confirm')
    await expect(answer).resolves.toBe(true)
    expect(dialog()).toBeNull()
    expect(destroyed).toHaveBeenCalledOnce()
  })

  it('answers no when the dialog is closed any other way', async () => {
    const shown = vi.spyOn(ShellModal.prototype, 'open')
    const answer = ask({ script })
    ;(shown.mock.contexts[0] as ShellModal).close()
    await expect(answer).resolves.toBe(false)
    expect(dialog()).toBeNull()
  })

  it('marks what changed against the version confirmed before', async () => {
    const answer = ask({ script, previous: '// @name Sample\nreturn 0' })
    expect(dialog()!.querySelector('.abele-script-review__why')!.textContent).toMatch(
      /^This script changed without being written on this device/
    )
    expect(dialog()!.querySelector('.abele-script-review__path')!.textContent).toBe(
      'Scripts/sample.js — changes against the version last confirmed here'
    )
    expect(dialog()!.querySelector('.cm-deletedChunk, .cm-changedLine')).not.toBeNull()
    press('Not now')
    await answer
  })

  it('explains a template and leaves its commands waiting on Not now', async () => {
    const answer = ask({ template })
    expect(dialog()!.querySelector('.abele-script-review__why')!.textContent).toMatch(
      /^This template can run commands or call plugin methods\./
    )
    expect(dialog()!.querySelector('.abele-script-review__path')!.textContent).toBe(
      'Templates/sample.md'
    )
    expect(dialog()!.querySelector('.cm-content')!.textContent).toBe('Sample body')
    press('Not now')
    await expect(answer).resolves.toBe(false)
  })

  it('offers only Close for a refused script', async () => {
    const answer = ask({ script, refused: true })
    expect(dialog()!.querySelector('.abele-script-review__why')!.textContent).toMatch(
      /^This version arrived through a connection that is not allowed/
    )
    expect(buttons().map((b) => b.textContent)).toEqual(['Close'])
    expect(buttons()[0].classList.contains('mod-cta')).toBe(true)
    press('Close')
    await expect(answer).resolves.toBe(false)
  })

  it('closes unconfirmed when its signal aborts, and throws on one already aborted', async () => {
    const abort = new AbortController()
    const answer = ask({ script }, abort.signal)
    abort.abort()
    await expect(answer).resolves.toBe(false)
    expect(dialog()).toBeNull()
    expect(() => ask({ script }, abort.signal)).toThrow()
    expect(dialog()).toBeNull()
  })
})
