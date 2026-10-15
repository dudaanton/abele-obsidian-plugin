/**
 * The small question dialogs — a name, a confirmation, a choice, a list to approve — in the
 * running app, on the desktop and at a phone's size: each opens in the shell with its title,
 * its text and its buttons in their order, and closes without leaving anything behind. A
 * picture of each goes to `kit-dialogs/`, to compare before and after a change to how they are
 * built.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { WAIT_PRELUDE } from './helpers/wait'
import { shotDir } from './helpers/shots'

const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('kit-dialogs')

interface Seen {
  title: string
  buttons: string[]
  inputs: string[]
  text: string
  hosts: number
}

const EXPECTED: Record<
  string,
  { title: string; buttons: string[]; inputs: string[]; text: string[] }
> = {
  'ask-name': {
    title: 'New script',
    buttons: ['Cancel', 'Create'],
    inputs: ['filename'],
    text: [],
  },
  'confirm-action': {
    title: 'Remove footnote [^1]?',
    buttons: ['Cancel', 'Remove'],
    inputs: [],
    text: ['The footnote and every reference to it are removed from this note.'],
  },
  'discussion-remove': {
    title: 'Remove this discussion from the book?',
    buttons: ['Keep the chat', 'Delete the chat too', 'Cancel'],
    inputs: [],
    text: ['The words stop being marked.'],
  },
  'book-repair-one': {
    title: 'Repair highlight link?',
    buttons: ['Cancel', 'Repair link'],
    inputs: [],
    text: [
      'These quoted words were found away from their saved links.',
      'Sample chapter 1',
      'Fabricated sample passage 1',
      'Saved location unavailable; this is a found occurrence.',
    ],
  },
}

describe.skipIf(!available)('kit question dialogs', () => {
  afterAll(async () => {
    await reloadApp('app.emulateMobile(false)')
  })
  for (const phone of [false, true]) {
    it(`open with their text and buttons, and close cleanly, on ${phone ? 'phone' : 'desktop'}`, async () => {
      if (phone) {
        await reloadApp('app.emulateMobile(true)')
        evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390, 844)`)
      }
      for (const [name, expected] of Object.entries(EXPECTED)) {
        const seen = evalAsync<Seen>(`(async () => {
          ${WAIT_PRELUDE}
          const doc = typeof activeDocument === 'undefined' ? document : activeDocument
          window.__abeleTest.openDialog(${JSON.stringify(name)})
          const modal = await until(() => doc.querySelector('.modal.abele-modal'))
          if (!modal) throw Error('Dialog did not open: ' + ${JSON.stringify(name)})
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          if (!await until(() => modal.closest('.modal-container').getAnimations({ subtree: true }).every((a) => a.playState !== 'running'))) throw Error('Dialog did not settle')
          const label = (el) => el.textContent.trim()
          const seen = {
            title: label(modal.querySelector('.modal-title')),
            buttons: [...modal.querySelectorAll('.abele-modal__body button, .abele-modal__footer button')].filter((b) => b.getBoundingClientRect().width > 0).map(label),
            inputs: [...modal.querySelectorAll('input')].map((i) => i.placeholder),
            text: modal.querySelector('.abele-modal__body').textContent,
          }
          const owner = doc.defaultView
          const image = await owner.require('@electron/remote').getCurrentWebContents().capturePage()
          require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/' + ${JSON.stringify(phone ? 'phone' : 'desktop')} + '-' + ${JSON.stringify(name)} + '.png', image.resize({ width: owner.innerWidth, height: owner.innerHeight }).toPNG())
          const close = modal.querySelector('.modal-close-button, .modal-header-button.mod-raised')
          if (close) close.click()
          else doc.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
          if (!await until(() => !modal.isConnected && !doc.querySelector('.modal.abele-modal') && !doc.querySelector('[data-abele-dialog-host]'))) throw Error('Dialog did not close cleanly')
          return { ...seen, hosts: doc.querySelectorAll('[data-abele-dialog-host]').length }
        })()`)
        expect(seen.title, name).toBe(expected.title)
        expect(seen.buttons, name).toEqual(expected.buttons)
        expect(seen.inputs, name).toEqual(expected.inputs)
        for (const text of expected.text) expect(seen.text, name).toContain(text)
        expect(seen.hosts, name).toBe(0)
      }
    })
  }
})
