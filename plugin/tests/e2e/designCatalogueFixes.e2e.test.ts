/**
 * The designer's corrections to the kit's screens, measured in the running app on a desktop and
 * then in the phone layout (390×844):
 *
 * - «Locations and time»: a heading sits closer to its own line than to the block above it, by
 *   1.2 at least (design rule Р7, from `tests/design/rules.ts`);
 * - «Browse notes»: the fold arrow before a list's title is drawn at its own size, and the list's
 *   title is no bigger than the section heading it stands under;
 * - list rows on a phone end in one glyph, the menu: no opening arrow (but on a row that goes a
 *   level deeper) and no second fold arrow; their details fold from their words;
 * - «Activity»: a list of events draws no bar down its side.
 *
 * Every screen is pictured into `design-c/`, with the other dialogs this round changed: a long
 * comment thread, the date dialog and the debugger with no session.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
import { checkScreen } from '../design/rules'
import { measureGlyphBoxes } from './helpers/glyphBoxes'

targets('desktop')

const SHOTS = shotDir('design-c')

// The rule set travels into the page as source. A bundler may name its functions through a helper
// of its own, which the page has not got.
const RULES = `var __name = (f) => f; const checkScreen = ${checkScreen.toString()};`

type Report = {
  details: { ok: boolean; detail: string }
  fold: { arrow: number[]; text: number; heading: number }
  rows: { title: string; opener: boolean; fold: boolean; inline: boolean }[]
  events: string[]
  shots: string[]
  left: number
  glyphs: ReturnType<typeof measureGlyphBoxes>
}

/** Opens each page, measures it, pictures it and closes it again. */
async function measure(mode: 'desktop' | 'phone'): Promise<Report> {
  return JSON.parse(
    await evalLong(`(async () => {
      ${RULES}
      const measureGlyphBoxes = ${measureGlyphBoxes.toString()}
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
      const shots = []
      const glyphs = []
      const shoot = async (name) => {
        await wait(300)
        glyphs.push(...measureGlyphBoxes(document.querySelector('.abele-design-catalogue') ?? document.querySelector('.modal.abele-modal') ?? document.body))
        const file = ${JSON.stringify(SHOTS)} + '/2026-10-15-design-c-' + name + '-${mode}.png'
        const image = await require('@electron/remote').getCurrentWebContents().capturePage()
        require('fs').writeFileSync(file, image.toPNG())
        shots.push(file)
      }
      const open = async (page) => {
        window.__abeleTest.openDesignCatalogue(page, 'disclosed')
        await wait(500)
        await document.fonts.ready
        await new Promise(requestAnimationFrame)
        return document.querySelector('.abele-design-catalogue')
      }
      const report = { shots, glyphs }
      try {
        let root = await open('details')
        const r7 = checkScreen({ root }).rules.find((rule) => rule.id === 'Р7')
        report.details = { ok: r7.ok, detail: r7.detail }
        await shoot('locations')

        root = await open('navigation')
        const fold = root.querySelector('.abele-section .abele-fold-heading.is-collapsible')
        const svg = fold.querySelector('.abele-fold-heading__arrow svg').getBoundingClientRect()
        const size = (el) => parseFloat(getComputedStyle(el).fontSize)
        report.fold = {
          arrow: [svg.width, svg.height],
          text: size(fold.querySelector('.abele-fold-heading__text')),
          heading: size(fold.closest('.abele-section').querySelector('.abele-section__heading')),
        }
        await shoot('browse-notes')

        root = await open('rows')
        report.rows = [...root.querySelectorAll('.abele-list-row')].filter(visible).map((row) => ({
          title: row.querySelector('.abele-list-row__title-text')?.textContent.trim() ?? '',
          opener: visible(row.querySelector(':scope > .abele-list-row__line .abele-list-row__opener')),
          fold: visible(row.querySelector(':scope > .abele-list-row__line .abele-list-row__fold')),
          inline: visible(row.querySelector(':scope > .abele-list-row__line .abele-list-row__inline-fold')),
        }))
        await shoot('rows')

        root = await open('events')
        report.events = [...root.querySelectorAll('.abele-event-list')].map((list) => getComputedStyle(list).borderInlineStartWidth)
        await shoot('activity')
      } finally {
        window.__abeleTest.closeDesignCatalogue()
      }

      // The other screens this round changed, for their pictures.
      const modal = async (name, ready) => {
        window.__abeleTest.openDialog(name)
        for (let i = 0; i < 50 && !document.querySelector(ready); i++) await wait(100)
        await wait(500)
      }
      const dismiss = async () => {
        for (const modal of document.querySelectorAll('.modal.abele-modal')) {
          const cancel = [...modal.querySelectorAll('.abele-modal__footer button')].find((b) => b.textContent.trim() === 'Cancel')
          ;(cancel ?? modal.querySelector('.modal-close-button, .modal-header-button.mod-raised'))?.click()
        }
        for (let i = 0; i < 30 && document.querySelector('.modal.abele-modal'); i++) await wait(100)
      }
      await modal('text-comment-list', '.abele-text-comments__reply')
      await shoot('comment-thread')
      await dismiss()
      await modal('date', '.abele-modal__footer button')
      await shoot('date')
      await dismiss()
      const leaf = app.workspace.getRightLeaf(false)
      await leaf.setViewState({ type: 'abele-debug-view', active: true })
      app.workspace.revealLeaf(leaf)
      for (let i = 0; i < 50 && !leaf.view.containerEl.querySelector('.abele-empty-state'); i++) await wait(100)
      await shoot('debug-empty')
      leaf.detach()
      if (!document.body.classList.contains('is-phone')) app.workspace.rightSplit.collapse()
      report.left = document.querySelectorAll('.modal.abele-modal').length
      return JSON.stringify(report)
    })()`)
  ) as Report
}

function assertReport(r: Report, mode: 'desktop' | 'phone') {
  expect(r.details.ok, r.details.detail).toBe(true)
  // Obsidian draws its fold arrows 10px; a squeezed one came down to a 2px mark.
  expect(r.fold.arrow[0]).toBeGreaterThanOrEqual(8)
  expect(r.fold.arrow[1]).toBeGreaterThanOrEqual(8)
  expect(r.fold.text).toBeLessThanOrEqual(r.fold.heading)
  expect(r.events.length).toBeGreaterThan(0)
  expect(r.events.every((width) => width === '0px')).toBe(true)
  expect(r.rows.length).toBeGreaterThan(0)
  if (mode === 'phone') {
    expect(r.rows.filter((row) => row.opener || (row.fold && row.inline))).toEqual([])
    expect(r.rows.some((row) => row.inline)).toBe(true)
  } else expect(r.rows.filter((row) => row.inline)).toEqual([])
  expect(r.shots).toHaveLength(7)
  // Every dialog it opened is closed again, so the next picture and the next file start clean.
  expect(r.left).toBe(0)
  expect(r.glyphs.length).toBeGreaterThan(0)
  expect(r.glyphs.filter((glyph) => glyph.squashed)).toEqual([])
}

describe('the designer corrections to the kit screens', () => {
  let phone: Report | undefined
  afterAll(() => console.log('Design corrections:', JSON.stringify(phone)))

  it('hold on a desktop', async () => {
    const r = await measure('desktop')
    console.log('Desktop design corrections:', JSON.stringify(r))
    assertReport(r, 'desktop')
  }, 180_000)

  it('hold in the phone layout', async () => {
    phone = await withEmulatedPhone(() => measure('phone'))
    assertReport(phone, 'phone')
  }, 300_000)
})
