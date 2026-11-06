import { expect, it } from 'vitest'
import { evalJson, evalLong, evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { withNativeInput } from './helpers/nativeInput'
import { script } from './helpers/chatScrollMatrix'
import { targets } from './helpers/target'

targets('desktop')

/** Same matrix fixture/cleanup, with a wide pane and compact folded history. */
function wideScript() {
  let full = script('long', 'idle', false)
  const textStart = full.indexOf('    const text =')
  const textEnd = full.indexOf('    records.push', textStart)
  full = full.slice(0, textStart) + "    const text = 'Sample.'\n" + full.slice(textEnd)
  full = full.replace('i > 0 && i % 4 === 0', 'i % 4 !== 0')
  full = full.replace('  let file, session,', '  let originalStyle; let file, session,')
  full = full.replace(
    '    await until(() => item(tail))',
    `
    await until(() => item(tail))
    originalStyle = box().getAttribute('style')
    Object.assign(box().style, { position: 'fixed', left: '0', top: '0', width: '1500px', height: '900px', zIndex: '1000' })
  `
  )
  full = full.replace(
    '    stop = true;',
    `
    if (box() && originalStyle !== undefined) {
      if (originalStyle === null) box().removeAttribute('style'); else box().setAttribute('style', originalStyle)
    }
    stop = true;`
  )
  const start = full.indexOf("    begin('one screen up')")
  const end = full.indexOf('  } catch (e) { report.error')
  return (
    full.slice(0, start) +
    `
    report.wideSteps = []; report.missing = []; report.wideDrift = 0
    const el = box(), bounds = el.getBoundingClientRect()
    report.width = bounds.width; report.height = bounds.height
    begin('wide compact upward wheel')
    for (let n = 0; n < 250; n++) {
      const visible = [...el.querySelectorAll('.abele-chat-msg, .abele-chat-run.is-collapsed')]
        .filter(e => { const r = e.getBoundingClientRect(); return r.top >= bounds.top + 80 && r.bottom <= bounds.bottom - 80 })
        .map(e => ({ e, top: e.getBoundingClientRect().top }))
      if (!el.querySelector('.abele-ai-chat__older') && el.scrollTop < 40) break
      const receipt = receivedInputs
      await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: bounds.left + 100, y: bounds.top + 400, deltaX: 0, deltaY: -40 })
      await wait(80)
      if (receivedInputs <= receipt) throw Error('Wide wheel input was not received')
      for (const { e, top } of visible) {
        if (!e.isConnected) report.missing.push({ step: n, id: e.dataset.messageId })
        else report.wideDrift = Math.max(report.wideDrift, Math.abs(e.getBoundingClientRect().top - top - 40))
      }
      report.wideSteps.push(n)
    }
    await capture('wide-compact-upward')
  ` +
    full.slice(end)
  )
}

it.runIf(isObsidianRunning() && hasTestApi())(
  'keeps visible rows while wheeling up a wide compact chat',
  async () => {
    const size = evalJson<number[]>(
      "require('@electron/remote').getCurrentWindow().getContentSize()"
    )
    try {
      evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(1700, 1100)")
      const report = await withNativeInput(async () =>
        JSON.parse(await evalLong(wideScript(), 90_000))
      )
      console.info('wide-scroll-matrix', JSON.stringify(report))
      expect(report.error).toBeUndefined()
      expect(report.width).toBe(1500)
      expect(report.height).toBe(900)
      expect(report.wideSteps.length).toBeGreaterThan(20)
      expect(report.missing).toEqual([])
      expect(report.wideDrift).toBeLessThanOrEqual(2)
    } finally {
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`
      )
    }
  },
  120_000
)
