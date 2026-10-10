import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { WAIT_PRELUDE } from './helpers/wait'
import { shotDir } from './helpers/shots'

const DIR = 'ReplacementPagingE2E'
const BASE = `${DIR}/Sample.base`
const SHOTS = shotDir('replacement-paging')
const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('replacement preview paging in Bases', () => {
  beforeAll(() => {
    evalAsync(`(async () => {
      await app.vault.createFolder(${JSON.stringify(DIR)})
      await app.vault.createFolder(${JSON.stringify(DIR + '/Notes')})
      for (let i = 0; i < 63; i++) await app.vault.create(${JSON.stringify(DIR + '/Notes/sample-')} + String(i).padStart(2, '0') + '.md', '---\\nlabel: old\\n---\\nSample body\\n')
      await app.vault.create(${JSON.stringify(BASE)}, ${JSON.stringify(`filters:\n  and:\n    - file.inFolder("${DIR}/Notes")\nviews:\n  - type: abele-find-and-replace\n    name: Replace\n`)})
      return true
    })()`)
  })
  afterAll(async () => {
    await reloadApp('app.emulateMobile(false)')
    evalAsync(`(async () => {
      for (const leaf of app.workspace.getLeavesOfType('bases')) if (leaf.view.file?.path === ${JSON.stringify(BASE)}) leaf.detach()
      const folder = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (folder) await app.vault.delete(folder, true)
      return true
    })()`)
  })

  for (const phone of [false, true]) {
    it(`shows all 63 previews in batches on ${phone ? 'phone' : 'desktop'}`, async () => {
      if (phone) {
        await reloadApp('app.emulateMobile(true)')
        evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390, 844)`)
      }
      const report = evalAsync<{
        count: string
        rows: number
        last: string
        shot: boolean
      }>(`(async () => {
        ${WAIT_PRELUDE}
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(BASE)})
        const leaf = app.workspace.getLeaf(false)
        await leaf.openFile(file)
        app.workspace.setActiveLeaf(leaf, { focus: true })
        const root = await until(() => leaf.view.containerEl.querySelector('.abele-far-bases'))
        if (!root) throw Error('No replacement view')
        await until(() => root.querySelector('.abele-far-bases__count')?.textContent.includes('63'))
        for (const [placeholder, value] of [['Property name', 'label'], ['Value', 'new']]) {
          const input = root.querySelector('input[placeholder="' + placeholder + '"]')
          input.value = value
          input.dispatchEvent(new Event('input', { bubbles: true }))
        }
        await new Promise((resolve) => requestAnimationFrame(resolve))
        ;[...root.querySelectorAll('button')].find((button) => button.textContent === 'Preview').click()
        await until(() => root.querySelector('.abele-far-bases__count')?.textContent.includes('63') && root.querySelector('.abele-far-bases__result')?.textContent.includes('label: new'))
        const rowCount = () => root.querySelectorAll('.abele-far-bases__result').length
        while (rowCount() < 63) {
          const before = rowCount()
          const more = [...root.querySelectorAll('button')].find((button) => button.textContent === 'Load more')
          if (!more) throw Error('Remaining previews are unreachable')
          more.click()
          if (!await until(() => rowCount() > before)) throw Error('Paging did not advance')
        }
        root.querySelectorAll('.abele-far-bases__result')[50].scrollIntoView({ block: 'start' })
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const image = await require('@electron/remote').getCurrentWebContents().capturePage()
        require('fs').writeFileSync(${JSON.stringify(SHOTS + (phone ? '/phone.png' : '/desktop.png'))}, image.resize({ width: ${phone ? 390 : 1280} }).toPNG())
        return { count: root.querySelector('.abele-far-bases__count').textContent.trim(), rows: rowCount(), last: root.querySelectorAll('.abele-far-bases__result a')[62].textContent, shot: !image.isEmpty() }
      })()`)
      expect(report.count).toBe('63 results')
      expect(report.rows).toBe(63)
      expect(report.last).toContain('sample-62.md')
      expect(report.shot).toBe(true)
    })
  }
})
