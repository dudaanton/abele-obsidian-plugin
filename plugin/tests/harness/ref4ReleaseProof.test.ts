import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  nativeWebViewFrame,
  observeSelectionDelivery,
  dispatchSelectionHold,
  type SelectionCapture,
  type SelectionReaderOwner,
  requireSameEmbedGeometry,
  requireSelectionPoint,
  requireSnippetPrerequisites,
  type SelectionPointProof,
} from '../helpers/ref4ReleaseProof'

const rect = { x: 10, y: 20, width: 350, height: 320 }
const embed = {
  paneId: 'sample-pane',
  rect,
  imageRect: rect,
  crop: rect,
  paper: '34 94 352 322',
  dpr: 2,
  bitmapBytes: 1792000,
}
const point = (): SelectionPointProof => ({
  owner: 'sample-reader',
  expectedOwner: 'sample-reader',
  path: 'sample.epub',
  expectedPath: 'sample.epub',
  ready: true,
  signature: 'sample-geometry',
  liveSignature: 'sample-geometry',
  caretHit: true,
  rootHit: true,
  initialSelection: '',
  obstructed: false,
  local: { x: 200, y: 80 },
  css: { x: 214, y: 207 },
  iframe: { x: 14, y: 127, width: 600, height: 500 },
  border: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  viewport: { width: 393, height: 852 },
  visual: { width: 393, height: 852, offsetLeft: 0, offsetTop: 0 },
  nativeFrame: { x: 0, y: 0, width: 393, height: 852 },
})

describe('release proof fault guards', () => {
  it('accepts identical embed geometry and rejects the old narrowed-pane comparison', () => {
    expect(() => requireSameEmbedGeometry(embed, { ...embed })).not.toThrow()
    for (const fault of [
      { rect: { ...rect, width: 175 } },
      { imageRect: { ...rect, width: 175 } },
      { crop: { ...rect, width: 175 } },
      { paper: '0 0 700 600' },
      { dpr: 1 },
      { paneId: 'different-pane' },
    ])
      expect(() => requireSameEmbedGeometry(embed, { ...embed, ...fault })).toThrow(
        /geometry changed/
      )
  })
  it('rejects a missing fence, unsaved editor, malformed selection or hidden preview', () => {
    const proof = {
      fenceReady: true,
      editor: '```abele-github\nselected sample\n```',
      saved: '```abele-github\nselected sample\n```',
      parsed: { text: 'selected sample', start: 5 },
      mode: 'preview',
      visible: true,
      code: 'selected sample',
      start: 5,
    }
    expect(() => requireSnippetPrerequisites(proof)).not.toThrow()
    expect(() => requireSnippetPrerequisites({ ...proof, fenceReady: false })).toThrow(/insertion/)
    expect(() => requireSnippetPrerequisites({ ...proof, saved: '# Initial' })).toThrow(/not saved/)
    expect(() => requireSnippetPrerequisites({ ...proof, parsed: null })).toThrow(/parse/)
    expect(() => requireSnippetPrerequisites({ ...proof, visible: false })).toThrow(/not visible/)
  })
  it('rejects stale, offscreen, wrong-owner and incorrectly mapped native points', () => {
    expect(requireSelectionPoint(point())).toEqual({ x: 214, y: 207 })
    for (const fault of [
      { owner: 'different-reader' },
      { ready: false },
      { liveSignature: 'changed' },
      { css: { x: -1, y: 207 } },
      { iframe: { ...point().iframe, x: -300 }, css: { x: -100, y: 207 } },
      { caretHit: false },
      { rootHit: false },
      { obstructed: true },
      { initialSelection: 'previous word' },
    ])
      expect(() => requireSelectionPoint({ ...point(), ...fault })).toThrow()
  })
  it('reads one measured native webview, not an absent or ambiguous guessed frame', () => {
    expect(nativeWebViewFrame('WebView, {{0.0, 0.0}, {393.0, 852.0}}')).toEqual({
      x: 0,
      y: 0,
      width: 393,
      height: 852,
    })
    expect(() => nativeWebViewFrame('Application only')).toThrow(/absent/)
    expect(() =>
      nativeWebViewFrame('WebView, {{0, 0}, {393, 852}}\nWebView, {{10, 20}, {200, 400}}')
    ).toThrow(/ambiguous/)
  })
})

