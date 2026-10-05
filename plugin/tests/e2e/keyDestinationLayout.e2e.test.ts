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
  const restore = recipientFixture(), report = { error: '', shots: [], cleanupErrors: [] }
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
    let openingError
    completion = window.__abeleTest.openDialog('key-destinations')
    completion?.catch(error => { openingError = error })
    await wait(300)
    if (openingError) throw openingError
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
    openingError = null
    completion = window.__abeleTest.openDialog('saved-key-request')
    completion?.catch(error => { openingError = error })
    await wait(300)
    if (openingError) throw openingError
    const request = document.querySelector('.modal[data-abele-fixture="saved-key-request"]')
    if (!request) throw Error('saved-key request dialog missing')
    report.savedPinnedActions = [...request.querySelectorAll('.abele-modal__footer button')].map(button => button.textContent.trim())
    report.savedBodyActions = [...request.querySelectorAll('.abele-modal__body button')].map(button => button.textContent.trim())
    await shot('saved-request')
  } catch (error) { report.error = String(error.message ?? error) }
  finally { await cleanupRecipientConsumer(report, close, restore) }
  return report
})()`

describe('native recipient action layout', () => {
  it.each(['occupied-slot', 'opening-refusal'])(
    '%s restores the browser wrapper and permits the next ordinary review',
    async (fault) => {
      expect(isObsidianRunning() && hasTestApi()).toBe(true)
      const raw = await evalLong(
        `(async () => {
      ${recipientLayoutProbe}
      const api = window.__abeleTest, original = api.openDialog, store = api.secrets(), get = store.get
      const config = api.AbeleConfig.getInstance(), ai = config.ai
      const state = () => JSON.stringify({ ai: config.ai, firefly: config.fireflyBaseUrl, calendars: config.calendars, local: ['abele-key-destinations-v1', 'abele-key-http-origins-v1'].map(key => app.loadLocalStorage(key)) })
      const before = state()
      let result, completion
      try {
        if (${JSON.stringify(fault)} === 'occupied-slot') store.get = function(id) { return id === 'sample-request-key' ? 'fake-occupied-boundary-value' : get.call(this, id) }
        else api.openDialog = (name, options) => options?.recipientRows ? Promise.reject(Error('Sample opening refusal')) : original(name, options)
        const installed = api.openDialog
        result = await ${recipientLayoutScript('fault')}
        result.wrapperRestored = api.openDialog === installed
      } finally { api.openDialog = original; store.get = get }
      result.stateRestored = state() === before && config.ai === ai
      const ordinary = { error: '', cleanupErrors: [] }
      let ordinaryModal, openingError
      const priorModal = document.querySelector('.modal[data-abele-fixture="key-destinations"]')
      try {
        completion = api.openDialog('key-destinations')
        completion?.catch(error => { openingError = error })
        const deadline = Date.now() + 5000
        while (!openingError && (!document.querySelector('.modal[data-abele-fixture="key-destinations"]') || document.querySelector('.modal[data-abele-fixture="key-destinations"]') === priorModal)) { if (Date.now() > deadline) throw Error('ordinary review missing'); await new Promise(resolve => setTimeout(resolve, 50)) }
        if (openingError) throw openingError
        const modal = ordinaryModal = document.querySelector('.modal[data-abele-fixture="key-destinations"]')
        result.ordinaryActions = [...modal.querySelectorAll('.abele-modal__body button')].map(button => button.textContent.trim())
        const path = ${JSON.stringify(shots)} + '/fault-' + ${JSON.stringify(fault)} + '.png'
        if (window.__e2eHost) result.faultShot = await window.__e2eHost.shot(path)
        else { const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage(); require('fs').writeFileSync(path, image.toPNG()); result.faultShot = path }
      } catch (error) { ordinary.error = recipientError(error) }
      finally {
        await cleanupRecipientConsumer(ordinary, async () => {
          ordinaryModal?.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape',code:'Escape',keyCode:27,bubbles:true }))
        }, null, completion)
      }
      result.ordinaryError = ordinary.error
      result.ordinaryCleanupErrors = ordinary.cleanupErrors
      result.finalStateRestored = state() === before && config.ai === ai
      return result
    })()`,
        30_000
      )
      if (raw.startsWith('Error:')) throw Error(raw)
      const result = JSON.parse(raw)
      console.info('cleanup refusal guard', JSON.stringify(result))
      expect(result.error).toMatch(
        fault === 'occupied-slot' ? /occupied/ : /Sample opening refusal/
      )
      expect(result.cleanupErrors.length).toBeGreaterThan(0)
      expect(result.wrapperRestored).toBe(true)
      expect(result.stateRestored).toBe(true)
      expect(result.ordinaryActions).toEqual(['Allow on this device', 'Allow unencrypted HTTP'])
      expect(result.finalStateRestored).toBe(true)
      expect(result.ordinaryError).toBe('')
      expect(result.ordinaryCleanupErrors).toEqual([])
      expect(result.faultShot).not.toMatch(/^no picture:/)
    },
    90_000
  )

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
          cleanupErrors: { stage: string; message: string }[]
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
        expect(report.cleanupErrors).toEqual([])
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
