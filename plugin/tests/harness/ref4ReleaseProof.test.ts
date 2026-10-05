import { describe, expect, it } from 'vitest'
import {
  nativeWebViewFrame,
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
