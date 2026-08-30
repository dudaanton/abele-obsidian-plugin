/**
 * Where the chevron sits on a transaction that has a note to expand.
 *
 * It belongs to the title and opens the text underneath it, but the title was a flex item set
 * to take everything left over, so the chevron was pushed to the far right of the row: a hand's
 * breadth from the words it belongs to, and level with nothing, because the amount beside it is
 * centred on the whole row rather than on the first line. It read as a stray control.
 *
 * Built here rather than driven through a real transaction: the question is about CSS, the
 * app's own stylesheet is loaded, and a vault with a described transaction in it is not
 * something a test should have to arrange. What that costs is knowing the markup is still this
 * shape, which `TransactionItem.vue` owns.
 *
 * Requires Obsidian running with the plugin installed — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { isObsidianRunning, evalJson, activeVaultName } from './helpers/obsidianCli'

interface Row {
  /** Pixels between the end of the title's text and the left edge of the chevron. */
  chevronGap: number
  /** How far the chevron's middle sits from the middle of the title's first line. */
  chevronOffset: number
  /** Line boxes the title occupies. */
  titleLines: number
}

type Report = Record<string, Row>

/** A sidebar's column and a note's, so the row is measured narrow and wide. */
const WIDTHS = [360, 900]

const probe = (width: number) => `(() => {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:${width}px;font-size:16px'

  // The shape TransactionItem.vue emits: the title and the chevron are siblings inside
  // __main, and the chevron is the kit's icon, which brings its own box.
  const chevron = '<div class="abele-obsidian-icon">' +
    '<div class="abele-obsidian-icon__icon"><svg class="svg-icon" width="16" height="16">' +
    '</svg></div></div>'
  const row = (name, title) =>
    '<div class="abele-transaction-view" data-name="' + name + '">' +
      '<div class="abele-transaction-view__content">' +
        '<div class="abele-transaction-view__main">' +
          '<div class="abele-markdown abele-transaction-view__title"><p>' + title + '</p></div>' +
          chevron +
        '</div>' +
        '<div class="abele-transaction-view__info">' +
          '<span class="abele-transaction-view__accounts">' +
            '<span class="abele-transaction-view__link"><p>tinkoff ACC RUB</p></span>' +
            '<span> \\u2192 </span>' +
            '<span class="abele-transaction-view__link"><p>Services ACC</p></span>' +
          '</span>' +
        '</div>' +
      '</div>' +
      '<span class="abele-transaction-view__amount">-500.00 ' +
        '<span class="abele-transaction-view__currency">RUB</span></span>' +
    '</div>'

  host.innerHTML =
    row('short', 'SUBS - regru') +
    row('long', 'A subscription with a name long enough to fill the whole of the row it is on ' +
      'and then some, which is what a wrapped title looks like')
  document.body.appendChild(host)

  const lines = (node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    return [...range.getClientRects()]
  }
  const firstText = (el) => document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode()
  const middle = (r) => r.top + r.height / 2
  const boxMiddle = (el) => {
    const r = el.getBoundingClientRect()
    return r.top + r.height / 2
  }
  const round = (n) => Math.round(n * 10) / 10

  const report = {}
  for (const el of [...host.querySelectorAll('.abele-transaction-view')]) {
    const title = el.querySelector('.abele-transaction-view__title')
    const boxes = lines(firstText(title))
    const icon = el.querySelector('.abele-obsidian-icon')
    report[el.dataset.name] = {
      chevronGap: round(icon.getBoundingClientRect().left - boxes[boxes.length - 1].right),
      chevronOffset: round(boxMiddle(icon) - middle(boxes[0])),
      titleLines: boxes.length,
    }
  }

  host.remove()
  return report
})()`

/** The gap the stylesheet asks for is 0.5em; anything near it is the chevron being beside it. */
const BESIDE_IT_PX = 16

const available = isObsidianRunning()

describe.skipIf(!available)('a transaction with a note to expand', () => {
  const reports = new Map<number, Report>()

  beforeAll(() => {
    for (const width of WIDTHS) reports.set(width, evalJson<Report>(probe(width), 60_000))
    console.info(`\n  vault ...................... ${activeVaultName()}\n`)
  }, 120_000)

  for (const width of WIDTHS) {
    describe(`in a ${width}px column`, () => {
      const report = () => {
        const found = reports.get(width)
        if (!found) throw new Error(`No report was gathered for ${width}px`)
        return found
      }

      it('puts the chevron beside the title rather than across the row', () => {
        expect(report().short.chevronGap).toBeLessThanOrEqual(BESIDE_IT_PX)
      })

      it('leaves it on the same line as the title', () => {
        expect(Math.abs(report().short.chevronOffset)).toBeLessThanOrEqual(2)
      })

      /**
       * A title long enough to fill the row takes all of it, and then the chevron is at the
       * end of the title's own box rather than beside its last line — there is nowhere else
       * for it to be. What still has to hold is that it belongs to the first line.
       */
      it('keeps it on the first line of one long enough to wrap', () => {
        expect(report().long.titleLines).toBeGreaterThan(1)
        expect(Math.abs(report().long.chevronOffset)).toBeLessThanOrEqual(2)
      })
    })
  }
})
