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
