/**
 * How a chat message lines up.
 *
 * Two defects, both invisible to any tier that computes no layout:
 *
 * - the icon beside a message was placed with hand-picked pixel offsets, tuned once against a
 *   desktop font size. They were wrong everywhere else, and a phone's larger text moved the
 *   text without moving the icon.
 * - the `failed` badge on a tool call is a flex item beside a file path of any length, inside
 *   a body that sets `word-break: break-word`. Left to shrink, it collapsed to one character
 *   of width and broke the word across three lines.
 *
 * The rows are built here rather than driven through a real conversation: the questions are
 * about CSS, the app's own stylesheet is loaded, and a failed tool call is not something a
 * test should have to provoke. What that costs is knowing the markup is still this shape,
 * which `tests/component/chatMessage.test.ts` asserts against the component itself.
 *
 * Requires Obsidian running with the plugin installed — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { isObsidianRunning, evalJson, activeVaultName } from './helpers/obsidianCli'

interface Row {
  /** How far the icon's middle sits from the middle of the first line of text, in pixels. */
  iconOffset: number
  /** The same for the timestamp. */
  timeOffset: number
  /** Line boxes the `failed` badge occupies. One, or it has been squeezed. */
  badgeLines: number
}

type Report = Record<string, Row>

/** A phone's column, and the same at a font size a phone might actually be set to. */
const WIDTHS = [
  { width: 330, font: 16 },
  { width: 330, font: 20 },
]

const probe = (width: number, font: number) => `(() => {
  const host = document.createElement('div')
  host.style.cssText =
    'position:fixed;left:-9999px;top:0;width:${width}px;font-size:${font}px'

  // Text messages have their actions and time on the line below the words. Tool calls keep
  // their action glyph beside the first line. Match the real component's native button boxes.
  const glyph = '<span class="abele-obsidian-icon__icon"><svg class="svg-icon" width="16" height="16"></svg></span>'
  const icon = '<button type="button" class="clickable-icon abele-chat-msg__icon"><span class="abele-obsidian-icon">' + glyph + '</span></button>'
  const bar = '<div class="abele-chat-msg__bar"><span class="abele-chat-msg__quick">' +
    '<button type="button" class="clickable-icon abele-obsidian-icon abele-chat-msg__bar-action">' + glyph + '</button></span>' +
    '<button type="button" class="clickable-icon abele-obsidian-button abele-chat-msg__icon abele-chat-msg__time"><span class="abele-obsidian-button__label"><time>12:30</time></span></button></div>'
  const row = (role, body) =>
    '<div class="abele-chat-msg abele-chat-msg_' + role + '">' + (role === 'tool-call' ? icon : '') +
    '<div class="abele-chat-msg__body">' + body + '</div>' + (role === 'tool-call' ? '' : bar) + '</div>'

  host.innerHTML =
    row('assistant', '<p>An assistant line of text</p>') +
    row('user', '<p>A user line of text</p>') +
    row('tool-call',
      '<span class="abele-chat-msg__tool-line"><code>edit</code>' +
      '<span class="abele-chat-msg__tool-summary">' +
      'Sample/Long folder/Notes/sample-reference-with-a-long-name.md</span>' +
      '<span class="abele-chat-msg__tool-err-badge">failed</span></span>')
  document.body.appendChild(host)

  // A text node's line boxes, in order. One rect per line: the count says whether something
  // wrapped, and the first says where the text it starts on actually sits.
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
  for (const el of [...host.querySelectorAll('.abele-chat-msg')]) {
    const role = el.className.replace('abele-chat-msg abele-chat-msg_', '')
    const text = lines(firstText(el.querySelector('.abele-chat-msg__body')))[0]
    const badge = el.querySelector('.abele-chat-msg__tool-err-badge')
    const time = el.querySelector('.abele-chat-msg__time')
    const action = el.querySelector('.abele-chat-msg__bar-action')
    const timeText = time ? lines(firstText(time))[0] : null
    report[role] = {
      iconOffset: round(boxMiddle(action || el.querySelector('.abele-chat-msg__icon')) - middle(timeText || text)),
      timeOffset: time ? round(boxMiddle(time) - middle(timeText)) : 0,
      badgeLines: badge ? lines(firstText(badge)).length : 0,
    }
  }

  host.remove()
  return report
})()`

/**
 * A pixel of slack. The icon is centred on the line by CSS, so the honest expectation is
 * zero; sub-pixel font metrics land it a fraction either side.
 */
const SLACK = 1

const available = isObsidianRunning()

describe.skipIf(!available)('a chat message', () => {
  const reports = new Map<string, Report>()

  beforeAll(() => {
    for (const { width, font } of WIDTHS) {
      reports.set(`${width}px at ${font}px text`, evalJson<Report>(probe(width, font), 60_000))
    }
    console.info(`\n  vault ...................... ${activeVaultName()}\n`)
  }, 120_000)

  for (const { width, font } of WIDTHS) {
    const label = `${width}px at ${font}px text`

    describe(`in ${label}`, () => {
      const report = () => {
        const found = reports.get(label)
        if (!found) throw new Error(`No report was gathered for ${label}`)
        return found
      }

      it('aligns tool glyphs with their first line and message actions with their time line', () => {
        const offsets = Object.fromEntries(
          Object.entries(report()).map(([role, r]) => [role, r.iconOffset])
        )
        const off = Object.entries(offsets).filter(([, v]) => Math.abs(v) > SLACK)

        expect(Object.fromEntries(off), `offsets: ${JSON.stringify(offsets)}`).toEqual({})
      })

      it('centres the timestamp on its action line', () => {
        const off = Object.entries(report()).filter(([, r]) => Math.abs(r.timeOffset) > 2)

        expect(Object.fromEntries(off)).toEqual({})
      })

      it('keeps the failure badge on one line', () => {
        expect(report()['tool-call'].badgeLines).toBe(1)
      })
    })
  }
})
