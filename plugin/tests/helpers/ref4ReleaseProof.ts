export interface RectProof {
  x: number
  y: number
  width: number
  height: number
}
export interface EmbedProof {
  paneId: string
  rect: RectProof
  imageRect: RectProof
  crop: RectProof
  paper: string
  dpr: number
  bitmapBytes: number
}

/** Never compare raw ink area after changing its coordinate system. */
export function requireSameEmbedGeometry(before: EmbedProof, after: EmbedProof): void {
  for (const key of [
    'paneId',
    'rect',
    'imageRect',
    'crop',
    'paper',
    'dpr',
    'bitmapBytes',
  ] as const) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      throw new Error(`drawing comparison geometry changed: ${key}`)
  }
}

/** An editor fence is not a save or render-completion signal. */
export function requireSnippetPrerequisites(proof: {
  fenceReady: boolean
  editor: string
  saved: string
  parsed: { text: string; start?: number } | null
  mode: string
  visible: boolean
  code: string
  start: number
}): void {
  if (!proof.fenceReady || !proof.editor.includes('```abele-github'))
    throw new Error('snippet fence insertion did not complete')
  if (proof.saved !== proof.editor) throw new Error('snippet editor content was not saved')
  if (!proof.parsed || proof.parsed.text !== proof.code || proof.parsed.start !== proof.start)
    throw new Error('saved snippet did not parse as the selected code')
  if (proof.mode !== 'preview' || !proof.visible)
    throw new Error('intended snippet reading container is not visible')
}

export interface SelectionPointProof {
  owner: string
  expectedOwner: string
  path: string
  expectedPath: string
  ready: boolean
  signature: string
  liveSignature: string
  caretHit: boolean
  rootHit: boolean
  initialSelection: string
  obstructed: boolean
  local: { x: number; y: number }
  css: { x: number; y: number }
  iframe: RectProof
  border: { x: number; y: number }
  scale: { x: number; y: number }
  viewport: { width: number; height: number }
  visual: { width: number; height: number; offsetLeft: number; offsetTop: number }
  nativeFrame: RectProof
  transform?: string
}

export function requireSelectionPoint(p: SelectionPointProof): { x: number; y: number } {
  if (!p.ready || p.owner !== p.expectedOwner || p.path !== p.expectedPath)
    throw new Error('wrong or unready native-selection owner')
  if (p.signature !== p.liveSignature) throw new Error('native-selection geometry is stale')
  if (!p.caretHit || !p.rootHit || p.initialSelection.trim() || p.obstructed)
    throw new Error('chosen native-selection word is not an unobstructed hit')
  if (p.transform !== undefined && p.transform !== 'none')
    throw new Error('unsupported native-selection iframe transform')
  const nums = [
    p.local.x,
    p.local.y,
    p.css.x,
    p.css.y,
    p.iframe.x,
    p.iframe.y,
    p.iframe.width,
    p.iframe.height,
    p.border.x,
    p.border.y,
    p.scale.x,
    p.scale.y,
    p.viewport.width,
    p.viewport.height,
    p.visual.width,
    p.visual.height,
    p.visual.offsetLeft,
    p.visual.offsetTop,
    p.nativeFrame.x,
    p.nativeFrame.y,
    p.nativeFrame.width,
    p.nativeFrame.height,
  ]
  if (
    !nums.every(Number.isFinite) ||
    p.scale.x <= 0 ||
    p.scale.y <= 0 ||
    p.visual.width <= 0 ||
    p.visual.height <= 0 ||
    p.nativeFrame.width <= 0 ||
    p.nativeFrame.height <= 0
  )
    throw new Error('invalid native-selection frame')
  if (
    p.local.x < 0 ||
    p.local.y < 0 ||
    (p.border.x + p.local.x) * p.scale.x >= p.iframe.width ||
    (p.border.y + p.local.y) * p.scale.y >= p.iframe.height
  )
    throw new Error('native-selection point is outside the measured iframe')
  const x = p.iframe.x + (p.border.x + p.local.x) * p.scale.x
  const y = p.iframe.y + (p.border.y + p.local.y) * p.scale.y
  if (x !== p.css.x || y !== p.css.y) throw new Error('incorrect iframe-to-CSS point')
  if (
    x < 0 ||
    y < 0 ||
    x >= p.viewport.width ||
    y >= p.viewport.height ||
    x < p.visual.offsetLeft ||
    y < p.visual.offsetTop ||
    x >= p.visual.offsetLeft + p.visual.width ||
    y >= p.visual.offsetTop + p.visual.height
  )
    throw new Error('native-selection point is offscreen')
  return {
    x: p.nativeFrame.x + ((x - p.visual.offsetLeft) * p.nativeFrame.width) / p.visual.width,
    y: p.nativeFrame.y + ((y - p.visual.offsetTop) * p.nativeFrame.height) / p.visual.height,
  }
}

