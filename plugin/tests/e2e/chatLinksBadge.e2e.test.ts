import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { targets } from './helpers/target'

targets('desktop')

interface BadgeMeasure {
  count: string
  inside: boolean
  separate: boolean
  width: number
  onScreen: boolean
}

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('chat link count in the header', () => {
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

  const measure = (): BadgeMeasure[] =>
    JSON.parse(
      evalRaw(
        `(async () => {
    app.commands.executeCommandById('abele:show-ai-sidebar')
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    let badge
    for (let i = 0; i < 40; i++) {
      badge = document.querySelector('.abele-ai-chat__header-actions .abele-ai-chat__notes')
      if (badge) break
      await wait(100)
    }
    if (!badge) throw new Error('no chat link button')
    let leaf
    app.workspace.iterateAllLeaves((candidate) => {
      if (candidate.view.containerEl.contains(badge)) leaf = candidate
    })
    if (leaf) await app.workspace.revealLeaf(leaf)
    await wait(500)
    // Exercise the rendered Icon's actual text node, without writing links to the vault.
    const existing = badge.querySelector('.abele-obsidian-icon__text')
    const text = existing || document.createElement('div')
    const previous = text.textContent
    if (!existing) {
      text.className = 'abele-obsidian-icon__text'
      badge.appendChild(text)
    }
    try {
      const results = ['1', '11', '999'].map((count) => {
        text.textContent = count
        const button = badge.getBoundingClientRect()
        const number = text.getBoundingClientRect()
        const next = badge.nextElementSibling.getBoundingClientRect()
        return {
          count,
          inside: number.left >= button.left - 1 && number.right <= button.right - 1,
          separate: button.right <= next.left + 1 && number.right <= next.left + 1,
          width: button.width,
          onScreen: button.left >= -1 && next.right <= innerWidth + 1,
        }
      })
      // Picture the widest count in the phone-width header alongside the geometry.
      if (document.body.classList.contains('is-mobile')) {
        text.textContent = '999'
        const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage()
        require('fs').mkdirSync('/tmp/abele-phone', { recursive: true })
        require('fs').writeFileSync('/tmp/abele-phone/chat-links-999.png', image.toPNG())
      }
      return JSON.stringify(results)
    } finally {
      if (existing) text.textContent = previous
      else text.remove()
    }
  })()`,
        30_000
      )
    ) as BadgeMeasure[]

  it('contains one-, two- and three-digit counts on the desktop', () => {
    for (const result of measure()) {
      expect(result.inside, JSON.stringify(result)).toBe(true)
      expect(result.separate, JSON.stringify(result)).toBe(true)
      expect(result.onScreen, JSON.stringify(result)).toBe(true)
    }
  })

  it('contains one-, two- and three-digit counts in a phone-width header', async () => {
    await reloadApp('app.emulateMobile(true)')
    evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(390, 844)")
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const results = measure()
    for (const result of results) {
      expect(result.inside, JSON.stringify(result)).toBe(true)
      expect(result.separate, JSON.stringify(result)).toBe(true)
      expect(result.onScreen, JSON.stringify(result)).toBe(true)
    }
  })
})
