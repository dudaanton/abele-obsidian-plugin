import { shotDir } from './shots'
import { visibleChatAnchor } from './visibleChatAnchor'
import { traceScrollInput } from './scrollInputTrace'
import { scrollCompletion } from './scrollCompletion'

export const states = ['idle', 'text', 'running-tool', 'finished-tool', 'finished-reply'] as const
const shots = shotDir('abele-phone')

/** Fail setup promptly if native input is not reaching this window, before measuring the chat. */
export const inputProbe = (phone: boolean) => `(async () => {
  const wc = require('@electron/remote').getCurrentWebContents()
  const debuggerApi = wc.debugger
  const attached = debuggerApi.isAttached(), el = document.createElement('div')
  const chat = [...document.querySelectorAll('.abele-ai-chat__messages')].find(e => e.getClientRects().length)
  const rect = chat?.getBoundingClientRect() || { left: 30, top: 112, width: 330, height: 562 }
  const x = rect.left + 8, y = rect.top + rect.height / 2
  el.style.cssText = 'position:fixed;left:30px;top:60px;width:200px;height:240px;overflow:auto;z-index:2147483647;background:var(--background-primary)'
  Object.assign(el.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' })
  const content = document.createElement('div'); content.style.height = '50000px'; el.append(content)
  const inputs = []
  let phase = 'normal'
  const record = event => inputs.push({ phase, type: event.type,
    y: (event.touches?.[0] || event.changedTouches?.[0])?.clientY,
    deltaY: event.deltaY, scrollTop: el.scrollTop })
  for (const type of ['touchstart', 'touchmove', 'touchend', 'wheel'])
    el.addEventListener(type, record, { passive: true })
  try {
    if (!attached) debuggerApi.attach('1.3')
    document.body.append(el); el.scrollTop = 10000
    const cdp = (method, params) => debuggerApi.sendCommand(method, params)
    ${
      phone
        ? `await cdp('Emulation.setTouchEmulationEnabled', { enabled: true })
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let n = 1; n <= 8; n++) {
      await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - n * 15 }] })
      await new Promise(r => setTimeout(r, 24))
    }
    await new Promise(r => setTimeout(r, 120))
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })`
        : `await debuggerApi.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: 120 })`
    }
    await new Promise(r => setTimeout(r, 400))
    const moved = el.scrollTop - 10000, beforeFast = el.scrollTop
    phase = 'fast-small'
    await debuggerApi.sendCommand('Input.synthesizeScrollGesture', { x, y, yDistance: -600,
      speed: 6000, gestureSourceType: ${JSON.stringify(phone ? 'touch' : 'mouse')}, preventFling: true })
    await new Promise(r => setTimeout(r, 100))
    const fastMoved = el.scrollTop - beforeFast
    if (fastMoved < 300) throw Error('Fast native input did not reach the scroll box')
    const largeRequested = (chat?.clientHeight || 562) * 6
    const beforeLarge = el.scrollTop
    phase = 'fast-large-down'
    await cdp('Input.synthesizeScrollGesture', { x, y, yDistance: -largeRequested,
      speed: 12000, gestureSourceType: ${JSON.stringify(phone ? 'touch' : 'mouse')}, preventFling: true })
    await new Promise(r => setTimeout(r, 100))
    const largeMoved = el.scrollTop - beforeLarge
    await new Promise(r => setTimeout(r, 300))
    const largeSettledMoved = el.scrollTop - beforeLarge, beforeUp = el.scrollTop
    phase = 'fast-large-up'
    await cdp('Input.synthesizeScrollGesture', { x, y, yDistance: largeRequested,
      speed: 12000, gestureSourceType: ${JSON.stringify(phone ? 'touch' : 'mouse')}, preventFling: true })
    await new Promise(r => setTimeout(r, 100))
    const largeUpMoved = beforeUp - el.scrollTop
    await new Promise(r => setTimeout(r, 300))
    const largeUpSettledMoved = beforeUp - el.scrollTop, explicitLarge = []
    if (${phone}) for (const sign of [1, -1]) {
      const before = el.scrollTop
      phase = 'explicit-large-' + sign
      await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      for (let n = 1; n <= 12; n++) {
        await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - sign * largeRequested * n / 12 }] })
        await new Promise(r => setTimeout(r, 24))
      }
      await new Promise(r => setTimeout(r, 120))
      await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await new Promise(r => setTimeout(r, 400))
      explicitLarge.push({ sign, requested: largeRequested, moved: sign * (el.scrollTop - before) })
    }
    return JSON.stringify({ moved, requested: 120, fastMoved, fastRequested: 600,
      largeRequested, largeMoved, largeSettledMoved, largeUpMoved,
      largeUpSettledMoved, explicitLarge,
      devicePixelRatio, viewportScale: visualViewport?.scale, inputs })
  } finally {
    el.remove()
    ${phone ? "await debuggerApi.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false })" : ''}
    if (!attached && debuggerApi.isAttached()) debuggerApi.detach()
  }
})()`

