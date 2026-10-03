import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop', 'phone')
const shots = shotDir('abele-security-dialogs')
const available = isObsidianRunning() && hasTestApi()

interface DialogReport {
  shell: boolean
  bodyActions: number
  actions: string[]
  outside: string[]
  scrolled: boolean
  footerMoved: number
  shot: string
}

describe.skipIf(!available)('security dialogs on a real screen', () => {
  it.each([
    [
      'key-destinations',
      ['Allow on this device', 'Allow unencrypted HTTP', 'Allow key and address'],
    ],
    ['key-destinations-new', ['Allow key and address']],
    ['saved-key-request', ['Cancel', 'Allow address and send']],
  ])(
    '%s keeps its actions visible while the body scrolls',
    async (name, actions) => {
      const raw = await evalLong(
        `(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      const until = async fn => {
        const deadline = Date.now() + 5000
        while (Date.now() < deadline) { if (fn()) return; await wait(50) }
        throw Error('security dialog did not open')
      }
      window.__abeleTest.openDialog(${JSON.stringify(name)})
      await until(() => document.querySelector('.modal'))
      const modal = document.querySelector('.modal')
      try {
        await wait(400)
        const body = modal.querySelector('.abele-modal__body')
        const footer = modal.querySelector('.abele-modal__footer')
        if (!body || !footer) throw Error('security dialog is missing the shared body or footer')
        const shot = ${JSON.stringify(shots + '/' + name + '.png')}
        let saved
        if (window.__e2eHost) saved = await window.__e2eHost.shot(shot)
        else {
          const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage()
          require('fs').writeFileSync(shot, image.toPNG()); saved = shot
        }
        // A long body must not push the actions away or scroll them with the explanation.
        for (let i = 0; i < 30; i++) body.createEl('p', { text: 'Sample explanation of a saved-key destination.' })
        await wait(100)
        const before = footer.getBoundingClientRect().top
        body.scrollTop = body.scrollHeight
        await wait(100)
        const outside = [...footer.querySelectorAll('button')].filter(button => {
          const r = button.getBoundingClientRect()
          return r.width <= 0 || r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight
        }).map(button => button.textContent.trim())
        const r = modal.getBoundingClientRect()
        if (r.top < 0 || r.bottom > innerHeight) outside.push('dialog')
        return {
          shell: modal.matches('.modal.abele-modal'),
          bodyActions: body.querySelectorAll('button').length,
          actions: [...footer.querySelectorAll('button')].map(button => button.textContent.trim()),
          outside, scrolled: body.scrollTop > 0,
          footerMoved: Math.abs(footer.getBoundingClientRect().top - before), shot: saved,
        }
      } finally {
        document.body.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true,
        }))
        await until(() => !document.querySelector('.modal'))
        await wait(100)
      }
    })()`,
        60_000
      )
      if (raw.startsWith('Error:')) throw new Error(raw)
      const result = JSON.parse(raw) as DialogReport
      expect(result.shell).toBe(true)
      expect(result.bodyActions).toBe(0)
      expect(result.actions).toEqual(actions)
      expect(result.outside).toEqual([])
      expect(result.scrolled).toBe(true)
      expect(result.footerMoved).toBeLessThanOrEqual(1)
      expect(result.shot).not.toMatch(/^no picture:/)
      console.info(result.shot)
    },
    90_000
  )
})
