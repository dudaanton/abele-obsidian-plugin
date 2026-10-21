import { expect, it } from 'vitest'
import { activeVaultName, vaultCli } from './helpers/obsidianCli'
import { reloadAs, setWindowSize, windowSize } from './helpers/phoneWindow'
import { probePrelude, type Screen } from './helpers/layoutProbe'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')

it('keeps multi-item share screens within desktop and phone geometry', async () => {
  const vault = vaultCli(activeVaultName())
  const size = windowSize(vault)
  const shots = shotDir('abele-sync-share-sets')
  const close = () =>
    vault.evalAwait(`(async () => {
    for (const button of [...document.querySelectorAll('.modal-close-button')].reverse()) button.click()
    return true
  })()`)
  try {
    for (const [width, height] of [
      [1200, 900],
      [390, 844],
    ]) {
      await setWindowSize(vault, width, height)
      await reloadAs(vault, width < 500)
      for (const name of [
        'empty',
        'long',
        'readonly',
        'removed',
        'delete',
        'states',
        'missing-kept',
        'forget-kept',
      ]) {
        try {
          const result = vault.evalAwait<Screen>(`(async () => {
            ${probePrelude(shots)}
            window.__abeleTest.openDialog(${JSON.stringify(name.endsWith('kept') ? 'sync-states' : 'sync-set-' + name)})
            if (!await until(() => document.querySelector('.modal.abele-modal'), 5000)) throw new Error('Share fixture did not open')
            ${name.endsWith('kept') ? `document.querySelector('.abele-sync-row').click(); if(!await until(()=>document.querySelector('.abele-sync-window'),5000))throw new Error('Connection window did not open'); await wait(300);` : ''}
            ${name === 'forget-kept' ? `[...document.querySelectorAll('button')].find(one=>one.textContent.trim()==='Forget this kept copy').click();if(!await until(()=>document.querySelector('.abele-confirm__message'),5000))throw new Error('Confirmation did not open');` : ''}
            const root = [...document.querySelectorAll('.modal.abele-modal')].at(-1)
            await wait(250)
            return screen(${JSON.stringify(name + '-' + width)}, root, root.querySelector('.abele-modal__body'))
          })()`)
          expect(result.error).toBe('')
          expect(result.over).toEqual([])
          expect(result.clipped).toEqual([])
          expect(result.capped).toEqual([])
        } finally {
          close()
        }
      }
    }
  } finally {
    close()
    await setWindowSize(vault, ...size)
    await reloadAs(vault, false)
  }
}, 180000)