/** The actual browser observer + E2E dispatch caller, not edited flags fed to a formula. */
function callerFixture() {
  const container = document.createElement('div'),
    frame = document.createElement('iframe')
  container.append(frame)
  document.body.append(container)
  const doc = frame.contentDocument!,
    paragraph = doc.createElement('p')
  // happy-dom does not expose the native frameElement relationship.
  Object.defineProperty(doc, 'defaultView', { value: { frameElement: frame }, configurable: true })
  paragraph.textContent = 'sample word'
  doc.body.append(paragraph)
  const text = paragraph.firstChild as Text
  const frameRect = new DOMRect(14, 127, 600, 500),
    wordRect = new DOMRect(180, 70, 40, 20)
  vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(frameRect)
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 111, 393, 611))
  Object.defineProperties(frame, { offsetWidth: { value: 600 }, offsetHeight: { value: 500 } })
  vi.spyOn(doc, 'createRange').mockReturnValue({
    setStart() {},
    setEnd() {},
    getClientRects: () => [wordRect],
  } as unknown as Range)
  Object.defineProperty(doc, 'caretRangeFromPoint', {
    value: () => ({ startContainer: text, startOffset: 3 }),
  })
  let selection = '',
    currentDoc = doc
  vi.spyOn(doc, 'getSelection').mockImplementation(
    () => ({ toString: () => selection }) as Selection
  )
  const renderer = Object.assign(container, { getContents: () => [{ doc: currentDoc }] })
  const leaf: SelectionReaderOwner = {
    id: 'sample-reader',
    view: {
      file: { path: 'sample.epub' },
      model: { status: 'ready' },
      reading: {},
      engine: { renderer },
      containerEl: container,
    },
  }
  let active = leaf,
    rootHit: Element = container
  vi.spyOn(document, 'elementFromPoint').mockImplementation(() => rootHit)
  const root = {
    document,
    innerWidth: 393,
    innerHeight: 852,
    visualViewport: { width: 393, height: 852, offsetLeft: 0, offsetTop: 0, scale: 1 },
    getComputedStyle: () => ({ transform: 'none' }),
  } as unknown as Window
  const capture: SelectionCapture = {
    leaf,
    expectedPath: 'sample.epub',
    view: leaf.view,
    session: leaf.view.reading!,
    engine: leaf.view.engine,
    renderer,
    doc,
    frame,
    frameWindow: doc.defaultView!,
    text,
    paragraph,
    word: 'sample',
    start: 0,
    end: 6,
    local: { x: 200, y: 80 },
    css: { x: 214, y: 207 },
  }
  // Exercise the same serialized browser function + JSON boundary the E2E caller uses.
  const browserObserve = new Function(
    'return (' + observeSelectionDelivery.toString() + ')'
  )() as typeof observeSelectionDelivery
  const observe = async () =>
    JSON.parse(JSON.stringify(browserObserve(capture, active, root))) as ReturnType<
      typeof observeSelectionDelivery
    >
  const first = browserObserve(capture, active, root)
  const captured = { ...point(), signature: first.signature, wordRect: first.wordRect! }
  const faults: Record<string, () => void> = {
    owner: () => {
      active = { ...leaf, id: 'other-reader' }
    },
    readiness: () => {
      leaf.view.model.status = 'loading'
    },
    path: () => {
      leaf.view.file = { path: 'other-sample.epub' }
    },
    window: () => {
      Object.defineProperty(doc, 'defaultView', {
        value: { frameElement: frame },
        configurable: true,
      })
    },
    frame: () => {
      const replacement = document.createElement('iframe')
      container.append(replacement)
      vi.spyOn(replacement, 'getBoundingClientRect').mockReturnValue(frameRect)
      Object.defineProperties(replacement, {
        offsetWidth: { value: 600 },
        offsetHeight: { value: 500 },
      })
      Object.defineProperty(doc, 'defaultView', {
        value: { ...doc.defaultView, frameElement: replacement },
        configurable: true,
      })
    },
    obstruction: () => {
      const notice = document.createElement('div')
      notice.className = 'notice'
      container.parentElement!.append(notice)
      vi.spyOn(notice, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 200, 30, 30))
      rootHit = notice
    },
    selection: () => {
      selection = 'previous sample'
    },
    document: () => {
      const replacement = document.implementation.createHTMLDocument('sample replacement')
      Object.defineProperty(replacement, 'defaultView', { value: doc.defaultView })
      Object.defineProperty(replacement, 'caretRangeFromPoint', { value: () => null })
      currentDoc = replacement
    },
    session: () => {
      leaf.view.reading = {}
    },
    word: () => {
      paragraph.replaceChildren(document.createTextNode('sample word'))
    },
    hit: () => {
      rootHit = document.body
    },
  }
  return { captured, observe, faults }
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})
describe('the actual native-selection delivery caller', () => {
  it('observes immediately before dispatch and delivers once for the unchanged owner', async () => {
    const f = callerFixture(),
      hold = vi.fn()
    await dispatchSelectionHold(f.captured, f.observe, hold)
    expect(hold).toHaveBeenCalledTimes(1)
  })
  it.each([
    'owner',
    'readiness',
    'path',
    'window',
    'frame',
    'obstruction',
    'selection',
    'document',
    'session',
    'word',
    'hit',
  ])('rejects changed live %s with identical geometry and no dispatch', async (fault) => {
    const f = callerFixture(),
      hold = vi.fn()
    f.faults[fault]()
    const live = await f.observe()
    expect(live.signature).toBe(f.captured.signature)
    const rejected = await dispatchSelectionHold(f.captured, f.observe, hold).then(
      () => false,
      () => true
    )
    console.log(
      JSON.stringify({
        fault,
        geometryUnchanged: live.signature === f.captured.signature,
        rejected,
        dispatchCount: hold.mock.calls.length,
      })
    )
    expect.soft(rejected).toBe(true)
    expect(hold).not.toHaveBeenCalled()
  })
})
