/** Pure geometry rules. No DOM, Obsidian or machine-specific dependencies. All units are CSS px. */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}
export type Level = 'section' | 'title' | 'meta' | 'detail'
export type Insets = [number, number, number, number]
export interface MeasuredElement {
  id: string
  selector: string
  parent: string | null
  row?: string
  kind?: string
  role: 'icon' | 'text' | 'control' | 'other'
  /** SVG paint primitives are captured but do not participate in CSS sibling layout. */
  layoutBox?: boolean
  layout?: { display: string; justify: string }
  slot?: 'icon' | 'text' | 'action'
  iconRole?: 'content' | 'collapse'
  level?: Level
  rect: Box
  /** CSS fragment rectangles for inline elements wrapping across multiple lines. */
  fragments?: Box[]
  firstLine?: Box
  /** Range rects are glyph boxes, not CSS line-height boxes. */
  lines?: Box[]
  /** Font-metric baseline derived from the first Range box and canvas descent. */
  baseline?: number
  text: string
  /** Direct painted text, including aria-hidden disclosure glyphs omitted from text-line geometry. */
  glyphText?: string
  paintVisible?: boolean
  font: { size: number; weight: number; lineHeight: number; lineHeightCss?: string; color: string }
  background?: string
  padding: Insets
  margin: Insets
  /** Resolved auto margins are distributed free space, not design spacing tokens. */
  autoMargins?: number[]
  gap?: [number, number]
  client: [number, number]
  scroll: [number, number]
  overflow: [string, string]
  /** Actual CSS line clamp plus a labelled interactive opener, not a blanket clipping waiver. */
  lineClamp?: number
  fullTextAvailable?: boolean
  disabled?: boolean
}
export interface RowMetrics {
  iconRole?: 'content' | 'collapse'
  iconSize?: number
  padding: Insets
  iconTextGap?: number
  lineHeight?: number
}
export interface DesignSnapshot {
  selector: string
  viewport: { width: number; height: number }
  mobile: boolean
  scale: number[]
  elements: MeasuredElement[]
  native?: {
    selector: string
    kind?: string
    metrics: RowMetrics
    variants?: Record<string, RowMetrics>
    elements?: MeasuredElement[]
  }
}
export interface Violation {
  rule: string
  message: string
  elements: string[]
  boxes: Box[]
  delta?: number
  metric?: string
}
export interface LintOptions {
  tolerance?: number
  fontTolerance?: number
  weightTolerance?: number
  contrastTolerance?: number
  touchSize?: number
  requireNative?: boolean
}
const levels: Level[] = ['section', 'title', 'meta', 'detail']
const centre = (b: Box) => b.y + b.height / 2
const right = (b: Box) => b.x + b.width
const bottom = (b: Box) => b.y + b.height
const line = (e: MeasuredElement) => e.firstLine ?? e.rect
const rgb = (s: string): number[] | undefined => {
  const match = /^rgba?\(([^)]+)\)$/.exec(s)
  return match?.[1]
    .split(/[,\s/]+/)
    .filter(Boolean)
    .map(Number)
}
function luminance(c: number[]): number {
  return c
    .slice(0, 3)
    .map((v) => {
      v /= 255
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
}
/** Contrast, rather than raw darkness, works for both light and dark native themes. */
function contrast(color: string, background: string): number | undefined {
  const fg = rgb(color),
    bg = rgb(background)
  if (!fg || !bg) return undefined
  const alpha = fg[3] ?? 1
  const a = luminance(fg.slice(0, 3).map((v, i) => v * alpha + bg[i] * (1 - alpha))),
    b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
export function rowMetrics(elements: MeasuredElement[], row: MeasuredElement): RowMetrics {
  const members = elements.filter((e) => e.row === row.id)
  const icon = members.find((e) => e.slot === 'icon' && e.role === 'icon')
  const title =
    members.find((e) => e.level === 'title') ?? members.find((e) => e.level === 'section')
  return {
    iconSize: icon && Math.max(icon.rect.width, icon.rect.height),
    iconRole: icon?.iconRole,
    padding: row.padding,
    iconTextGap: icon && title ? line(title).x - right(icon.rect) : undefined,
    lineHeight: title?.font.lineHeight,
  }
}
export function lintDesign(snapshot: DesignSnapshot, options: LintOptions = {}): Violation[] {
  const {
    tolerance = 1,
    fontTolerance = 1,
    weightTolerance = 1,
    contrastTolerance = 0.1,
    touchSize = 44,
  } = options
  const violations: Violation[] = []
  const els = snapshot.elements
  const byId = new Map(els.map((e) => [e.id, e]))
  const add = (
    rule: string,
    message: string,
    elements: MeasuredElement[],
    delta?: number,
    metric?: string,
    boxes = elements.map((e) => e.rect)
  ) => {
    violations.push({
      rule,
      message,
      elements: elements.map((e) => e.id),
      boxes,
      ...(delta !== undefined ? { delta } : {}),
      ...(metric ? { metric } : {}),
    })
  }
  const onScale = (value: number) => snapshot.scale.some((s) => Math.abs(value - s) <= tolerance)
  const background = (e: MeasuredElement): string => {
    if (e.background) return e.background
    const parent = e.parent && byId.get(e.parent)
    return parent ? background(parent) : 'rgb(255, 255, 255)'
  }
  for (const e of els) {
    for (let axis = 0; axis < 2; axis++) {
      const delta = e.scroll[axis] - e.client[axis]
      if (
        delta > tolerance &&
        !['auto', 'scroll', 'visible'].includes(e.overflow[axis]) &&
        !(axis === 1 && (e.lineClamp ?? 0) > 0 && e.fullTextAvailable)
      )
        add(
          'clipping',
          `Content clipped on ${axis ? 'y' : 'x'} by ${delta.toFixed(1)}px`,
          [e],
          delta
        )
    }
    if (/[▶▼►]/u.test(e.text + (e.glyphText ?? '')))
      add('text-triangle', 'Use a native SVG disclosure icon, not a text glyph', [e])
    if (
      snapshot.mobile &&
      e.role === 'control' &&
      !e.disabled &&
      (e.rect.width < touchSize - tolerance || e.rect.height < touchSize - tolerance)
    )
      add(
        'touch-target',
        `Hit box ${e.rect.width.toFixed(1)}×${e.rect.height.toFixed(1)} is below ${touchSize}px`,
        [e],
        Math.min(e.rect.width, e.rect.height) - touchSize
      )
    for (const [name, values] of [
      ['padding', e.padding],
      ['margin', e.margin],
      ['gap', e.gap ?? []],
    ] as const) {
      values.forEach((value, i) => {
        if (name === 'margin' && e.autoMargins?.includes(i)) return
        if (!onScale(name === 'margin' ? Math.abs(value) : value))
          add(
            'spacing-scale',
            `${name}[${i}] ${value.toFixed(1)}px is not a theme spacing token`,
            [e],
            value,
            `${name}.${i}`
          )
      })
    }
  }
  const siblings = new Map<string, MeasuredElement[]>()
  for (const e of els)
    if (e.parent && e.layoutBox !== false)
      siblings.set(e.parent, [...(siblings.get(e.parent) ?? []), e])
  for (const group of siblings.values()) {
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i],
          b = group[j]
        const x = Math.min(right(a.rect), right(b.rect)) - Math.max(a.rect.x, b.rect.x)
        const y = Math.min(bottom(a.rect), bottom(b.rect)) - Math.max(a.rect.y, b.rect.y)
        const aBoxes = a.fragments?.length ? a.fragments : [a.rect]
        const bBoxes = b.fragments?.length ? b.fragments : [b.rect]
        let overlap: { a: Box; b: Box; x: number; y: number } | undefined
        for (const aa of aBoxes)
          for (const bb of bBoxes) {
            const ox = Math.min(right(aa), right(bb)) - Math.max(aa.x, bb.x)
            const oy = Math.min(bottom(aa), bottom(bb)) - Math.max(aa.y, bb.y)
            if (ox > tolerance && oy > tolerance) overlap ??= { a: aa, b: bb, x: ox, y: oy }
          }
        if (overlap)
          add(
            'sibling-overlap',
            `Sibling fragments overlap ${overlap.x.toFixed(1)}×${overlap.y.toFixed(1)}px`,
            [a, b],
            Math.min(overlap.x, overlap.y),
            undefined,
            [overlap.a, overlap.b]
          )
        const parent = byId.get(a.parent!)
        if (
          j === i + 1 &&
          y > tolerance &&
          x <= 0 &&
          parent?.layout &&
          /flex|grid/.test(parent.layout.display) &&
          !['space-between', 'space-around', 'space-evenly'].includes(parent.layout.justify) &&
          ![...(a.autoMargins ?? []), ...(b.autoMargins ?? [])].some(
            (side) => side === 1 || side === 3
          )
        ) {
          const gap =
            b.rect.x >= right(a.rect) ? b.rect.x - right(a.rect) : a.rect.x - right(b.rect)
          if (!onScale(gap))
            add(
              'spacing-scale',
              `Sibling gap ${gap.toFixed(1)}px is not a theme spacing token`,
              [a, b],
              gap,
              'sibling-gap'
            )
        }
        // Adjacent vertical boxes and real horizontal gaps, not distributed free space.
        if (
          j === i + 1 &&
          x > tolerance &&
          y <= 0 &&
          (!parent?.layout?.display.includes('grid') ||
            (Math.abs(a.rect.x - b.rect.x) <= tolerance &&
              Math.abs(a.rect.width - b.rect.width) <= tolerance))
        ) {
          const gap =
            b.rect.y >= bottom(a.rect) ? b.rect.y - bottom(a.rect) : a.rect.y - bottom(b.rect)
          const low = Math.min(bottom(a.rect), bottom(b.rect)),
            high = Math.max(a.rect.y, b.rect.y)
          const occupied =
            parent?.layout?.display.includes('grid') &&
            group.some(
              (c) =>
                c !== a &&
                c !== b &&
                c.rect.y < high &&
                bottom(c.rect) > low &&
                right(c.rect) > Math.max(a.rect.x, b.rect.x) &&
                c.rect.x < Math.min(right(a.rect), right(b.rect))
            )
          if (!occupied && !onScale(gap))
            add(
              'spacing-scale',
              `Sibling gap ${gap.toFixed(1)}px is not a theme spacing token`,
              [a, b],
              gap,
              'sibling-gap'
            )
        }
      }
  }
  const rowGroups = new Map<string, MeasuredElement[]>()
  for (const e of els) if (e.row) rowGroups.set(e.row, [...(rowGroups.get(e.row) ?? []), e])
  const columns = new Map<string, MeasuredElement>()
  const gaps = new Map<string, { value: number; elements: MeasuredElement[] }>()
  for (const [id, members] of rowGroups) {
    const host = byId.get(id)
    const title =
      members.find((e) => e.level === 'title') ?? members.find((e) => e.level === 'section')
    if (!host || !title) continue
    const text = members.filter((e) => e.slot === 'text' && e.level)
    for (const e of members.filter(
      (e) =>
        (e.role === 'icon' || e.role === 'control') && (e.slot === 'icon' || e.slot === 'action')
    )) {
      const visual = e.role === 'control' ? line(e) : e.rect
      const delta = centre(visual) - centre(line(title))
      if (Math.abs(delta) > tolerance)
        add(
          'line-alignment',
          `${e.slot} centre differs from title first line by ${delta.toFixed(1)}px`,
          [e, title],
          delta,
          'centreY',
          [visual, line(title)]
        )
    }
    for (const e of text) {
      const delta = line(e).x - line(title).x
      if (Math.abs(delta) > tolerance)
        add(
          'text-left-edge',
          `${e.level} starts ${delta.toFixed(1)}px from the title column`,
          [e, title],
          delta,
          'left',
          [line(e), line(title)]
        )
    }
    const kind = host.kind ?? title.kind ?? 'row'
    for (const slot of ['icon', 'text', 'action'] as const) {
      const e =
        slot === 'text'
          ? title
          : members.find((m) => m.slot === slot && (m.role === 'icon' || m.role === 'control'))
      if (!e) continue
      const key = `${kind}:${slot}`
      const first = columns.get(key)
      if (!first) columns.set(key, e)
      else {
        const delta =
          (slot === 'text' || e.role === 'control' ? line(e).x : e.rect.x) -
          (slot === 'text' || first.role === 'control' ? line(first).x : first.rect.x)
        if (Math.abs(delta) > tolerance)
          add('row-column', `${key} column differs by ${delta.toFixed(1)}px`, [e, first], delta)
      }
    }
    const ordered = text.slice().sort((a, b) => a.rect.y - b.rect.y)
    const semanticGaps: { key: string; value: number; elements: MeasuredElement[] }[] = []
    for (let i = 1; i < ordered.length; i++) {
      const a = ordered[i - 1],
        b = ordered[i]
      if (b.rect.y >= bottom(a.rect))
        semanticGaps.push({
          key: `${a.level}-${b.level}`,
          value: b.rect.y - bottom(a.rect),
          elements: [a, b],
        })
    }
    const icon = members.find((e) => e.role === 'icon' && e.slot === 'icon')
    if (icon)
      semanticGaps.push({
        key: 'icon-text',
        value: line(title).x - right(icon.rect),
        elements: [icon, title],
      })
    for (const gap of semanticGaps) {
      if (!onScale(gap.value))
        add(
          'spacing-scale',
          `${gap.key} gap ${gap.value.toFixed(1)}px is not a theme spacing token`,
          gap.elements,
          gap.value,
          gap.key
        )
      const key = `${kind}:${gap.key}`
      const first = gaps.get(key)
      if (!first) gaps.set(key, gap)
      else if (Math.abs(gap.value - first.value) > tolerance)
        add(
          'row-spacing',
          `${key} gap differs by ${(gap.value - first.value).toFixed(1)}px`,
          [...gap.elements, ...first.elements],
          gap.value - first.value,
          gap.key
        )
    }
    for (const child of text) {
      const index = levels.indexOf(child.level!)
      const parent = text
        .filter((e) => levels.indexOf(e.level!) < index)
        .sort((a, b) => levels.indexOf(b.level!) - levels.indexOf(a.level!))[0]
      if (!parent) continue
      const childContrast = contrast(child.font.color, background(child)),
        parentContrast = contrast(parent.font.color, background(parent))
      if (
        child.font.size > parent.font.size + fontTolerance ||
        child.font.weight > parent.font.weight + weightTolerance ||
        (childContrast !== undefined &&
          parentContrast !== undefined &&
          childContrast > parentContrast + contrastTolerance)
      )
        add(
          'hierarchy-order',
          `${child.level} is larger, heavier or higher contrast than ${parent.level}`,
          [child, parent]
        )
      if (
        child.level === 'detail' &&
        child.font.size >= title.font.size - fontTolerance &&
        child.font.weight >= title.font.weight - weightTolerance &&
        child.font.color === title.font.color
      )
        add('hierarchy-emphasis', 'Detail has the same emphasis as the title', [child, title])
    }
    if (snapshot.native) {
      const measured = rowMetrics(els, host),
        reference = snapshot.native.variants?.[kind] ?? snapshot.native.metrics
      const compare = (metric: string, actual?: number, expected?: number) => {
        if (
          actual !== undefined &&
          expected !== undefined &&
          Math.abs(actual - expected) > tolerance
        )
          add(
            'native-parity',
            `${metric}: ${actual.toFixed(1)}px vs native ${expected.toFixed(1)}px`,
            [host],
            actual - expected,
            metric
          )
      }
      if (measured.iconRole === reference.iconRole) {
        compare('iconSize', measured.iconSize, reference.iconSize)
        compare('iconTextGap', measured.iconTextGap, reference.iconTextGap)
      }
      compare('lineHeight', measured.lineHeight, reference.lineHeight)
      measured.padding.forEach((v, i) =>
        compare(`padding.${['top', 'right', 'bottom', 'left'][i]}`, v, reference.padding[i])
      )
    }
  }
  const styles = new Map<Level, MeasuredElement>()
  for (const e of els)
    if (e.level) {
      const first = styles.get(e.level)
      if (!first) styles.set(e.level, e)
      else if (
        Math.abs(e.font.size - first.font.size) > fontTolerance ||
        Math.abs(e.font.weight - first.font.weight) > weightTolerance ||
        e.font.color !== first.font.color
      )
        add('hierarchy-consistency', `${e.level} typography differs within this container`, [
          e,
          first,
        ])
    }
  const declared = levels.map((l) => styles.get(l)).filter((e): e is MeasuredElement => !!e)
  for (let i = 1; i < declared.length; i++) {
    const parent = declared[i - 1],
      child = declared[i]
    const a = contrast(child.font.color, background(child)),
      b = contrast(parent.font.color, background(parent))
    if (
      child.font.size > parent.font.size + fontTolerance ||
      child.font.weight > parent.font.weight + weightTolerance ||
      (a !== undefined && b !== undefined && a > b + contrastTolerance)
    ) {
      if (
        !violations.some(
          (v) =>
            v.rule === 'hierarchy-order' &&
            v.elements[0] === child.id &&
            v.elements[1] === parent.id
        )
      )
        add(
          'hierarchy-order',
          `${child.level} is larger, heavier or higher contrast than ${parent.level}`,
          [child, parent]
        )
    }
  }
  if (options.requireNative && !snapshot.native)
    add(
      'native-reference-missing',
      'No visible native row in this session; open a native pane or set nativeSelector',
      els.slice(0, 1)
    )
  return violations
}
