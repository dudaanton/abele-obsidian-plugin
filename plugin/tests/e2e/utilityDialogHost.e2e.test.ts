import { afterAll, describe, expect, it } from 'vitest'
import { evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { WAIT_PRELUDE } from './helpers/wait'
import { shotDir } from './helpers/shots'

const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('utility-dialogs')
const commands = [
  ['find-and-replace', '.abele-sar-fm-modal'],
  ['save-media', '.abele-save-media'],
  ['import-files', '.abele-import-files'],
  ['unused-media', '.abele-unused-media'],
  ['deduplicate-media', '.abele-dedup'],
  ['migrate-from-dataview', '.abele-migrate-dv-modal'],
  ['migrate-from-firefly', '.abele-migrate-firefly-modal'],
  ['migrate-dataview-fields', '.abele-migrate-dvf-modal'],
  ['migrate-from-toggl', '.abele-migrate-toggl-modal'],
] as const

describe.skipIf(!available)('on-demand utility dialogs', () => {
  afterAll(async () => {
    await reloadApp('app.emulateMobile(false)')
  })
  for (const phone of [false, true]) {
    it(`opens and dismisses the command dialogs through the host on ${phone ? 'phone' : 'desktop'}`, async () => {
      if (phone) {
        await reloadApp('app.emulateMobile(true)')
        evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390, 844)`)
      }
      for (const [command, selector] of commands) {
        const report = evalAsync<{
          shells: number
          hosts: number
          removed: boolean
          title: string
        }>(`(async () => {
          ${WAIT_PRELUDE}
          const command = ${JSON.stringify('abele:' + command)}
          if (!app.commands.executeCommandById(command)) throw Error('Command unavailable: ' + command)
          const root = await until(() => document.querySelector(${JSON.stringify(selector)}))
          if (!root) throw Error('Command dialog did not mount')
          app.commands.executeCommandById(command)
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          const modal = root.closest('.abele-modal')
          if (!modal) throw Error('No shared shell')
          if (!await until(() => modal.closest('.modal-container').getAnimations({ subtree: true }).every((animation) => animation.playState !== 'running'))) throw Error('Dialog did not settle')
          const shells = document.querySelectorAll(${JSON.stringify(selector)}).length
          const hosts = document.querySelectorAll('[data-abele-dialog-host]').length
          const title = modal.querySelector('.modal-title').textContent
          const image = await require('@electron/remote').getCurrentWebContents().capturePage()
          require('fs').writeFileSync(${JSON.stringify(`${SHOTS}/${phone ? 'phone' : 'desktop'}-${command}.png`)}, image.resize({ width: innerWidth, height: innerHeight }).toPNG())
          modal.querySelector('.modal-close-button, .modal-header-button.mod-raised').click()
          if (!await until(() => !root.isConnected && !document.querySelector('[data-abele-dialog-host]'))) throw Error('Dialog host was not released')
          return { shells, hosts, title, removed: !root.isConnected }
        })()`)
        expect(report.shells, command).toBe(1)
        expect(report.hosts, command).toBe(1)
        expect(report.title, command).not.toBe('')
        expect(report.removed, command).toBe(true)
      }
    })

    it(`keeps two script forms separate on ${phone ? 'phone' : 'desktop'}`, () => {
      const report = evalAsync<unknown[]>(`(async () => {
        ${WAIT_PRELUDE}
        const answers = []
        const first = window.__abeleTest.showFormModal([{ name: 'value', label: 'First', type: 'text', default: 'one' }]).then((answer) => answers.push(answer))
        const second = window.__abeleTest.showFormModal([{ name: 'value', label: 'Second', type: 'text', default: 'two' }]).then((answer) => answers.push(answer))
        const field = () => document.querySelector('.abele-script-form__input')
        if (!await until(() => field()?.value === 'one')) throw Error('First form missing')
        field().value = 'first answer'; field().dispatchEvent(new Event('input', { bubbles: true }))
        document.querySelector('.abele-script-form').requestSubmit()
        await first
        if (!await until(() => field()?.value === 'two')) throw Error('Second form reused first values')
        document.querySelector('.abele-script-form').requestSubmit()
        await second
        if (!await until(() => !document.querySelector('[data-abele-dialog-host]'))) throw Error('Form host remained mounted')
        return answers
      })()`)
      expect(report).toEqual([{ value: 'first answer' }, { value: 'two' }])
    })
  }
})
