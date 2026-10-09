import { describe, expect, it } from 'vitest'
import { lintDesign, type DesignSnapshot, type MeasuredElement } from '../helpers/designLint'

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })
const element = (id: string, overrides: Partial<MeasuredElement> = {}): MeasuredElement => ({
  id,
  selector: '#' + id,
  parent: 'row',
  row: 'row',
  kind: 'entry',
  role: 'other',
  rect: rect(40, 20, 100, 20),
  text: '',
  padding: [0, 0, 0, 0],
  margin: [0, 0, 0, 0],
  font: { size: 14, weight: 400, lineHeight: 20, color: 'rgb(100, 100, 100)' },
  client: [100, 20],
  scroll: [100, 20],
  overflow: ['visible', 'visible'],
  ...overrides,
})
const snapshot = (elements: MeasuredElement[], mobile = false): DesignSnapshot => ({
  selector: '#sample',
  viewport: { width: 800, height: 600 },
  mobile,
  scale: [0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48],
  elements,
})
const row = () => [
  element('row', { parent: null, rect: rect(8, 8, 300, 100), padding: [8, 8, 8, 8] }),
  element('icon', { role: 'icon', slot: 'icon', rect: rect(16, 20, 16, 16) }),
  element('title', {
    role: 'text',
    slot: 'text',
    level: 'title',
    text: 'Example record',
    firstLine: rect(40, 18, 100, 20),
    font: { size: 14, weight: 600, lineHeight: 20, color: 'rgb(30, 30, 30)' },
  }),
  element('meta', {
    role: 'text',
    slot: 'text',
    level: 'meta',
    rect: rect(40, 46, 100, 20),
    firstLine: rect(40, 46, 100, 20),
    text: 'Example metadata',
  }),
  element('action', { role: 'icon', slot: 'action', rect: rect(280, 20, 16, 16) }),
]
const codes = (s: DesignSnapshot, options = {}) => lintDesign(s, options).map((v) => v.rule)