/** Reuse the identical fixture/provider lifecycle for a focused navigation-to-End scenario. */
export function endScript(size: string, state: string, phone: boolean): string {
  const full = script(size, state, phone)
  const reading = full.indexOf("    begin('one screen up')")
  const navigation = full.indexOf("    begin('navigation')")
  const sending = full.indexOf("    begin('send while reading history')")
  const cleanup = full.indexOf('  } catch (e) { report.error')
  if (reading < 0 || navigation < reading || sending < navigation || cleanup < sending)
    throw new Error('Matrix phase boundaries changed')
  return (
    full
      .slice(0, reading)
      .replace("await capture('following')", "await capture('end-preparation')") +
    full.slice(navigation, sending) +
    `
    begin('End from history')
    const latest = session.messages.value.at(-1)?.id
    report.evicted = !!latest && !item(latest)
    box().tabIndex = -1; box().focus({ preventScroll: true })
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
    keyDown = true
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
    keyDown = false
    await wait(1500)
    row.bottomGap = box().scrollHeight - box().scrollTop - box().clientHeight
    row.destination = !!latest && !!item(latest)
    await capture('end-from-history')
` +
    full.slice(cleanup)
  ).replace("'-frames.json'", "'-end-frames.json'")
}

/** Complete a reply while it is being read inside a full, contiguous history window. */
export function handoffScript(phone: boolean): string {
  const full = script('long', 'text', phone)
    .replace('maxTokens: 1000', 'maxTokens: 50000')
    .replace("n % 12 ? 'Sample leaf. '", "n % 12 ? 'Sample leaf. '.repeat(8)")
    .replace('Sample live paragraph. ', "Sample live paragraph ' + n + '. ")
  const reading = full.indexOf("    begin('one screen up')")
  const navigation = full.indexOf("    begin('navigation')")
  const sending = full.indexOf("    begin('send while reading history')")
  const cleanup = full.indexOf('  } catch (e) { report.error')
  if (reading < 0 || navigation < reading || sending < navigation || cleanup < sending)
    throw new Error('Matrix phase boundaries changed')
  const latest = full
    .slice(navigation, sending)
    .replace("begin('navigation')", "begin('prepare latest window')")
    .replaceAll('To the start', 'To the latest')
    .replace(
      "row.destination = !!item('m0')",
      'row.destination = !!item(session.messages.value.at(-1)?.id)'
    )
  return (
    full
      .slice(0, reading)
      .replace("await capture('following')", "await capture('handoff-following')") +
    latest +
    `
    begin('prepare full window')
    const hidden = () => Number(box().querySelector('.abele-ai-chat__older button')?.textContent.match(/\\d+/)?.[0])
    const beforeOlder = hidden()
    for (let n = 0; n < 2; n++) {
      const marker = box().querySelector('.abele-ai-chat__older button')
      if (!marker) throw Error('Full-window fixture has no earlier marker')
      marker.click(); await wait(150)
    }
    const mountedRows = box().querySelectorAll('[data-message-id], .abele-chat-run__inline-file > .abele-chat-tool-files').length
    report.fullWindow = beforeOlder > hidden() && mountedRows >= 89 && mountedRows <= 90 &&
      !!item(session.messages.value.at(-1)?.id)
    report.mountedRows = mountedRows
    const host = box().querySelector('.abele-ai-chat__streaming-content')
    if (!host || host.getBoundingClientRect().height < box().clientHeight * 2) throw Error('Live reply is not tall enough to read inside')
    // Input realism is exercised by the main matrix; set this handoff precondition precisely.
    box().dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }))
    box().scrollTop += host.getBoundingClientRect().bottom - box().getBoundingClientRect().bottom - box().clientHeight / 2
    box().dispatchEvent(new Event('scroll'))
    await wait(120)
    const anchor = visibleAnchor(), text = anchor?.textContent, at = anchor ? offset(anchor) : 0
    report.readingStream = !!anchor?.closest('.abele-ai-chat__streaming-content')
    await capture('handoff-reading')
    begin('complete while reading')
    finishInitial = true
    await initialTurn
    await wait(300)
    const latest = session.messages.value.at(-1)?.id
    row.destination = !!latest && !!item(latest)
    const replacement = [...box().querySelectorAll('.abele-markdown > *')].find(e => text && e.textContent.startsWith(text))
    row.drift = replacement ? Math.abs(offset(replacement) - at) : 9999
    report.keptReading = box().scrollHeight - box().scrollTop - box().clientHeight > 20
    await capture('handoff-completed')
` +
    full.slice(cleanup)
  ).replace("'-frames.json'", "'-handoff-frames.json'")
}
/** Returning to the tail must follow later line wraps, not merely reach today's end. */
export function followScript(phone: boolean): string {
  const full = script('long', 'text', phone)
  const reading = full.indexOf("    begin('one screen up')")
  const cleanup = full.indexOf('  } catch (e) { report.error')
  if (reading < 0 || cleanup < reading) throw new Error('Matrix phase boundaries changed')
  return (
    full.slice(0, reading) +
    `
    begin('resume with new lines')
    for (let n = 0; n < 100 && item(tail); n++)
      await gesture(-box().clientHeight * (phone ? 0.4 : 0.6), 3)
    report.evicted = !item(tail)
    await down(true)
    const beforeHeight = box().scrollHeight
    const paragraphs = () => session.streamingContent.value.split(String.fromCharCode(10, 10)).length
    const beforeParagraphs = paragraphs()
    await until(() => paragraphs() > beforeParagraphs && box().scrollHeight > beforeHeight)
    await wait(200)
    row.heightGain = box().scrollHeight - beforeHeight
    row.bottomGap = box().scrollHeight - box().scrollTop - box().clientHeight
    await capture('resumed-following')
` +
    full.slice(cleanup)
  )
}

