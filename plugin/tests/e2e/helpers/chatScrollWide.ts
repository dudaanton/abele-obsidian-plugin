import { script } from './chatScrollMatrix'
import { scrollCompletion } from './scrollCompletion'
import { wideWheelStep } from './wideWheelStep'

/** Same matrix fixture/cleanup, with a wide pane and compact folded history. */
export function wideScript() {
  let full = script('long', 'idle', false)
  const textStart = full.indexOf('    const text =')
  const textEnd = full.indexOf('    records.push', textStart)
  full = full.slice(0, textStart) + "    const text = 'Sample.'\n" + full.slice(textEnd)
  // The final standalone tool must start its own folded run: item(tail) cannot
  // select an interior call whose DOM is intentionally absent while collapsed.
  full = full.replace('i > 0 && i % 4 === 0', 'i % 4 !== 0 && i < count - 1')
  full = full.replace(
    '  const box = () =>',
    '  let wideBox, wideSplit, originalSize; const box = () => wideBox ??'
  )
  full = full.replace(
    '    await until(() => item(tail))',
    `
    await until(() => {
      wideBox = [...document.querySelectorAll('.abele-ai-chat__messages')].find(el =>
        el.getClientRects().length && el.querySelector('[data-message-id="' + tail + '"]'))
      return wideBox
    })
    const leaf = app.workspace.getLeavesOfType('abele-ai-sidebar-view').find(leaf => leaf.view.containerEl.contains(wideBox))
    wideSplit = leaf?.getRoot()
    if (wideSplit !== app.workspace.rightSplit && wideSplit !== app.workspace.leftSplit)
      throw Error('Wide fixture is not in a sidebar leaf')
    originalSize = wideSplit.size
    wideSplit.setSize(1500)
    await until(() => {
      const r = box().getBoundingClientRect()
      report.setup = { width: r.width, height: box().clientHeight, left: r.left, top: r.top,
        sidebar: wideSplit.containerEl.getBoundingClientRect().width, size: wideSplit.size,
        innerWidth, innerHeight, screenWidth: screen.availWidth, screenHeight: screen.availHeight,
        windowSize: require('@electron/remote').getCurrentWindow().getContentSize() }
      return r.width >= 1450 && box().clientHeight >= 800
    })
    box().scrollTop = box().scrollHeight
    box().dispatchEvent(new Event('scroll'))
  `
  )
  full = full.replace(
    '    stop = true;',
    `
    if (wideSplit && originalSize !== undefined) wideSplit.setSize(originalSize)
    stop = true;`
  )
  const start = full.indexOf("    begin('one screen up')")
  const end = full.indexOf('  } catch (e) { report.error')
  return (
    full.slice(0, start) +
    `
    report.wideSteps = []; report.missing = []; report.wideDrift = 0
    const el = box(), bounds = el.getBoundingClientRect()
    // Native wheel deltas are device-independent pixels, while row rectangles
    // use CSS pixels. Preserve a 40 CSS-pixel gesture at the fixture's zoom.
    const wheelScale = require('@electron/remote').getCurrentWebContents().getZoomFactor()
    report.width = bounds.width; report.height = bounds.height
    report.startGap = el.scrollHeight - el.scrollTop - el.clientHeight
    report.collapsedRuns = el.querySelectorAll('.abele-chat-run.is-collapsed').length
    if (report.startGap > 2) throw Error('Wide fixture did not settle at the bottom: ' + report.startGap)
    if (!report.collapsedRuns) throw Error('Wide fixture has no collapsed tool rows')
    if (!el.contains(document.elementFromPoint(bounds.left + 100, bounds.top + 400)))
      throw Error('Wide wheel target is obscured')
    begin('wide compact upward wheel')
    const wheelStep = ${wideWheelStep.toString()}
    const completeScroll = ${scrollCompletion.toString()}
    // Queue once for the complete matrix, so six sweeps cannot each spend a
    // minute waiting for another window. Setup and captures leave the lane free.
    await inputGesture(async () => {
    for (let pass = 0; pass < 3; pass++) {
    for (const delta of [-40, 40]) {
    let reachedEdge = false
    for (let n = 0; n < 250; n++) {
      // Retain the matrix's queue-adjusted active-time budget as well as the
      // per-event receipt/completion limits. Failure returns progress and cleans up.
      await wait(0)
      report.wideProgress = { pass, delta, step: n, scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, receivedInputs }
      const visible = [...el.querySelectorAll('.abele-chat-msg, .abele-chat-run.is-collapsed')]
        .filter(e => { const r = e.getBoundingClientRect(); return r.top >= bounds.top + 80 && r.bottom <= bounds.bottom - 80 })
        .map(e => ({ e, top: e.getBoundingClientRect().top }))
      if (delta < 0 && !el.querySelector('.abele-ai-chat__older') && el.scrollTop < 40) { reachedEdge = true; break }
      if (delta > 0 && item(tail) && el.scrollHeight - el.scrollTop - el.clientHeight < 40) { reachedEdge = true; break }
      await wheelStep(el, () => cdp('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: bounds.left + 100, y: bounds.top + 400,
        deltaX: 0, deltaY: delta * wheelScale
      }), () => receivedInputs, completeScroll)
      for (const { e, top } of visible) {
        if (!e.isConnected) report.missing.push({ step: n, id: e.dataset.messageId })
        else report.wideDrift = Math.max(report.wideDrift, Math.abs(e.getBoundingClientRect().top - top + delta))
      }
      report.wideSteps.push({ pass, delta, step: n })
    }
    if (!reachedEdge) throw Error('Wide wheel sweep exceeded 250 steps: ' + JSON.stringify(report.wideProgress))
    }
    }
    })
    await capture('wide-compact-multiple-passes')
  ` +
    full.slice(end)
  )
}
