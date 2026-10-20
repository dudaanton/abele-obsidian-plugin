import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop')
const SHOTS = shotDir('abele-phone')

interface BadgeMeasure {
  count: string
  expected: string
  inside: boolean
  separate: boolean
  width: number
  onScreen: boolean
  countInside: boolean
  countSeparate: boolean
}

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('chat files control and linked-note counts', () => {
  let size: [number, number]

  beforeAll(() => {
    size = evalJson<[number, number]>(
      "require('@electron/remote').getCurrentWindow().getContentSize()"
    )
  })

  afterAll(async () => {
    if (!available) return
    evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`)
    await reloadApp('app.emulateMobile(false)')
  })

  const measure = async (): Promise<BadgeMeasure[]> =>
    JSON.parse(
      await evalLong(
        `(async () => {
    const chats = window.__abeleTest.ChatService.getInstance()
    const priorTab = chats.activeTabId.value
    if (!chats.canCreateTab) throw new Error('no free synthetic chat tab')
    const tab = chats.createTab(), session = chats.getSession(tab)
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const until = async (fn) => {
      for (let i = 0; i < 80; i++) { const value = fn(); if (value) return value; await wait(100) }
      throw new Error('Artifacts UI did not settle: ' + fn.toString() + '; menu=' + [...document.querySelectorAll('.menu-item')].map(el => el.textContent.trim()).join('|'))
    }
    let root
    const fixtureFolder = 'ScaleTest/sample-artifact-count-' + Date.now()
    try {
      await app.vault.createFolder(fixtureFolder)
      const fixturePaths = []
      for (let i = 0; i < 999; i++) {
        const path = fixtureFolder + '/sample-' + i + '.md'
        await app.vault.create(path, '')
        fixturePaths.push(path)
      }
      await chats.revealSidebar()
      // "Files from this chat" is an item of the header's overflow menu, its last control.
      const control = await until(() => [...document.querySelectorAll('.abele-ai-chat__header-actions .abele-ai-chat__overflow [aria-haspopup="menu"]')].find(el => el.getClientRects().length))
      await wait(500)
      const button = control.getBoundingClientRect()
      const icon = control.querySelector('svg').getBoundingClientRect()
      const previous = control.closest('.abele-ai-chat__overflow').previousElementSibling.getBoundingClientRect()
      const header = {
        inside: icon.left >= button.left - 1 && icon.right <= button.right + 1,
        separate: previous.right <= button.left + 1,
        width: button.width,
        onScreen: previous.left >= -1 && button.right <= innerWidth + 1 && button.width > 0,
      }
      control.click()
      const item = await until(() => [...document.querySelectorAll('.menu .menu-item')].find((el) => el.textContent.trim() === 'Files from this chat'))
      item.click()
      root = await until(() => document.querySelector('.abele-chat-artifacts'))
      const results = []
      for (const count of [1, 11, 999]) {
        // Exercise the real projection and rendered count in an unsaved, disposable session.
        // Retained artifacts refer to files in this disposable fixture directory.
        session.touched.value = fixturePaths.slice(0, count).map(path => ({ path }))
        const expected = 'Notes (' + count + ')'
        const said = (el) => el.querySelector('.abele-fold-heading__text')?.textContent.trim() + ' (' + el.querySelector('.abele-fold-heading__count')?.textContent.trim() + ')'
        const heading = await until(() => {
          const el = root.querySelector('section[aria-label="Notes"] .abele-fold-heading')
          return el && said(el) === expected ? el : null
        })
        const range = document.createRange(); range.selectNodeContents(heading.querySelector('.abele-fold-heading__count'))
        const number = range.getBoundingClientRect(), box = root.getBoundingClientRect()
        // Empty sections are hidden: the count is checked against the first row under it.
        const firstRow = root.querySelector('section[aria-label="Notes"] .abele-chat-artifacts__row').getBoundingClientRect()
        results.push({
          ...header, expected, count: said(heading),
          countInside: number.left >= box.left - 1 && number.right <= box.right + 1,
          countSeparate: number.bottom <= firstRow.top + 1,
        })
      }
      if (document.body.classList.contains('is-mobile')) {
        const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage()
        require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
        require('fs').writeFileSync(${JSON.stringify(SHOTS + '/chat-artifacts-count-999.png')}, image.toPNG())
      }
      return results
    } finally {
      if (root?.isConnected) root.closest('.modal-container')?.querySelector('.modal-close-button, .modal-header-button')?.click()
      session.touched.value = []
      await chats.closeTab(tab)
      const directory = app.vault.getAbstractFileByPath(fixtureFolder)
      if (directory) await app.vault.delete(directory, true)
      if (priorTab) chats.switchTab(priorTab)
    }
  })()`,
        30_000
      )
    ) as BadgeMeasure[]

  const check = (results: BadgeMeasure[]) => {
    expect(results).toHaveLength(3)
    for (const result of results) {
      expect(result.count, JSON.stringify(result)).toBe(result.expected)
      expect(result.width, JSON.stringify(result)).toBeGreaterThan(0)
      expect(result.inside, JSON.stringify(result)).toBe(true)
      expect(result.separate, JSON.stringify(result)).toBe(true)
      expect(result.onScreen, JSON.stringify(result)).toBe(true)
      expect(result.countInside, JSON.stringify(result)).toBe(true)
      expect(result.countSeparate, JSON.stringify(result)).toBe(true)
    }
  }

  it('keeps the desktop header control separate and shows one-, two- and three-digit counts in Files from this chat', async () => {
    check(await measure())
  })

  it('keeps the phone-width header control separate and shows one-, two- and three-digit counts in Files from this chat', async () => {
    await reloadApp('app.emulateMobile(true)')
    evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(390, 844)")
    await new Promise((resolve) => setTimeout(resolve, 1500))
    check(await measure())
  })
})
