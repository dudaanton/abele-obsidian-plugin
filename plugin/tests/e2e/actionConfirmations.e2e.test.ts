import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { WAIT_PRELUDE } from './helpers/wait'
import { shotDir } from './helpers/shots'

const available = isObsidianRunning() && hasTestApi()
interface ConfirmationProbe {
  message: string
  width: number
  height: number
  fits: boolean
  closed: boolean
  unchanged: boolean
}

const probe = async (
  place: 'find-replace' | 'migrate-dataview',
  mode: string
): Promise<ConfirmationProbe> =>
  JSON.parse(
    await evalLong(`(async () => {
    ${WAIT_PRELUDE}
    if (document.querySelector('.modal-container')) throw Error('A dialog was already open')
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
    const path = 'sample-action-confirmation.md'
    const pluginId = 'sample-confirmation-dataview'
    const source = '- [ ] Sample task\\n'
    if (app.vault.getAbstractFileByPath(path) || app.plugins.plugins[pluginId]) throw Error('Confirmation fixture already exists')
    const file = await app.vault.create(path, source)
    let parent, confirm, confirmContainer
    const close = container => container?.querySelector('.modal-close-button, .modal-header-button')?.click()
    try {
      if (${JSON.stringify(place)} === 'migrate-dataview') app.plugins.plugins[pluginId] = {
        api: { query: async () => ({ value: { values: [
          { task: true, text: 'Sample task', path, position: { start: { offset: 0 }, end: { offset: 17 } } }
        ] } }) }
      }
      if (!(await until(() => app.metadataCache.getFileCache(file)))) throw Error('The fixture was not indexed')
      window.__abeleTest.openDialog(${JSON.stringify(place)})
      const root = await until(() => document.querySelector(${JSON.stringify(place === 'find-replace' ? '.abele-sar-fm-modal' : '.abele-migrate-dv-modal')}))
      if (!root) throw Error('The action dialog did not open')
      parent = root.closest('.modal-container')
      const field = root.querySelector(${JSON.stringify(place === 'find-replace' ? '.abele-criterion input' : 'input')})
      field.value = ${JSON.stringify(place)} === 'find-replace' ? path : pluginId
      field.dispatchEvent(new Event('input', { bubbles: true }))
      await frame()
      const button = label => [...root.querySelectorAll('button')].find(el => el.textContent.trim() === label)
      button(${JSON.stringify(place === 'find-replace' ? 'Search' : 'Search for tasks')}).click()
      const action = await until(() => {
        const el = button(${JSON.stringify(place === 'find-replace' ? 'Replace all' : 'Create tasks notes and remove tasks')})
        return el && !el.disabled ? el : null
      })
      if (!action) throw Error('The action was not available')
      action.click()
      confirm = await until(() => document.querySelector('.abele-confirm__message'))
      if (!confirm) throw Error('No themed confirmation')
      confirmContainer = confirm.closest('.modal-container')
      const modal = confirm.closest('.modal')
      // A phone's native sheet animates into place. A rectangle alone can be in range while
      // the compositor still shows the parent dialog, so wait for the question to be on top.
      if (!(await until(() => {
        const box = confirm.getBoundingClientRect()
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        return top && confirm.contains(top) &&
          modal.closest('.modal-container').getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')
      }))) throw Error('The confirmation did not become visible above its parent')
      await frame(); await frame()
      const box = modal.getBoundingClientRect()
      const fits = box.left >= 0 && box.top >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1 && modal.scrollWidth <= modal.clientWidth + 1
      require('fs').writeFileSync(${JSON.stringify(shotDir('action-confirmations'))} + '/' + ${JSON.stringify(`${mode}-${place}.png`)}, (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).resize({ width: innerWidth, height: innerHeight }).toPNG())
      const message = confirm.textContent
      const cancel = [...modal.querySelectorAll('button')].find(el => el.textContent.trim() === 'Cancel')
      cancel.click()
      if (!(await until(() => !confirmContainer.isConnected))) throw Error('The confirmation did not close')
      return { message, width: innerWidth, height: innerHeight, fits, closed: !confirmContainer.isConnected, unchanged: (await app.vault.read(file)) === source }
    } finally {
      if (confirmContainer?.isConnected) close(confirmContainer)
      if (parent?.isConnected) close(parent)
      delete app.plugins.plugins[pluginId]
      await app.vault.delete(file)
      if (parent && !(await until(() => !parent.isConnected))) throw Error('The action dialog did not close')
    }
  })()`)
  ) as ConfirmationProbe

describe.skipIf(!available)('action confirmations in the running app', () => {
  let size: [number, number]
  let mobile: boolean
  beforeAll(() => {
    size = evalJson<[number, number]>(
      "require('@electron/remote').getCurrentWindow().getContentSize()"
    )
    mobile = evalJson<boolean>('app.isMobile')
    expect(mobile).toBe(false)
  })
  afterAll(async () => {
    if (evalJson<boolean>('app.isMobile') !== mobile)
      await reloadApp(`app.emulateMobile(${mobile})`)
    evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`)
  }, 180_000)

  for (const mode of ['desktop', 'phone'] as const) {
    describe(mode, () => {
      beforeAll(async () => {
        if (mode === 'phone') await reloadApp('app.emulateMobile(true)')
        const [width, height] = mode === 'phone' ? [390, 844] : [1100, 850]
        evalRaw(
          `require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height})`
        )
        expect(
          evalAsync<boolean>(
            `(async () => { ${WAIT_PRELUDE} return !!(await until(() => innerWidth === ${width} && innerHeight === ${height})) })()`
          )
        ).toBe(true)
      }, 180_000)
      it.each(['find-replace', 'migrate-dataview'] as const)(
        '%s uses the shared dialog and Cancel changes nothing',
        async (place) => {
          const result = await probe(place, mode)
          expect(result.message).toBe(
            place === 'find-replace'
              ? 'Are you sure you want to apply the changes to 1 notes?'
              : 'Do you have backups of your notes? Proceeding will remove tasks from your notes.'
          )
          expect(result.fits).toBe(true)
          expect(result.closed).toBe(true)
          expect(result.unchanged).toBe(true)
          if (mode === 'phone') expect([result.width, result.height]).toEqual([390, 844])
        },
        60_000
      )
    })
  }
})
