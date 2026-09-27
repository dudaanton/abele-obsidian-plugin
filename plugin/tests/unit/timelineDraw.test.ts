/**
 * One frame of the history timeline, painted on a stand-in canvas that only records its text:
 * a label beside a point or a short bar stays on screen, sliding under the edge, while the point
 * itself has already scrolled off to the left.
 */
import { describe, it, expect } from 'vitest'
import { paint, type Frame } from '@/components/timelineBase/timelineDraw'
import { buildScene, DESKTOP } from '@/components/timelineBase/timelineScene'
import { labelWidth, type Palette } from '@/components/timelineBase/timelineText'
import { toTimelineItem, type RawTimelineEntry } from '@/bases/timelineLayout'
import { ticks } from '@/bases/timelineScale'

const OPTS = { approx: 5, now: 2026.7 }
const item = (over: Partial<RawTimelineEntry>) =>
  toTimelineItem(
    {
      path: `${over.title}.md`,
      title: 'x',
      start: null,
      end: null,
      period: null,
      kind: null,
      born: false,
      era: false,
      lane: 0,
      color: null,
      weight: 0,
      cover: null,
      ...over,
    },
    OPTS
  )!

/** A canvas that measures every character 7 px wide and keeps what was written, and where. */
function recordingContext(texts: { text: string; x: number }[]): CanvasRenderingContext2D {
  const noop = () => undefined
  const target: Record<string, unknown> = {
    measureText: (t: string) => ({ width: t.length * 7 }),
    fillText: (text: string, x: number) => texts.push({ text, x }),
    createLinearGradient: () => ({ addColorStop: noop }),
  }
  return new Proxy(target, {
    get: (t, key: string) => (key in t ? t[key] : noop),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D
}

const palette = {
  text: 'rgb(0, 0, 0)',
  muted: 'rgb(0, 0, 0)',
  faint: 'rgb(0, 0, 0)',
  background: 'rgb(255, 255, 255)',
  secondary: 'rgb(255, 255, 255)',
  border: 'rgb(0, 0, 0)',
  accent: 'rgb(0, 0, 255)',
  colors: {} as Palette['colors'],
  font: 'sans-serif',
  small: 13,
  smaller: 12,
  semibold: '600',
} satisfies Palette

function frameAt(t0: number): { texts: { text: string; x: number }[] } {
  const texts: { text: string; x: number }[] = []
  const ctx = recordingContext(texts)
  const ppy = 10
  const battle = item({ title: 'A battle with a long name', start: '1453' })
  const scene = buildScene(
    [battle],
    [{ label: '', color: null, count: 1 }],
    {
      ppy,
      gapPx: 8,
      pointPx: 10,
      minBarPx: 3,
      padPx: 6,
      labelPx: (i) => labelWidth(ctx, palette, i, 'en', true, DESKTOP.barH),
    },
    DESKTOP,
    null
  )
  const frame: Frame = {
    scene,
    view: { t0, ppy },
    width: 800,
    height: 400,
    scrollY: 0,
    palette,
    lang: 'en',
    ticks: ticks(t0, t0 + 66, ppy, 'en'),
    today: 2026,
    hovered: null,
    selected: null,
    cursorX: null,
    extent: [1400, 1500],
    image: () => null,
    covers: true,
  }
  paint(ctx, frame)
  return { texts }
}

describe('a label beside something scrolled off', () => {
  it('is still drawn while any of it can be seen', () => {
    // The point at 1453 is 3 years — 30 px — left of the edge; its label runs on for 170 px.
    const { texts } = frameAt(1456)
    expect(texts.map((t) => t.text)).toContain('A battle with a long name')
  })

  it('is not drawn once all of it has gone', () => {
    const { texts } = frameAt(1500)
    expect(texts.map((t) => t.text)).not.toContain('A battle with a long name')
  })
})
