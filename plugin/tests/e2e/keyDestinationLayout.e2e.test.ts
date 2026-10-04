import { describe, expect, it } from 'vitest'
import {
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  restoreDesktopWindow,
} from './helpers/obsidianCli'
import { targets, onPhone } from './helpers/target'
import { shotDir } from './helpers/shots'
import { recipientLayoutProbe } from '../helpers/keyDestinationLayoutProbe'
import { securityDialogScript, type DialogReport } from '../helpers/securityDialogProbe'
import {
  RECIPIENT_ROWS,
  recipientRowFailures,
  type RecipientLayoutReport,
  type RecipientAction,
} from '../helpers/keyDestinationLayout'

targets('desktop', 'phone')
const shots = shotDir('abele-recipient-layout')

export const recipientLayoutScript = (screen: string) => `(async () => {
  ${recipientLayoutProbe}
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const restore = recipientFixture(), report = { error: '', shots: [] }
  let completion
  const close = async () => {
    if (!completion) return
    const modal = document.querySelector('.modal[data-abele-fixture]')
    modal?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
    const settled = completion; completion = null
    await settled
    if (document.querySelector('.modal[data-abele-fixture]')) throw Error('Owned recipient fixture did not close')
  }
  const shot = async label => {
    const path = ${JSON.stringify(shots)} + '/' + ${JSON.stringify(screen)} + '-' + label + '.png'
    if (window.__e2eHost) report.shots.push(await window.__e2eHost.shot(path))
    else if (typeof require === 'function') {
      const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage()
      require('fs').writeFileSync(path, image.toPNG()); report.shots.push(path)
    }
  }
  try {
    completion = window.__abeleTest.openDialog('key-destinations'); await wait(300)
    const modal = document.querySelector('.modal[data-abele-fixture="key-destinations"]')
    if (!modal) throw Error('recipient dialog missing')
    Object.assign(report, await recipientActions(modal))
    const rect = modal.getBoundingClientRect()
    report.edges = [rect.top, rect.bottom]
    const body = modal.querySelector('.abele-modal__body')
    report.scrollers = [body, ...body.querySelectorAll('*')].filter(el => {
      const style = getComputedStyle(el)
      return ['auto', 'scroll'].includes(style.overflowY) && el.scrollHeight > el.clientHeight + 1 && el.getBoundingClientRect().height > 0
    }).length
    await shot('primary')
    const rows = [...body.querySelectorAll('.setting-item')].filter(row => row.querySelector('button'))
    for (let i = 0; i < rows.length; i++) {
      rows[i].scrollIntoView({ block: 'center', behavior: 'instant' }); await wait(50)
      await shot('row-' + i)
    }
    await close()
    completion = window.__abeleTest.openDialog('saved-key-request'); await wait(300)
    const request = document.querySelector('.modal[data-abele-fixture="saved-key-request"]')
    if (!request) throw Error('saved-key request dialog missing')
    report.savedPinnedActions = [...request.querySelectorAll('.abele-modal__footer button')].map(button => button.textContent.trim())
    report.savedBodyActions = [...request.querySelectorAll('.abele-modal__body button')].map(button => button.textContent.trim())
    await shot('saved-request')
  } catch (error) { report.error = String(error.message ?? error) }
  finally { await close(); await restore(); report.restored = true }
  return report
})()`

describe('native recipient action layout', () => {
  it.each(onPhone() ? ['phone'] : ['desktop', 'mobile'])(
    '%s preserves exact actions and visible recipient context',
    async (screen) => {
      expect(isObsidianRunning() && hasTestApi()).toBe(true)
      try {
        if (screen === 'mobile') {
          await reloadApp('app.emulateMobile(true)')
          evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(390, 844)")
        }
        const raw = await evalLong(recipientLayoutScript(screen), 30_000)
        if (raw.startsWith('Error:')) throw Error(raw)
        const report = JSON.parse(raw) as RecipientLayoutReport & {
          error: string
          pinnedActions: string[]
          primary: RecipientAction & { pinned: boolean; summary: string }
          edges: number[]
          scrollers: number
          savedPinnedActions: string[]
          savedBodyActions: string[]
          shots: string[]
        }
        console.info(JSON.stringify(report))
        expect(report.error).toBe('')
        expect((report as typeof report & { restored: boolean }).restored).toBe(true)
        expect(recipientRowFailures(report, RECIPIENT_ROWS)).toEqual([])
        expect(report.pinnedActions).toEqual(['Allow key and address'])
        expect(report.primary).toMatchObject({
          text: 'Allow key and address',
          pinned: true,
          focused: true,
          reachable: true,
          inViewport: true,
          contextVisible: true,
          clipped: [],
        })
        expect(report.primary.summary).toContain(
          'Sample primary key → https://primary.sample.example'
        )
        expect(report.edges[0]).toBeGreaterThanOrEqual(0)
        if (screen === 'mobile') expect(report.edges[1]).toBeLessThanOrEqual(844)
        expect(report.scrollers).toBeLessThanOrEqual(1)
        expect(report.savedPinnedActions).toEqual(['Cancel', 'Allow address and send'])
        expect(report.savedBodyActions).toEqual([])
        expect(report.shots).toHaveLength(7)
        expect(report.shots.some((path) => path.startsWith('no picture:'))).toBe(false)
        // Keep this order inside each case: file scheduling must not turn the cleanup
        // regression into an isolated pass before the synthetic row fixture ran.
        for (const [name, actions, rowActions] of [
          [
            'key-destinations',
            ['Allow key and address'],
            ['Allow on this device', 'Allow unencrypted HTTP'],
          ],
          ['key-destinations-new', ['Allow key and address'], []],
          ['saved-key-request', ['Cancel', 'Allow address and send'], []],
        ] as const) {
          const rawSecurity = await evalLong(
            securityDialogScript(name, shots + '/' + screen + '-after-layout-' + name + '.png'),
            30_000
          )
          if (rawSecurity.startsWith('Error:')) throw Error(rawSecurity)
          const security = JSON.parse(rawSecurity) as DialogReport
          console.info('after recipient layout', JSON.stringify(security))
          expect(security.shell).toBe(true)
          expect(security.actions).toEqual(actions)
          expect(security.bodyActions).toEqual(rowActions)
          if (name === 'key-destinations')
            expect(security.rows).toEqual([
              {
                name: 'Sample secure provider',
                description: 'https://api.sample.example',
                actions: ['Allow on this device'],
              },
              {
                name: 'Sample home provider',
                description:
                  'http://192.168.8.20:1234 — Unencrypted: anyone on the network path can read the key.',
                actions: ['Allow unencrypted HTTP'],
              },
            ])
          else expect(security.rows).toEqual([])
          expect(security.outside).toEqual([])
          expect(security.scrolled).toBe(true)
          expect(security.footerMoved).toBeLessThanOrEqual(1)
          expect(security.restored).toBe(true)
          expect(security.shot).not.toMatch(/^no picture:/)
        }
      } finally {
        if (screen === 'mobile') await restoreDesktopWindow()
      }
    },
    90_000
  )
})
