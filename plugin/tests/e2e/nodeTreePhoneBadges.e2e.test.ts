import { expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { NODE_PANEL_FIXTURE } from './helpers/nodePanelFixture'

targets('desktop')
const shots = shotDir('node-tree-badges')

const probe = (device: string) =>
  evalAsync<{
    width: number
    height: number
    rows: { singleLine: boolean; badgeRight: boolean; ellipsis: boolean }[]
  }>(`(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    ${NODE_PANEL_FIXTURE}
    try {
      nodePanel.variant.many = 24
      const panel = await nodePanel.open('feature')
      await nodePanel.mode('Files')
      for (const path of ['src', 'src/components']) {
        const row = panel.querySelector('[data-path="' + path + '"]')
        if (!row) throw Error('Folder row missing: ' + path)
        row.click()
        await wait(500)
      }
      const rows = ['src', 'src/components', 'src/components/sample-new-file-with-a-rather-long-name.vue'].map(path => {
        const row = panel.querySelector('[data-path="' + path + '"]')
        if (!row) throw Error('Tree row missing: ' + path)
        const name = row.querySelector('.abele-tree-item__text')
        const badge = row.querySelector('.tree-item-flair-outer')
        if (path.endsWith('.vue') && !badge) throw Error('Change badge missing')
        const box = name.getBoundingClientRect(), end = badge?.getBoundingClientRect()
        const style = getComputedStyle(name)
        return {
          singleLine: box.height <= parseFloat(style.lineHeight) + 1,
          badgeRight: !end || (end.left >= box.right - 1 && Math.abs(end.top - box.top) < 4 && end.right <= row.getBoundingClientRect().right + 1),
          ellipsis: style.whiteSpace === 'nowrap' && style.textOverflow === 'ellipsis' && style.overflow === 'hidden',
        }
      })
      require('fs').writeFileSync(${JSON.stringify(shots)} + '/' + ${JSON.stringify(device)} + '.png', (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())
      await nodePanel.mode('Changes')
      await wait(500)
      require('fs').writeFileSync(${JSON.stringify(shots)} + '/' + ${JSON.stringify(device)} + '-changes.png', (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())
      return { width: innerWidth, height: innerHeight, rows }
    } finally {
      await nodePanel.close()
    }
  })()`)

it('keeps file and folder names on one line with badges at the right on desktop', async () => {
  const layout = await probe('desktop')
  expect(layout.rows).toEqual(Array(3).fill({ singleLine: true, badgeRight: true, ellipsis: true }))
})

it('keeps long names and badges on the same row at 390 by 844', async () => {
  const layout = await withEmulatedPhone(async () => probe('phone'))
  expect([layout.width, layout.height]).toEqual([390, 844])
  expect(layout.rows).toEqual(Array(3).fill({ singleLine: true, badgeRight: true, ellipsis: true }))
})
