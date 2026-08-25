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

  // The shape AiChatMessage.vue emits: the icon and the timestamp are siblings of the body,
  // and the icon is the kit's, which brings its own box.
  const icon = '<div class="abele-chat-msg__icon"><div class="abele-obsidian-icon">' +
    '<div class="abele-obsidian-icon__icon"><svg class="svg-icon" width="16" height="16">' +
    '</svg></div></div></div>'
  const time = '<span class="abele-chat-msg__time">12:30</span>'
  const row = (role, body) =>
    '<div class="abele-chat-msg abele-chat-msg_' + role + '">' + icon +
    '<div class="abele-chat-msg__body">' + body + '</div>' + time + '</div>'

  host.innerHTML =
    row('assistant', '<p>An assistant line of text</p>') +
    row('user', '<p>A user line of text</p>') +
    row('tool-call',
      '<span class="abele-chat-msg__tool-line"><code>edit</code>' +
      '<span class="abele-chat-msg__tool-summary">' +
      'Notes/English Study Test/English study system.md</span>' +
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
    report[role] = {
      iconOffset: round(boxMiddle(el.querySelector('.abele-chat-msg__icon')) - middle(text)),
      timeOffset: round(boxMiddle(el.querySelector('.abele-chat-msg__time')) - middle(text)),
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

      it('sits its icon on the first line of the message, whatever the message is', () => {
        const offsets = Object.fromEntries(
          Object.entries(report()).map(([role, r]) => [role, r.iconOffset])
        )
        const off = Object.entries(offsets).filter(([, v]) => Math.abs(v) > SLACK)

        expect(Object.fromEntries(off), `offsets: ${JSON.stringify(offsets)}`).toEqual({})
      })

      it('puts the timestamp on that line too', () => {
        const off = Object.entries(report()).filter(([, r]) => Math.abs(r.timeOffset) > 2)

        expect(Object.fromEntries(off)).toEqual({})
      })

      it('keeps the failure badge on one line', () => {
        expect(report()['tool-call'].badgeLines).toBe(1)
      })
    })
  }
})