interface Row {
  heightGain?: number
  move: string
  samples: number
  drift: number | null
  blank: number
  bottomGap: number | null
  destination: boolean | null
  reversals: number
  requested: number
  moved: number
  lost: number
  rawReversals: number
  rebases: number
  gestures?: { receivedInputs: number }[]
}
export interface Report {
  maxInputFrameMs: number
  idleLongTasks?: number[]
  error?: string
  rows: Row[]
  streamMs: number
  evicted: boolean
  initialPages: number
  fullWindow?: boolean
  readingStream?: boolean
  keptReading?: boolean
}

// A scripted SSE provider and an inert, controllable tool exercise the ordinary session path.
// Neither model credentials nor a real tool executor are used.
export const script = (size: string, state: string, phone: boolean, idleMs = 0) => `(async () => {
  const size = ${JSON.stringify(size)}, state = ${JSON.stringify(state)}, phone = ${phone}
  // Hundreds of native gestures include deliberate settle waits; this is a harness
  // budget, independent of the pixel and direction invariants checked below.
  const deadline = Date.now() + ${phone && size === 'long' && state === 'text' ? 360000 : 270000}
  const wait = async ms => {
    if (Date.now() > deadline) throw Error('Matrix case exceeded its input budget')
    await new Promise(r => setTimeout(r, ms))
    if (Date.now() > deadline) throw Error('Matrix case exceeded its input budget')
  }
  const chats = window.__abeleTest.ChatService.getInstance()
  const path = 'sample-scroll-matrix-' + crypto.randomUUID() + '.abchat'
  const tabs = [...chats.tabOrder.value], active = chats.activeTabId.value
  const realFetch = window.fetch
  const report = { rows: [], streamMs: 0, evicted: false, initialPages: 0, maxInputFrameMs: 0 }
  let previousInputFrame
  const box = () => [...document.querySelectorAll('.abele-ai-chat__messages')].find(e => e.getClientRects().length)
  const item = id => box()?.querySelector('[data-message-id="' + id + '"]')
  const until = async fn => {
    for (let n = 0; n < 400; n++) {
      if (session?.error.value) throw Error(session.error.value)
      if (fn()) return
      await wait(30)
    }
    throw Error('Condition timed out: ' + fn.toString())
  }
  const wc = require('@electron/remote').getCurrentWebContents()
  const debuggerApi = wc.debugger
  const attached = debuggerApi.isAttached()
  const cdp = (method, params) => debuggerApi.sendCommand(method, params)
  const capture = async phase => {
    if (size !== 'long') return
    const image = await wc.capturePage()
    require('fs').writeFileSync(${JSON.stringify(shots + '/')} + (phone ? 'touch-' : 'wheel-') + size + '-' + state + '-' + phase + '.png', image.toPNG())
  }
  let file, session, initialTurn, finishTool, frame, row, previous, previousAnchor, previousOffset, direction = 0, pendingDirection = 0
  let providerPhase = 'initial', finishInitial = false, requests = 0
  let streamingAt = 0, stop = false, touchDown = false, buttonDown = false, keyDown = false
  const records = []
  const trace = []
  let dragTrace, dragCompletion
  let receivedInputs = 0
  let deliveredDelta = 0, touchY = null
  let measureInputStart, measureFollowingOrigin, measureWheelReceipt, gestureActive = false, boundaryGeometry = null
  const nativeInput = event => {
    if (!box()?.contains(event.target)) return
    measureWheelReceipt?.(event); measureWheelReceipt = null
    measureFollowingOrigin = null
    if (measureInputStart) { measureInputStart(); measureInputStart = null }
    const nextY = (event.touches?.[0] || event.changedTouches?.[0])?.clientY
    if (event.type === 'touchstart') {
      touchY = nextY
      trace.push({ at: performance.now(), move: row?.move, input: event.type, y: nextY, scrollTop: box().scrollTop })
      return
    }
    if (event.type === 'wheel') deliveredDelta += event.deltaY
    else if (touchY !== null && nextY !== undefined) {
      deliveredDelta += touchY - nextY
      touchY = nextY
    }
    if (event.type === 'touchend') {
      trace.push({ at: performance.now(), move: row?.move, input: event.type, y: nextY, scrollTop: box().scrollTop })
      return
    }
    receivedInputs++
    if (!direction) {
      previous = box().scrollTop
      previousAnchor = visibleAnchor()
      previousOffset = previousAnchor ? offset(previousAnchor) : null
    }
    direction = pendingDirection
    trace.push({ at: performance.now(), move: row?.move, input: event.type, direction, y: nextY,
      deltaY: event.deltaY, scrollTop: box().scrollTop })
  }
  const count = size === 'long' ? 360 : size === 'medium' ? 4 : 2
  for (let i = 0; i < count; i++) {
    const tool = i > 0 && i % 4 === 0
    const text = size !== 'long' ? 'Sample.' : i % 11 === 0 ? '' : i % 7 === 0 ? 'Yes.' :
      'Sample garden paragraph ' + i + '. ' + 'Leave room for plants beside the path. '.repeat(3) +
      (i % 9 === 0 ? '\\n\\n' + String.fromCharCode(96).repeat(3) + 'js\\n' +
        'const sample = 1;\\n'.repeat(24) + String.fromCharCode(96).repeat(3) : '')
    records.push({ k: 'msg', id: 'm' + i, parentId: i ? 'm' + (i - 1) : undefined,
      role: tool ? 'tool-call' : i % 2 ? 'assistant' : 'user', content: tool ? '' : text,
      ...(tool ? { toolName: 'read', toolParams: { path: 'Samples/sample-' + i + '.md' },
        toolResult: 'Sample output.\\n'.repeat(i % 3 ? 1 : 60), toolStatus: 'approved' } : {}),
      timestamp: 1700000000000 + i * 1000 })
  }
  let tail = 'tail-tool'
  records.push({ k: 'msg', id: tail, parentId: 'm' + (count - 1), role: 'tool-call', content: '',
    toolName: 'read', toolParams: { path: 'Samples/tail.md' }, toolResult: 'Tail sample output.\\n'.repeat(80),
    toolStatus: 'approved', timestamp: 1700000400000 })
  const visibleAnchor = () => (${visibleChatAnchor.toString()})(box())
  const offset = e => e.getBoundingClientRect().top - box().getBoundingClientRect().top
  const sample = () => {
    if (stop) return
    const now = performance.now()
    if (gestureActive && previousInputFrame !== undefined)
      report.maxInputFrameMs = Math.max(report.maxInputFrameMs, now - previousInputFrame)
    previousInputFrame = gestureActive ? now : undefined
    const el = box()
    if (el && row) {
      measureFollowingOrigin?.()
      const viewport = el.getBoundingClientRect()
      trace.push({ at: performance.now(), frameAt: now, gestureActive, move: row.move, scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight, direction, anchorOffset: previousAnchor?.isConnected ? offset(previousAnchor) : null })
      // Queued sends and status rows are rendered content too. Measuring only message
      // IDs misreported the visible queued-send row as a 33 px empty region.
      const blocks = [...el.children]
        .filter(e => e.getClientRects().length && e.getBoundingClientRect().height > 0)
      const end = Math.max(viewport.top, ...blocks.map(e => e.getBoundingClientRect().bottom))
      const padding = parseFloat(getComputedStyle(el).paddingBottom) || 0
      const margin = blocks.length ? parseFloat(getComputedStyle(blocks.at(-1)).marginBottom) || 0 : 0
      if (el.scrollHeight > el.clientHeight + 2) {
        const gap = viewport.top + el.clientTop + el.clientHeight - padding - margin - end
        if (gap > row.blank) {
          row.blank = gap
          row.blankGeometry = { top: viewport.top, bottom: viewport.bottom, clientHeight: el.clientHeight,
            clientTop: el.clientTop, height: viewport.height, padding, end, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight,
            lastMargin: blocks.length ? getComputedStyle(blocks.at(-1)).marginBottom : null,
            children: blocks.map(e => ({ className: e.className, bottom: e.getBoundingClientRect().bottom })) }
        }
      }
      if (gestureActive && pendingDirection > 0 && item(session.messages.value.at(-1)?.id) &&
        el.scrollHeight - el.scrollTop - el.clientHeight < 2)
        boundaryGeometry ||= { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }
      if (direction && previous !== undefined && direction * (el.scrollTop - previous) < -1) row.rawReversals++
      // Page eviction changes scrollTop's origin. Measure visible direction against a common
      // element as well, so a coordinate rebase cannot masquerade as a visual reversal.
      if (direction && previousAnchor) {
        if (previousAnchor.isConnected) {
          if (direction * (previousOffset - offset(previousAnchor)) < -1) row.reversals++
        } else row.rebases++
      }
      previous = el.scrollTop
      previousAnchor = visibleAnchor()
      previousOffset = previousAnchor ? offset(previousAnchor) : null
      row.samples++
    }
    frame = requestAnimationFrame(sample)
  }
  const begin = move => {
    direction = 0; previous = undefined; previousAnchor = null
    row = { move, samples: 0, drift: null, blank: 0, bottomGap: null,
      destination: null, reversals: 0, rawReversals: 0, rebases: 0, requested: 0, moved: 0, lost: 0 }
    report.rows.push(row)
  }
  const gesture = async (dy, steps = 12, fast = false) => {
    const el = box(), rect = el.getBoundingClientRect()
    // The chat gutter avoids scrolling a code/output block's own nested viewport instead.
    const x = rect.left + 8, y = rect.top + rect.height / 2
    const sign = Math.sign(dy)
    const beforeInputs = receivedInputs
    deliveredDelta = 0; touchY = null
    pendingDirection = sign
    // CDP delivery is asynchronous. Following before the first DOM input arrives
    // is not a reversal of that input; the receiver marks the gesture's start.
    direction = 0
    let before, first, olderHeight, anchor, at, room, endAtStart
    const measure = () => {
      before = el.scrollTop
      first = el.querySelector('[data-message-id]')?.dataset.messageId
      olderHeight = el.querySelector('.abele-ai-chat__older')?.getBoundingClientRect().height || 0
      anchor = visibleAnchor(); at = anchor ? offset(anchor) : null
      room = dy < 0 ? before : el.scrollHeight - el.clientHeight - before
      endAtStart = !!item(session.messages.value.at(-1)?.id)
    }
    measure()
    // Distance available in the requested direction is not the distance to the
    // live end: an upward gesture starting at the bottom has a large room value.
    const followingAtStart = endAtStart && el.scrollHeight - el.scrollTop - el.clientHeight < 2
    // Streaming can follow between the CDP request and DOM receipt. That movement
    // predates the reader's input and must not be charged against its travel.
    measureInputStart = ${phone ? 'measure' : 'null'}
    let originHeight = el.scrollHeight
    const originUpdates = []
    measureWheelReceipt = ${
      phone
        ? 'null'
        : `followingAtStart ? event => {
      if (event.type !== 'wheel' || !anchor?.isConnected) return
      const growth = el.scrollHeight - originHeight
      const shift = at - offset(anchor) - event.deltaY
      if (growth > 0 && shift > 0 && Math.abs(growth - shift) < 2) {
        originUpdates.push({ source: 'wheel receipt', shift, growth, deltaY: event.deltaY })
        before += shift; at -= shift
        if (dy < 0) room = before
      }
    } : null`
    }
    measureFollowingOrigin = ${
      phone
        ? 'null'
        : `followingAtStart ? () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight
      if (gap < 2 && el.scrollHeight > originHeight && anchor?.isConnected) {
        originUpdates.push({ before, after: el.scrollTop, heightBefore: originHeight, heightAfter: el.scrollHeight, gap })
        before = el.scrollTop; at = offset(anchor); room = dy < 0 ? before : gap; originHeight = el.scrollHeight
      }
    } : null`
    }
    boundaryGeometry = null; gestureActive = true
    if (phone) {
      const touchSteps = fast ? 12 : steps
      await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      touchDown = true
      for (let n = 1; n <= touchSteps; n++) {
        await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - dy * n / touchSteps }] })
        await wait(24)
      }
      await wait(120)
      await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      touchDown = false
    } else {
      for (let n = 0; n < steps; n++) {
        await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy / steps })
        await wait(24)
      }
    }
    await wait(100)
    gestureActive = false; measureInputStart = null; measureFollowingOrigin = null; measureWheelReceipt = null
    let moved = sign * (el.scrollTop - before)
    if (anchor?.isConnected && at !== null) moved = sign * (at - offset(anchor))
    const coveredInitialEnd = dy > 0 && endAtStart &&
      room < Math.abs(dy) && moved >= room - 2
    const globalBoundary = dy < 0 ? !!item('m0') && el.scrollTop < 1 :
      coveredInitialEnd || !!boundaryGeometry || (!!item(session.messages.value.at(-1)?.id) && el.scrollHeight - el.scrollTop - el.clientHeight < 2)
    ;(row.gestures ||= []).push({ dy, fast, room, before, after: el.scrollTop, globalBoundary,
      boundaryGeometry,
      originUpdates,
      coveredInitialEnd,
      receivedInputs: receivedInputs - beforeInputs,
      deliveredDelta,
      anchorBefore: at, anchorAfter: anchor?.isConnected ? offset(anchor) : null,
      firstBefore: first, firstAfter: el.querySelector('[data-message-id]')?.dataset.messageId,
      olderHeightBefore: olderHeight, olderHeightAfter: el.querySelector('.abele-ai-chat__older')?.getBoundingClientRect().height || 0 })
    row.moved += sign * (el.scrollTop - before)
    row.requested += Math.abs(dy)
    if (anchor?.isConnected && at !== null) {
      // Only the actual conversation boundary can consume unused input. A virtual
      // page edge must load the next page rather than discard the gesture's remainder.
      if (!globalBoundary) row.lost = Math.max(row.lost, Math.abs(dy) - moved)
    }
    direction = 0
    return moved > 1 || first !== el.querySelector('[data-message-id]')?.dataset.messageId
  }
  const hold = async () => {
    const anchor = visibleAnchor()
    if (!anchor) { row.drift = 9999; await wait(60); return }
    const at = offset(anchor)
    row.drift = 0
    for (let n = 0; n < 20; n++) {
      await wait(30)
      row.drift = Math.max(row.drift, anchor.isConnected ? Math.abs(offset(anchor) - at) : 9999)
    }
  }
  const down = async fast => {
    let stalled = 0
    for (let n = 0; n < 180; n++) {
      const el = box()
      if (item(tail) && el.scrollHeight - el.scrollTop - el.clientHeight < 2) break
      const progressed = await gesture(el.clientHeight * (phone ? (fast ? 6 : 0.4) : (fast ? 2 : 0.6)), fast ? 2 : 6, fast)
      stalled = progressed ? 0 : stalled + 1
      if (stalled >= 3) break
    }
    await wait(200)
    const target = item(tail), viewport = box().getBoundingClientRect()
    row.destination = !!target && (!['running-tool', 'finished-tool'].includes(state) ||
      target.getBoundingClientRect().bottom > viewport.top && target.getBoundingClientRect().top < viewport.bottom)
    row.bottomGap = box().scrollHeight - box().scrollTop - box().clientHeight
  }
  try {
    window.addEventListener('wheel', nativeInput, { capture: true, passive: true })
    window.addEventListener('touchmove', nativeInput, { capture: true, passive: true })
    window.addEventListener('touchstart', nativeInput, { capture: true, passive: true })
    window.addEventListener('touchend', nativeInput, { capture: true, passive: true })
    if (!attached) debuggerApi.attach('1.3')
    if (phone) await cdp('Emulation.setTouchEmulationEnabled', { enabled: true })
    if (app.vault.getAbstractFileByPath(path)) throw Error('Sample path occupied')
    file = await app.vault.create(path, [{ v: 2, k: 'meta', type: 'abele-chat', title: 'Sample scroll matrix',
      created: '2023-11-14', activeLeafId: tail }, ...records].map(JSON.stringify).join('\\n') + '\\n')
    if (!chats.canCreateTab) throw Error('No scratch tab available')
    await chats.openChatInTab(chats.createTab(), file)
    session = chats.getSessionByFile(path)
    await chats.revealSidebar({ focus: false })
    await until(() => item(tail))
    document.activeElement?.blur()
    await wait(1600)
    if (size === 'medium') {
      // Give this fixture two viewports in either geometry rather than assuming text wraps alike.
      let repeats = 4
      for (let n = 0; n < 6; n++) {
        session.updateChatMessage(m => m.id === 'm3', m => ({ ...m, content: 'Sample middle paragraph. '.repeat(repeats) }))
        await wait(180)
        const pages = box().scrollHeight / box().clientHeight
        if (pages >= 1.5 && pages <= 2.5) break
        repeats = Math.max(1, Math.round(repeats + (2 * box().clientHeight - box().scrollHeight) / 12))
      }
    }
    report.initialPages = box().scrollHeight / box().clientHeight
    // Use the same travel and speed on an ordinary box at the actual chat geometry.
    // This records browser touch slop separately from any application correction.
    report.nativeControl = JSON.parse(await (${inputProbe(phone)}))
    if (phone) await cdp('Emulation.setTouchEmulationEnabled', { enabled: true })
    const fake = 'https://sample-scroll-provider.invalid/v1'
    session.resolveModel = () => ({ id: 'sample', name: 'Sample', baseUrl: fake, apiKey: 'none', contextWindow: 100000, maxTokens: 1000 })
    session.needsApproval = () => false
    session.interceptor.override.value = []
    session.messageReaders = () => []
    session.checkAnswer = async () => undefined
    session.getTools = () => [{ name: 'sample_scroll_tool', label: 'Sample', description: 'Return synthetic sample output.',
      parameters: { type: 'object', properties: {} },
      execute: async (id, params, signal) => {
        await new Promise((resolve, reject) => {
          finishTool = resolve
          if (signal.aborted) reject(new DOMException('Stopped', 'AbortError'))
          else signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true })
        })
        return { content: [{ type: 'text', text: 'Tail sample output.\\n'.repeat(80) }] }
      } }]
    for (const key of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded'])
      session.summarizer[key] = async () => undefined
    window.fetch = async (url, init) => {
      if (typeof url !== 'string' || !url.startsWith(fake)) return realFetch(url, init)
      const request = ++requests, phase = providerPhase, encoder = new TextEncoder()
      let cancelled = false
      return new Response(new ReadableStream({ async start(controller) {
        const emit = (delta, finish = null) => controller.enqueue(encoder.encode('data: ' +
          JSON.stringify({ choices: [{ delta, finish_reason: finish }] }) + '\\n\\n'))
        if (phase === 'initial' && request === 1 && ['running-tool', 'finished-tool'].includes(state)) {
          emit({ tool_calls: [{ index: 0, id: 'call_matrix', type: 'function', function: { name: 'sample_scroll_tool', arguments: '{}' } }] })
          emit({}, 'tool_calls')
        } else {
          let n = 0
          const toolReply = phase === 'initial' && ['running-tool', 'finished-tool'].includes(state)
          if (toolReply) emit({ content: 'Sample tool result acknowledged.' })
          while (!cancelled && (phase === 'initial' ? !finishInitial : n < 60)) {
            await wait(phase === 'initial' ? 80 : 100)
            if (cancelled) return
            n++
            const words = size === 'short' ? (n <= 240 ? 'Sample leaf. '[(n - 1) % 13] : '') :
              n % 12 ? 'Sample leaf. ' : '\\n\\nSample live paragraph. '
            emit(toolReply ? {} : { content: words })
          }
          if (cancelled) return
          emit({}, 'stop')
        }
        controller.enqueue(encoder.encode('data: [DONE]\\n\\n')); controller.close()
      }, cancel() { cancelled = true } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    const streaming = state !== 'idle'
    if (streaming) {
      streamingAt = performance.now()
      initialTurn = session.sendMessage('Sample matrix question')
      await until(() => session.isStreaming.value)
      if (['running-tool', 'finished-tool'].includes(state)) {
        await until(() => finishTool)
        const call = session.messages.value.find(m => m.toolCallId === 'call_matrix')
        if (!call) throw Error('Synthetic tool call was not added')
        tail = call.id
      }
    }
    begin('following'); sample(); await wait(streaming ? 5200 : 300)
    if (state === 'finished-tool') {
      finishTool()
      await until(() => session.messages.value.find(m => m.id === tail)?.toolResult !== undefined)
      await wait(500)
    }
    if (state === 'finished-reply') {
      finishInitial = true
      await initialTurn
      await wait(500)
    }
    row.bottomGap = box().scrollHeight - box().scrollTop - box().clientHeight
    await capture('following')
    if (${idleMs}) {
      const tasks = [];
      const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(entry => entry.duration)));
      try {
        observer.observe({ type: 'longtask' });
        await wait(${idleMs});
        report.idleLongTasks = tasks;
      } finally { observer.disconnect() }
    }
    begin('one screen up')
    for (let n = 0; n < 3; n++) await gesture(-box().clientHeight * 0.3)
    await hold()
    begin('far up')
    let stalled = 0
    for (let n = 0; n < (size === 'long' ? 100 : 5); n++) {
      if (size === 'long' && !item(tail)) break
      const progressed = await gesture(-box().clientHeight * (phone ? 0.4 : 0.6), 3)
      stalled = progressed ? 0 : stalled + 1
      if (stalled >= 3) break
    }
    report.evicted = !item(tail)
    await hold()
    await capture('reading-history')
    begin('slow return'); await down(false)
    begin('to top')
    stalled = 0
    for (let n = 0; n < 220 && (!item('m0') || box().scrollTop > 2); n++) {
      const progressed = await gesture(-box().clientHeight * (phone ? 6 : 3), 2, true)
      stalled = progressed ? 0 : stalled + 1
      if (stalled >= 3) break
    }
    row.destination = !!item('m0')
    await wait(60)
    begin('fast return'); await down(true)
    await capture('returned')
    for (const expanded of [true, false]) {
      begin(expanded ? 'expanded tail' : 'collapsed tail')
      const run = item(tail)?.closest('.abele-chat-run')
      const toggle = run?.querySelector(':scope > .tree-item-self')
      if (!toggle) { row.destination = false; await wait(60); continue }
      if (toggle.getAttribute('aria-expanded') !== String(expanded)) toggle.click()
      await wait(100)
      if (expanded) {
        const detail = run.querySelector('.abele-chat-msg__icon')
        if (detail?.getAttribute('aria-expanded') === 'false') detail.click()
      }
      await wait(300)
      await gesture(-box().clientHeight * 0.3)
      if (size === 'long') {
        stalled = 0
        for (let n = 0; n < 180 && item(tail); n++) {
          const progressed = await gesture(-box().clientHeight * (phone ? 0.4 : 0.6), 3)
          stalled = progressed ? 0 : stalled + 1
          if (stalled >= 3) break
        }
      }
      const toolEvicted = size !== 'long' || !item(tail)
      await hold()
      await down(true)
      const returnedRun = item(tail)?.closest('.abele-chat-run')
      const returnedToggle = returnedRun?.querySelector(':scope > .tree-item-self')
      const returnedDetail = returnedRun?.querySelector('.abele-chat-msg__icon')
      row.toolState = { expanded: returnedToggle?.getAttribute('aria-expanded'),
        details: returnedDetail?.getAttribute('aria-expanded'),
        text: returnedRun?.textContent.slice(-200) }
      row.destination = row.destination && toolEvicted && returnedToggle?.getAttribute('aria-expanded') === String(expanded) &&
        (!expanded || returnedDetail?.getAttribute('aria-expanded') === 'true')
      await capture(expanded ? 'expanded-returned' : 'collapsed-returned')
    }
    begin('End key')
    box().tabIndex = -1; box().focus({ preventScroll: true })
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
    keyDown = true
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
    keyDown = false
    await wait(500); row.destination = !!item(tail)
    begin('scrollbar drag')
    if (!phone) {
      const el = box(), rect = el.getBoundingClientRect()
      const x = rect.right - 3, y = rect.bottom - 5
      dragTrace = (${traceScrollInput.toString()})(el)
      dragCompletion = (${scrollCompletion.toString()})(el)
      report.dragTrace = dragTrace.events
      dragTrace.pointer('press-target', x, y)
      dragTrace.mark('press-request')
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
      dragTrace.mark('press-ack')
      buttonDown = true
      for (let n = 1; n <= 12; n++) {
        dragTrace.mark('move-request-' + n)
        await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: y - (rect.height - 25) * n / 12, button: 'left', buttons: 1 })
        dragTrace.mark('move-ack-' + n)
        await wait(24)
      }
      dragTrace.mark('release-request')
      dragTrace.pointer('release-target', x, rect.top + 20)
      dragCompletion.releasing()
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: rect.top + 20, button: 'left', clickCount: 1 })
      dragTrace.mark('release-ack')
      buttonDown = false
      await dragCompletion.wait()
      dragCompletion.stop()
    } else await gesture(-box().clientHeight * 0.35)
    dragTrace?.mark('hold-origin')
    await hold()
    dragTrace?.mark('hold-end')
    dragTrace?.stop()
    begin('earlier marker')
    const marker = box().querySelector('.abele-ai-chat__older button')
    if (marker) { marker.click(); await wait(500); await hold() }
    else await wait(100)
    begin('navigation')
    const nav = [...document.querySelectorAll('.abele-ai-chat__navigation')].find(e => e.getClientRects().length)
    if (nav) nav.click()
    else {
      const overflow = [...document.querySelectorAll('.abele-ai-chat__overflow [aria-haspopup="menu"]')].find(e => e.getClientRects().length)
      if (!overflow) throw Error('Navigation action unavailable')
      overflow.click()
      await until(() => [...document.querySelectorAll('.menu-item')].some(e => e.textContent.trim() === 'Outline of this chat'))
      ;[...document.querySelectorAll('.menu-item')].find(e => e.textContent.trim() === 'Outline of this chat').click()
    }
    await until(() => document.querySelector('.abele-chat-outline'))
    const outline = document.querySelector('.abele-chat-outline')
    const dialog = outline.closest('.modal') || outline
    const first = [...dialog.querySelectorAll('button')].find(e => e.textContent.includes('To the start') || e.getAttribute('aria-label')?.includes('To the start'))
    if (!first) throw Error('Navigation has no start action')
    first.click(); await wait(500); await hold()
    row.destination = !!item('m0')
    begin('send while reading history')
    providerPhase = 'followup'
    const composer = window.__abeleTest.composer()
    const input = composer?.field
    if (!input?.getClientRects().length) throw Error('No visible composer')
    const editor = window.__abeleTest.noteFieldView(input)
    if (editor) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: 'Sample follow-up' }, userEvent: 'input.type' })
    else {
      const textarea = input.matches('textarea') ? input : input.querySelector('textarea')
      if (!textarea) throw Error('No composer editor')
      textarea.value = 'Sample follow-up'; textarea.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await wait(50)
    const send = input.closest('.abele-chat-input').querySelector('.abele-chat-input__send')
    if (!send || send.disabled) throw Error('Send action unavailable')
    send.click()
    await until(() => session.isStreaming.value)
    finishTool?.()
    finishInitial = true
    await until(() => !session.isStreaming.value)
    if (session.error.value) throw Error(session.error.value)
    await wait(500)
    row.bottomGap = box().scrollHeight - box().scrollTop - box().clientHeight
  } catch (e) { report.error = String(e?.stack || e) }
  finally {
    window.removeEventListener('wheel', nativeInput, true)
    window.removeEventListener('touchmove', nativeInput, true)
    window.removeEventListener('touchstart', nativeInput, true)
    window.removeEventListener('touchend', nativeInput, true)
    dragTrace?.stop()
    dragCompletion?.stop()
    stop = true; finishInitial = true; finishTool?.(); cancelAnimationFrame(frame)
    require('fs').writeFileSync(${JSON.stringify(shots + '/')} + (phone ? 'touch-' : 'wheel-') + size + '-' + state + '-frames.json', JSON.stringify(trace))
    window.fetch = realFetch
    if (streamingAt) report.streamMs = performance.now() - streamingAt
    if (session) session.abort()
    if (initialTurn) await initialTurn.catch(() => undefined)
    for (const id of [...chats.tabOrder.value]) if (!tabs.includes(id)) await chats.closeTab(id)
    if (active) chats.activeTabId.value = active
    chats.saveTabs()
    if (file && app.vault.getAbstractFileByPath(path)) await app.vault.delete(file)
    if (touchDown) await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    if (buttonDown) await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1, y: 1, button: 'left', clickCount: 1 })
    if (keyDown) await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
    if (phone) await cdp('Emulation.setTouchEmulationEnabled', { enabled: false })
    if (!attached && debuggerApi.isAttached()) debuggerApi.detach()
  }
  return JSON.stringify(report)
})()`