/** XCTest debugDescription is read-only; ambiguous WebView owners must not be guessed. */
export function nativeWebViewFrame(source: string): RectProof {
  const matches = [
    ...source.matchAll(
      /WebView[^\n]*?\{\{(-?[\d.]+),\s*(-?[\d.]+)\},\s*\{([\d.]+),\s*([\d.]+)\}\}/g
    ),
  ]
  const frames = [
    ...new Set(
      matches.map((m) =>
        JSON.stringify({
          x: Number(m[1]),
          y: Number(m[2]),
          width: Number(m[3]),
          height: Number(m[4]),
        })
      )
    ),
  ].map((s) => JSON.parse(s) as RectProof)
  if (frames.length !== 1) throw new Error('native WebView frame is absent or ambiguous')
  return frames[0]
}

export interface SelectionReaderOwner {
  id: string
  view: {
    file?: { path: string }
    model: { status: string }
    reading?: object
    engine: { renderer: HTMLElement & { getContents(): { doc: Document }[] } }
    containerEl: HTMLElement
  }
}
export interface SelectionCapture {
  leaf: SelectionReaderOwner
  expectedPath: string
  view: SelectionReaderOwner['view']
  session: object
  engine: SelectionReaderOwner['view']['engine']
  renderer: SelectionReaderOwner['view']['engine']['renderer']
  doc: Document
  frame: HTMLIFrameElement
  frameWindow: Window
  text: Text
  paragraph: HTMLElement
  word: string
  start: number
  end: number
  local: { x: number; y: number }
  css: { x: number; y: number }
}
export interface LiveSelectionObservation {
  owner: string
  path: string
  ready: boolean
  initialSelection: string
  caretHit: boolean
  rootHit: boolean
  obstructed: boolean
  signature: string
  identities: Record<
    'leaf' | 'view' | 'session' | 'engine' | 'renderer' | 'document' | 'frame' | 'window' | 'word',
    boolean
  >
  wordRect: RectProof | null
  notices: { rect: RectProof; intersects: boolean }[]
}