describe('design lint geometry rules', () => {
  it('compares native control insets against independent native geometry without accepting changed values', () => {
    const input = element('search', { padding: [0, 8, 0, 30], nativePadding: [0, 8, 0, 30] })
    expect(codes(snapshot([input]))).not.toContain('spacing-scale')
    input.padding[3] = 35
    expect(codes(snapshot([input]))).toContain('spacing-scale')
    input.padding[3] = 32
    expect(codes(snapshot([input]))).toContain('native-parity')
    delete input.nativePadding
    input.padding[3] = 30
    expect(codes(snapshot([input]))).toContain('spacing-scale')
  })
  it('recognizes native selected text paint without masking an off-theme override', () => {
    const normal = element('normal', { level: 'title', role: 'text' })
    normal.nativeFont = { ...normal.font }
    const selected = element('selected', {
      level: 'title',
      role: 'text',
      rect: rect(40, 60, 100, 20),
      font: { ...normal.font, color: 'rgb(30, 30, 30)' },
    })
    selected.nativeFont = { ...selected.font }
    expect(codes(snapshot([normal, selected]))).not.toContain('hierarchy-consistency')
    selected.font.color = 'rgb(0, 0, 0)'
    expect(codes(snapshot([normal, selected]))).toContain('hierarchy-consistency')
  })
  it('recognizes measured platform insets only on their matching padding side', () => {
    const modal = element('modal', { padding: [0, 16, 34, 16], environmentPadding: [0, 0, 34, 0] })
    expect(codes(snapshot([modal], true))).not.toContain('spacing-scale')
    modal.padding[2] = 37
    expect(codes(snapshot([modal], true))).toContain('spacing-scale')
    modal.padding = [34, 16, 0, 16]
    expect(codes(snapshot([modal], true))).toContain('spacing-scale')
  })
  it('compares a native tree family with its own independently captured collapse gutter, not Backlinks padding', () => {
    const els = row()
    els[0].padding[3] = 24
    els[0].nativeRow = { padding: [8, 8, 8, 24], lineHeight: 20 }
    const s = snapshot(els)
    s.native = { selector: '#reference', metrics: { padding: [8, 8, 8, 8], lineHeight: 20 } }
    expect(codes(s)).not.toContain('native-parity')
    els[0].padding[3] = 28
    expect(codes(s)).toContain('native-parity')
  })
  it('does not confuse a transparent header box with painted text, but still detects actual title/control overlap', () => {
    const header = element('header', {
      rect: rect(0, 0, 300, 44),
      fragments: [rect(20, 10, 120, 20)],
    })
    const close = element('close', { role: 'control', rect: rect(250, 0, 44, 44) })
    expect(codes(snapshot([header, close]))).not.toContain('sibling-overlap')
    header.fragments = [rect(20, 10, 260, 20)]
    expect(codes(snapshot([header, close]))).toContain('sibling-overlap')
  })
  it('accepts aligned first lines and scale spacing without confusing glyph bounds with line-height', () => {
    expect(lintDesign(snapshot(row()))).toEqual([])
  })
  it('compares icon parity only within the same semantic icon role, without relaxing size tolerance', () => {
    const s = snapshot(row())
    s.elements[1].iconRole = 'content'
    s.native = {
      selector: '#reference',
      metrics: {
        padding: [8, 8, 8, 8],
        iconSize: 10,
        iconRole: 'collapse',
        iconTextGap: 8,
        lineHeight: 20,
      },
    }
    expect(codes(s)).not.toContain('native-parity')
    s.native.metrics.iconRole = 'content'
    expect(lintDesign(s).some((v) => v.rule === 'native-parity' && v.metric === 'iconSize')).toBe(
      true
    )
  })
  it('reports leading and trailing icons against the first line, not a multi-line title box', () => {
    const els = row()
    els[1].rect.y = 10
    els[2].rect.height = 60
    els[4].rect.y = 30
    const violations = lintDesign(snapshot(els))
    expect(violations.filter((v) => v.rule === 'line-alignment')).toHaveLength(2)
    const leading = violations.find((v) => v.rule === 'line-alignment' && v.elements[0] === 'icon')!
    expect(leading).toMatchObject({ elements: ['icon', 'title'], delta: -10 })
    expect(leading.boxes).toHaveLength(2)
  })
  it('aligns text-only trailing actions by their glyph line, not their padded hit box', () => {
    const els = row()
    els[4] = element('action', {
      role: 'control',
      slot: 'action',
      text: 'Open',
      rect: rect(260, 8, 44, 44),
      firstLine: rect(270, 18, 24, 20),
    })
    expect(codes(snapshot(els))).not.toContain('line-alignment')
    els[4].firstLine!.y += 6
    expect(lintDesign(snapshot(els))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'line-alignment',
          elements: ['action', 'title'],
          delta: 6,
        }),
      ])
    )
  })
  it('finds different text left edges, off-scale gaps and equal-emphasis detail', () => {
    const els = row()
    els[3].rect.x = 22
    els[3].firstLine!.x = 22
    els[3].rect.y = 50
    els.push(
      element('detail', {
        role: 'text',
        slot: 'text',
        level: 'detail',
        rect: rect(44, 70, 100, 20),
        firstLine: rect(44, 70, 100, 20),
        text: 'Additional information',
        font: { ...els[2].font },
      })
    )
    expect(codes(snapshot(els))).toEqual(
      expect.arrayContaining([
        'text-left-edge',
        'spacing-scale',
        'hierarchy-order',
        'hierarchy-emphasis',
      ])
    )
  })
  it('compares columns and the same semantic gaps across rows', () => {
    const second = row().map((e) => ({
      ...e,
      id: e.id + '2',
      row: 'row2',
      parent: e.parent === null ? null : 'row2',
      rect: { ...e.rect, y: e.rect.y + 120 },
      firstLine: e.firstLine && { ...e.firstLine, y: e.firstLine.y + 120 },
    }))
    second[1].rect.x += 4
    second[3].rect.y += 4
    expect(codes(snapshot([...row(), ...second]))).toEqual(
      expect.arrayContaining(['row-column', 'row-spacing'])
    )
  })
  it('compares painted edge columns within the same glyph role, not content commands against gutter disclosures', () => {
    const a = row()
    a[4].iconRole = 'collapse'
    const b = row().map((e) => ({
      ...e,
      id: e.id + '2',
      row: 'row2',
      parent: e.parent === null ? null : 'row2',
      rect: { ...e.rect, y: e.rect.y + 120 },
      firstLine: e.firstLine && { ...e.firstLine, y: e.firstLine.y + 120 },
    }))
    b[4].iconRole = 'content'
    b[4].rect.x += 6
    expect(codes(snapshot([...a, ...b]))).not.toContain('row-column')
    b[4].iconRole = 'collapse'
    expect(codes(snapshot([...a, ...b]))).toContain('row-column')
  })
  it('compares sibling rows within a list scope rather than a nested source history against its parent list', () => {
    const outer = row()
    const inner = row().map((e) => ({
      ...e,
      id: e.id + '2',
      row: 'row2',
      parent: e.parent === null ? null : 'row2',
      rect: { ...e.rect, x: e.rect.x + 40, y: e.rect.y + 120 },
      firstLine: e.firstLine && { ...e.firstLine, x: e.firstLine.x + 40, y: e.firstLine.y + 120 },
    }))
    outer[0].rowScope = 'files'
    inner[0].rowScope = 'history'
    inner[3].rect.y += 4
    expect(codes(snapshot([...outer, ...inner]))).not.toContain('row-column')
    expect(codes(snapshot([...outer, ...inner]))).not.toContain('row-spacing')
    inner[0].rowScope = 'files'
    expect(codes(snapshot([...outer, ...inner]))).toEqual(
      expect.arrayContaining(['row-column', 'row-spacing'])
    )
  })
  it('checks level consistency and colour contrast against the captured background in light and dark themes', () => {
    const els = row()
    els[0].background = 'rgb(255, 255, 255)'
    els[3].font.color = 'rgb(0, 0, 0)'
    expect(codes(snapshot(els))).toContain('hierarchy-order')
    els[0].background = 'rgb(0, 0, 0)'
    els[2].font.color = 'rgb(150, 150, 150)'
    els[3].font.color = 'rgb(255, 255, 255)'
    expect(codes(snapshot(els))).toContain('hierarchy-order')
    els.push(
      element('extra', {
        row: undefined,
        role: 'text',
        level: 'meta',
        font: { ...els[3].font, size: 17 },
      })
    )
    expect(codes(snapshot(els))).toContain('hierarchy-consistency')
  })
  it('distinguishes intended scrolling from clipped content and reports sibling overlap and disclosure glyphs', () => {
    const els = [
      element('clip', { scroll: [120, 20], overflow: ['hidden', 'visible'] }),
      element('scroll', { parent: null, scroll: [120, 20], overflow: ['auto', 'visible'] }),
      element('triangle', { text: '\u25b6 More', role: 'text', rect: rect(50, 20, 100, 20) }),
    ]
    const violations = lintDesign(snapshot(els))
    expect(violations.filter((v) => v.rule === 'clipping').map((v) => v.elements[0])).toEqual([
      'clip',
    ])
    expect(violations.map((v) => v.rule)).toEqual(
      expect.arrayContaining(['sibling-overlap', 'text-triangle'])
    )
  })
  it('recognizes measured line clamping only when a full-text accessible opener exists', () => {
    const e = element('preview', {
      row: undefined,
      parent: null,
      text: 'A long sample',
      scroll: [100, 60],
      overflow: ['hidden', 'hidden'],
      lineClamp: 2,
      fullTextAvailable: true,
    })
    expect(codes(snapshot([e]))).not.toContain('clipping')
    e.fullTextAvailable = false
    expect(codes(snapshot([e]))).toContain('clipping')
  })
  it('checks real inline fragments rather than overlapping unions of wrapped sibling text', () => {
    const a = element('wrapped', {
      rect: rect(40, 20, 100, 40),
      fragments: [rect(40, 20, 100, 20), rect(40, 40, 10, 20)],
    })
    const b = element('following', {
      rect: rect(50, 40, 90, 20),
      fragments: [rect(50, 40, 90, 20)],
    })
    expect(codes(snapshot([a, b]))).not.toContain('sibling-overlap')
    b.fragments![0].x = 48
    const overlap = lintDesign(snapshot([a, b])).find((v) => v.rule === 'sibling-overlap')!
    expect(overlap.delta).toBe(2)
    expect(overlap.boxes[0]).toEqual(a.fragments![1])
  })
  it('measures adjacent horizontal layout gaps but not distributed flex free space', () => {
    const parent = element('flex', {
      parent: null,
      row: undefined,
      layout: { display: 'flex', justify: 'normal' },
    })
    const a = element('a', { parent: 'flex', row: undefined, rect: rect(40, 20, 10, 20) })
    const b = element('b', { parent: 'flex', row: undefined, rect: rect(60, 20, 10, 20) })
    expect(codes(snapshot([parent, a, b]))).toContain('spacing-scale')
    parent.layout!.justify = 'space-between'
    expect(lintDesign(snapshot([parent, a, b]))).toEqual([])
  })
  it('does not infer a giant gap between nonadjacent grid areas whose intervening area is occupied', () => {
    const parent = element('grid', {
      parent: null,
      row: undefined,
      rect: rect(0, 0, 300, 120),
      layout: { display: 'grid', justify: 'normal' },
    })
    const recovery = element('recovery', {
      parent: 'grid',
      row: undefined,
      rect: rect(0, 100, 300, 20),
    })
    const action = element('action', { parent: 'grid', row: undefined, rect: rect(250, 0, 50, 20) })
    const occupied = element('state', {
      parent: 'grid',
      row: undefined,
      rect: rect(0, 60, 300, 20),
    })
    expect(codes(snapshot([parent, recovery, action, occupied]))).not.toContain('spacing-scale')
  })
  it('does not infer grid track spacing from boxes in unlike spanning areas, but still reports off-scale gaps in the same track', () => {
    const p = element('grid', {
      parent: null,
      row: undefined,
      layout: { display: 'grid', justify: 'normal' },
    })
    const detail = element('detail', { parent: 'grid', row: undefined, rect: rect(0, 46, 300, 20) })
    const edge = element('edge', { parent: 'grid', row: undefined, rect: rect(250, 0, 50, 20) })
    expect(codes(snapshot([p, detail, edge]))).not.toContain('spacing-scale')
    edge.rect = rect(0, 0, 300, 20)
    expect(codes(snapshot([p, detail, edge]))).toContain('spacing-scale')
  })
  it('captures SVG paint fragments without treating their intentional intersections as sibling layout overlap', () => {
    const shapes = [
      element('path-a', { layoutBox: false }),
      element('path-b', { layoutBox: false }),
    ]
    expect(codes(snapshot(shapes))).not.toContain('sibling-overlap')
    expect(codes(snapshot(shapes.map((e) => ({ ...e, layoutBox: true }))))).toContain(
      'sibling-overlap'
    )
  })
  it('does not treat auto-distributed space or signed theme margins as design gaps', () => {
    const e = element('distributed', {
      parent: null,
      row: undefined,
      margin: [0, 0, -20, 485],
      autoMargins: [3],
    })
    expect(lintDesign(snapshot([e]))).toEqual([])
    e.margin[2] = -10
    expect(codes(snapshot([e]))).toContain('spacing-scale')
  })
  it('uses the same native row kind instead of comparing an indented result with its section', () => {
    const s = snapshot(row())
    s.native = {
      selector: '.tree-item-self',
      metrics: { padding: [4, 8, 4, 8] },
      variants: { entry: { padding: [8, 8, 8, 8], iconSize: 16, iconTextGap: 8, lineHeight: 20 } },
    }
    expect(lintDesign(s)).toEqual([])
  })
  it('checks section-to-title order even when the section is outside the row', () => {
    const els = row()
    els.unshift(
      element('section', {
        row: undefined,
        parent: null,
        level: 'section',
        role: 'text',
        rect: rect(8, 0, 300, 8),
        font: { size: 12, weight: 400, lineHeight: 16, color: 'rgb(100, 100, 100)' },
      })
    )
    expect(lintDesign(snapshot(els))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'hierarchy-order', elements: ['title', 'section'] }),
      ])
    )
  })
  it('requires 44px hit boxes only for enabled controls on mobile', () => {
    const els = [
      element('small', { role: 'control', rect: rect(20, 20, 24, 24) }),
      element('disabled', { role: 'control', disabled: true }),
    ]
    expect(codes(snapshot(els))).not.toContain('touch-target')
    expect(lintDesign(snapshot(els, true)).filter((v) => v.rule === 'touch-target')).toHaveLength(1)
  })
  it('uses configurable tolerances without hiding missing native references', () => {
    const els = row()
    els[1].rect.y += 1.5
    expect(codes(snapshot(els))).toContain('line-alignment')
    expect(codes(snapshot(els), { tolerance: 2 })).not.toContain('line-alignment')
    expect(codes(snapshot(els), { requireNative: true })).toContain('native-reference-missing')
  })
  it('reports native icon, padding, gap and line-height deltas in the same coordinates', () => {
    const s = snapshot(row())
    s.native = {
      selector: '.tree-item-self',
      metrics: { iconSize: 12, padding: [4, 4, 4, 4], iconTextGap: 4, lineHeight: 18 },
    }
    const violations = lintDesign(s)
    expect(violations.filter((v) => v.rule === 'native-parity').map((v) => v.metric)).toEqual(
      expect.arrayContaining(['iconSize', 'padding.top', 'iconTextGap', 'lineHeight'])
    )
    expect(violations.find((v) => v.metric === 'iconSize')?.delta).toBe(4)
  })
})
