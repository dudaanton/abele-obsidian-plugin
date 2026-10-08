import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalJson, evalLong, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
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

describe.skipIf(!available)('chat Artifacts control and linked-note counts', () => {
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
      throw new Error('Artifacts UI did not settle')
    }
    let root
    try {
      await chats.revealSidebar()
      const control = await until(() => document.querySelector('.abele-ai-chat__header-actions .abele-ai-chat__artifacts'))
      await wait(500)
      const button = control.getBoundingClientRect()
      const icon = control.querySelector('svg').getBoundingClientRect()
      const previous = control.previousElementSibling.getBoundingClientRect()
      const next = control.nextElementSibling.getBoundingClientRect()
      const header = {
        inside: icon.left >= button.left - 1 && icon.right <= button.right + 1,
        separate: previous.right <= button.left + 1 && button.right <= next.left + 1,
        width: button.width,
        onScreen: previous.left >= -1 && next.right <= innerWidth + 1 && button.width > 0,
      }
      control.click()
      root = await until(() => document.querySelector('.abele-chat-artifacts'))
      const results = []
      for (const count of [1, 11, 999]) {
        // Exercise the real projection and rendered count in an unsaved, disposable session.
        // Missing synthetic resources still have membership; no vault files are written.
        session.touched.value = Array.from({ length: count }, (_, i) => ({ path: 'Sample count note ' + i + '.md' }))
        const expected = 'Notes (' + count + ')'
        const heading = await until(() => {
          const el = root.querySelector('section[aria-label="Notes"] h3')
          return el?.textContent.trim() === expected ? el : null
        })
        const range = document.createRange(); range.selectNodeContents(heading)
        const number = range.getBoundingClientRect(), box = root.getBoundingClientRect()
        const nextHeading = root.querySelector('section[aria-label="Images"] h3').getBoundingClientRect()
        results.push({
          ...header, expected, count: heading.textContent.trim(),
          countInside: number.left >= box.left - 1 && number.right <= box.right + 1,
          countSeparate: number.bottom <= nextHeading.top + 1,
        })
      }
      if (document.body.classList.contains('is-mobile')) {
        const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage()
        require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
        require('fs').writeFileSync(${JSON.stringify(SHOTS + '/chat-artifacts-count-999.png')}, image.toPNG())
      }
      return results
    } finally {
      if (root?.isConnected) document.querySelector('.modal-close-button')?.click()
      session.touched.value = []
      await chats.closeTab(tab)
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

  it('keeps the desktop header control separate and shows one-, two- and three-digit counts in Artifacts', async () => {
    check(await measure())
  })

  it('keeps the phone-width header control separate and shows one-, two- and three-digit counts in Artifacts', async () => {
    await reloadApp('app.emulateMobile(true)')
    evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(390, 844)")
    await new Promise((resolve) => setTimeout(resolve, 1500))
    check(await measure())
  })

  // BUG: Artifacts replaced the link control but no longer displays a count in the header.
  // Keep the old contract visible until the replacement is approved; section counts are above.
  it.fails('shows the linked-note count on the Artifacts header control', () => {
    const count = evalRaw(
      `document.querySelector('.abele-ai-chat__artifacts .abele-obsidian-icon__text')?.textContent || ''`
    )
    expect(count).toMatch(/\d+/)
  })
})