/** Self-contained: this exact function runs in the app and in caller fault tests. */
export function observeSelectionDelivery(
  captured: SelectionCapture,
  active: SelectionReaderOwner | undefined,
  root: Window
): LiveSelectionObservation {
  const view = captured.leaf.view
  const renderer = view.engine.renderer
  const doc = renderer.getContents()[0]?.doc
  const win = doc?.defaultView
  const frame = win?.frameElement as HTMLIFrameElement | null
  if (!doc || !win || !frame) throw new Error('current reader document/frame unavailable')
  const rect = (r: DOMRect): RectProof => ({ x: r.x, y: r.y, width: r.width, height: r.height })
  const box = frame.getBoundingClientRect(),
    vv = root.visualViewport
  if (!vv) throw new Error('current visual viewport unavailable')
  const geometry = {
    iframe: rect(box),
    border: { x: frame.clientLeft, y: frame.clientTop },
    scale: { x: box.width / frame.offsetWidth, y: box.height / frame.offsetHeight },
    viewport: { width: root.innerWidth, height: root.innerHeight },
    visual: {
      width: vv.width,
      height: vv.height,
      offsetLeft: vv.offsetLeft,
      offsetTop: vv.offsetTop,
    },
    visualScale: vv.scale,
    transform: root.getComputedStyle(frame).transform,
    reader: rect(renderer.getBoundingClientRect()),
  }
  const wordSame =
    doc === captured.doc &&
    doc.contains(captured.text) &&
    captured.text.parentElement === captured.paragraph &&
    captured.text.data.slice(captured.start, captured.end) === captured.word
  let wordRect: RectProof | null = null
  if (wordSame) {
    const range = doc.createRange()
    range.setStart(captured.text, captured.start)
    range.setEnd(captured.text, captured.end)
    const boxes = range.getClientRects()
    if (boxes.length === 1) wordRect = rect(boxes[0])
  }
  const caret = doc.caretRangeFromPoint(captured.local.x, captured.local.y)
  const hit = root.document.elementFromPoint(captured.css.x, captured.css.y)
  let rootHit = hit === (view.engine as unknown) || hit === renderer || hit === frame
  let node: Element = frame
  for (;;) {
    const host = (node.getRootNode() as ShadowRoot).host
    if (!host) break
    rootHit ||= hit === host
    node = host
  }
  const notices = [...root.document.querySelectorAll('.notice')].map((el) => {
    const r = el.getBoundingClientRect()
    return {
      rect: rect(r),
      intersects:
        captured.css.x >= r.left &&
        captured.css.x <= r.right &&
        captured.css.y >= r.top &&
        captured.css.y <= r.bottom,
    }
  })
  return {
    owner: active?.id ?? '',
    // Observe exact equality without exporting an unexpected foreign path or selected text.
    path:
      active?.view.file?.path === captured.expectedPath
        ? captured.expectedPath
        : '<different-path>',
    ready:
      active === captured.leaf &&
      view.model.status === 'ready' &&
      !!view.reading &&
      view.containerEl.isConnected &&
      frame.isConnected,
    initialSelection: String(doc.getSelection()).trim() ? '[nonempty]' : '',
    caretHit:
      !!caret &&
      caret.startContainer === captured.text &&
      caret.startOffset >= captured.start &&
      caret.startOffset <= captured.end,
    rootHit: !!hit && rootHit,
    obstructed: notices.some((n) => n.intersects),
    signature: JSON.stringify(geometry),
    identities: {
      leaf: active === captured.leaf,
      view: view === captured.view,
      session: view.reading === captured.session,
      engine: view.engine === captured.engine,
      renderer: renderer === captured.renderer,
      document: doc === captured.doc,
      frame: frame === captured.frame,
      window: win === captured.frameWindow,
      word: wordSame,
    },
    wordRect,
    notices,
  }
}

/** The actual E2E delivery caller. The live observation is last, never a cached flag bundle. */
export async function dispatchSelectionHold(
  captured: SelectionPointProof & { wordRect: RectProof },
  observe: () => Promise<LiveSelectionObservation>,
  hold: (point: { x: number; y: number }, live: LiveSelectionObservation) => void
): Promise<void> {
  const live = await observe()
  const identityKeys = [
    'leaf',
    'view',
    'session',
    'engine',
    'renderer',
    'document',
    'frame',
    'window',
    'word',
  ] as const
  if (!live.identities || identityKeys.some((key) => live.identities[key] !== true))
    throw new Error('native-selection captured owner/session/document/word identity changed')
  if (JSON.stringify(live.wordRect) !== JSON.stringify(captured.wordRect))
    throw new Error('native-selection measured word moved')
  const point = requireSelectionPoint({
    ...captured,
    owner: live.owner,
    path: live.path,
    ready: live.ready,
    initialSelection: live.initialSelection,
    caretHit: live.caretHit,
    rootHit: live.rootHit,
    obstructed: live.obstructed,
    liveSignature: live.signature,
  })
  hold(point, live)
}

/** A separately measured public cleanup control, not a fabricated word-selection proof. */
export function nativeCleanupPoint(
  css: { x: number; y: number },
  visual: SelectionPointProof['visual'],
  frame: RectProof
): { x: number; y: number } {
  if (
    ![
      css.x,
      css.y,
      visual.width,
      visual.height,
      visual.offsetLeft,
      visual.offsetTop,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
    ].every(Number.isFinite) ||
    visual.width <= 0 ||
    visual.height <= 0 ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    css.x < visual.offsetLeft ||
    css.y < visual.offsetTop ||
    css.x >= visual.offsetLeft + visual.width ||
    css.y >= visual.offsetTop + visual.height
  )
    throw new Error('public selection-cleanup point is outside the measured viewport')
  return {
    x: frame.x + ((css.x - visual.offsetLeft) * frame.width) / visual.width,
    y: frame.y + ((css.y - visual.offsetTop) * frame.height) / visual.height,
  }
}
