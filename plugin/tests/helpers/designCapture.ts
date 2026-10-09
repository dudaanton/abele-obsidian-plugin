import type { Box, DesignSnapshot, Level, MeasuredElement, RowMetrics } from './designLint'

export interface CaptureOptions {
  rowSelector?: string
  kindAttribute?: string
  levels?: Partial<Record<Level, string>>
  iconSelector?: string
  actionSelector?: string
  nativeSelector?: string
  mobile?: boolean
}
/** Self-contained: stringify this function to execute in the renderer (no Node/Obsidian API). */
export function captureDesign(selector: string, options: CaptureOptions = {}): DesignSnapshot {
  const rows =
    options.rowSelector ??
    '[data-design-row], .abele-list-row__line, .tree-item-self, .nav-file-title, .search-result-file-title'
  const levelSelectors = {
    section:
      '[data-design-level="section"], .abele-list-section-header [class$="__header-text"], .backlink-pane > .tree-item-self > .tree-item-inner',
    title:
      '[data-design-level="title"], .abele-list-row__title-line, .tree-item-inner:not(.abele-list-row__content):not(.backlink-pane > .tree-item-self > .tree-item-inner), .nav-file-title-content, .search-result-file-title:not(:has(.tree-item-inner))',
    meta: '[data-design-level="meta"], .abele-meta-line:not(.abele-event-list__meta > .abele-meta-line), .abele-event-list__meta, .abele-list-row__title > .abele-relative-time, .abele-list-row__state, .abele-list-row__snippet',
    detail:
      '[data-design-level="detail"], .abele-disclosure:not(.abele-disclosure_compact) > .abele-disclosure__control',
    ...options.levels,
  }
  const icons = options.iconSelector ?? 'svg, [data-design-icon]'
  const actions = options.actionSelector ?? '[data-design-action], .abele-list-row__actions'
  const view = document.defaultView!
  const box = (r: DOMRect): Box => ({ x: r.x, y: r.y, width: r.width, height: r.height })
  const number = (s: string) => parseFloat(s) || 0
  const visible = (el: Element, measureOpacityOnlyIcon = false) => {
    const r = el.getBoundingClientRect()
    if (
      !r.width ||
      !r.height ||
      r.right <= 0 ||
      r.bottom <= 0 ||
      r.x >= view.innerWidth ||
      r.y >= view.innerHeight
    )
      return false
    for (let p: Element | null = el; p; p = p.parentElement) {
      const s = view.getComputedStyle(p)
      if (
        s.display === 'none' ||
        s.visibility === 'hidden' ||
        s.visibility === 'collapse' ||
        (Number(s.opacity) === 0 && !measureOpacityOnlyIcon)
      )
        return false
      if (p !== el && (s.overflowX !== 'visible' || s.overflowY !== 'visible')) {
        const clip = p.getBoundingClientRect()
        if (s.overflowX !== 'visible' && (r.right <= clip.x || r.x >= clip.right)) return false
        if (s.overflowY !== 'visible' && (r.bottom <= clip.y || r.y >= clip.bottom)) return false
      }
    }
    return true
  }
  const textBoxes = (
    el: Element,
    deep: boolean
  ): { text: string; lines: Box[]; firstLine?: Box } => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const lines: Box[] = []
    const texts: string[] = []
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      if (!node.textContent?.trim() || (!deep && node.parentElement !== el)) continue
      if (node.parentElement?.closest('svg, .collapse-icon, [aria-hidden="true"]')) continue
      if (node.parentElement && !visible(node.parentElement)) continue
      const range = document.createRange()
      const raw = node.textContent
      const start = raw.search(/\S/),
        end = raw.trimEnd().length
      range.setStart(node, start)
      range.setEnd(node, end)
      for (const r of range.getClientRects()) if (r.width && r.height) lines.push(box(r))
      texts.push(raw.trim())
    }
    lines.sort((a, b) => a.y - b.y || a.x - b.x)
    const first = lines[0]
    const onFirst =
      first && lines.filter((b) => b.y < first.y + first.height && b.y + b.height > first.y)
    const firstLine = first &&
      onFirst && {
        x: Math.min(...onFirst.map((b) => b.x)),
        y: first.y,
        width:
          Math.max(...onFirst.map((b) => b.x + b.width)) - Math.min(...onFirst.map((b) => b.x)),
        height: Math.max(...onFirst.map((b) => b.y + b.height)) - first.y,
      }
    return { text: texts.join(' '), lines, firstLine }
  }
  const collect = (root: Element, nativeReference = false): MeasuredElement[] => {
    const all = [root, ...root.querySelectorAll('*')]
    const ids = new Map(all.map((el, i) => [el, 'e' + i]))
    const result: MeasuredElement[] = []
    for (const el of all) {
      if (!visible(el, nativeReference && !!el.closest(icons))) continue
      const s = view.getComputedStyle(el),
        rect = box(el.getBoundingClientRect())
      const host = el.closest(rows)
      const level = (Object.keys(levelSelectors) as Level[]).find(
        (l) =>
          el.matches(levelSelectors[l]) &&
          !(
            l === 'meta' &&
            !options.levels?.meta &&
            el.matches('.abele-meta-line') &&
            el.closest('.abele-event-list__meta')
          )
      )
      const isIcon = el.matches(icons) && !el.parentElement?.closest(icons)
      const control = el.matches(
        'button, input, select, textarea, summary, a[href], [role="button"], [role="checkbox"], [role="treeitem"][tabindex="0"], [role="tab"], [role="switch"], [role="menuitem"], [tabindex="0"], .clickable-icon, .is-clickable'
      )
      const text = textBoxes(el, !!level || control)
      const glyphText = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim()
      const role = isIcon ? 'icon' : control ? 'control' : text.text || glyphText ? 'text' : 'other'
      const iconRole = isIcon
        ? el.closest('.collapse-icon, [data-design-disclosure]')
          ? ('collapse' as const)
          : ('content' as const)
        : undefined
      let slot: MeasuredElement['slot']
      if (host && isIcon) {
        if (el.closest(actions)) slot = 'action'
        else if (
          !el.closest('.abele-disclosure, [data-design-disclosure]') &&
          (!host.matches('.abele-list-row__line') || el.closest('.abele-list-row__leading'))
        )
          slot = 'icon'
      } else if (host && level) slot = 'text'
      else if (host && control && el.closest(actions) && !el.querySelector(icons)) slot = 'action'
      const ancestors: Element[] = []
      for (let p: Element | null = el; p; p = p.parentElement) ancestors.unshift(p)
      let composed = [255, 255, 255]
      for (const ancestor of ancestors) {
        const color = /^rgba?\(([^)]+)\)$/.exec(view.getComputedStyle(ancestor).backgroundColor)
        if (!color) continue
        const values = color[1]
            .split(/[,\s/]+/)
            .filter(Boolean)
            .map(Number),
          alpha = values[3] ?? 1
        composed = composed.map((value, i) => values[i] * alpha + value * (1 - alpha))
      }
      const bg = `rgb(${composed.map(Math.round).join(', ')})`
      const fontSize = number(s.fontSize)
      const canvas = document.createElement('canvas'),
        context = canvas.getContext('2d')
      if (context) context.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`
      const m = context?.measureText('Mg')
      const lineHeight =
        s.lineHeight === 'normal'
          ? m
            ? m.fontBoundingBoxAscent + m.fontBoundingBoxDescent
            : fontSize * 1.2
          : number(s.lineHeight)
      const depth = (host?.getAttribute('data-path') ?? '').split('/').length - 1
      const kind =
        host?.getAttribute(options.kindAttribute ?? 'data-design-kind') ??
        (host?.classList.contains('abele-list-row__line')
          ? 'list-row'
          : host?.matches('.backlink-pane > .tree-item-self')
            ? 'backlinks-section'
            : host?.classList.contains('search-result-file-title')
              ? 'search-result'
              : host?.classList.contains('nav-file-title')
                ? 'nav-file:' + depth
                : host?.classList.contains('nav-folder-title')
                  ? 'nav-folder:' + depth
                  : 'tree-row')
      const typed = (
        el as Element & {
          computedStyleMap?: () => { get: (key: string) => { toString(): string } | undefined }
        }
      ).computedStyleMap?.()
      const autoMargins = ['top', 'right', 'bottom', 'left'].flatMap((side, i) =>
        typed?.get('margin-' + side)?.toString() === 'auto' ? [i] : []
      )
      result.push({
        id: ids.get(el)!,
        selector:
          el.tagName.toLowerCase() +
          (el.id ? '#' + el.id : '') +
          [...el.classList].map((c) => '.' + c).join(''),
        parent: ids.get(el.parentElement!) ?? null,
        row: host && ids.get(host),
        kind,
        role,
        layoutBox: !el.parentElement?.closest('svg'),
        layout: { display: s.display, justify: s.justifyContent },
        slot,
        iconRole,
        level,
        rect,
        fragments: [...el.getClientRects()].filter((r) => r.width && r.height).map(box),
        ...text,
        glyphText,
        paintVisible: nativeReference ? visible(el) : true,
        baseline:
          text.firstLine && m
            ? text.firstLine.y + text.firstLine.height - m.fontBoundingBoxDescent
            : undefined,
        font: {
          size: fontSize,
          weight: s.fontWeight === 'bold' ? 700 : number(s.fontWeight) || 400,
          lineHeight,
          lineHeightCss: s.lineHeight,
          color: s.color,
        },
        background: bg || undefined,
        padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(number) as [
          number,
          number,
          number,
          number,
        ],
        margin: [s.marginTop, s.marginRight, s.marginBottom, s.marginLeft].map(number) as [
          number,
          number,
          number,
          number,
        ],
        autoMargins,
        gap: [number(s.rowGap), number(s.columnGap)],
        client: [el.clientWidth, el.clientHeight],
        scroll: [el.scrollWidth, el.scrollHeight],
        overflow: [s.overflowX, s.overflowY],
        lineClamp: number(s.webkitLineClamp),
        fullTextAvailable: !!el
          .closest('button[aria-label], a[href][aria-label]')
          ?.getAttribute('aria-label')
          ?.includes(el.textContent?.trim() || '\u0000'),
        disabled: el.matches(':disabled, [aria-disabled="true"]'),
      })
    }
    return result
  }
  const root = [...document.querySelectorAll(selector)].find((el) => visible(el))
  if (!root) throw new Error('No visible design-lint container: ' + selector)
  const style = view.getComputedStyle(root)
  const scale = [0]
  // Resolve theme tokens through a temporary inherited element; this handles calc/rem tokens.
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;'
  root.appendChild(probe)
  try {
    for (const family of [2, 4])
      for (let i = 0; i <= 24; i++) {
        const token = `--size-${family}-${i}`
        if (!style.getPropertyValue(token).trim()) continue
        probe.style.width = `var(${token})`
        const value = number(view.getComputedStyle(probe).width)
        if (!scale.includes(value)) scale.push(value)
      }
  } finally {
    probe.remove()
  }
  const elements = collect(root)
  const snapshot: DesignSnapshot = {
    selector,
    viewport: { width: view.innerWidth, height: view.innerHeight },
    mobile: options.mobile ?? document.body.classList.contains('is-mobile'),
    scale: scale.sort((a, b) => a - b),
    elements,
  }
  const nativeSelector =
    options.nativeSelector ??
    '.backlink-pane .tree-item-self, .nav-file-title, .search-result-file-title'
  const candidates = options.nativeSelector
    ? [...document.querySelectorAll(options.nativeSelector)]
    : ['.backlink-pane .tree-item-self', '.nav-file-title', '.search-result-file-title'].flatMap(
        (s) => [...document.querySelectorAll(s)]
      )
  const references = [...new Set(candidates)].filter(
    (e) => visible(e) && !e.closest('.abele-list-row')
  )
  for (const reference of references) {
    const nativeElements = collect(reference, true)
    const host = nativeElements[0],
      title =
        nativeElements.find((e) => e.level === 'title') ??
        nativeElements.find((e) => e.level === 'section'),
      icon = nativeElements.find((e) => e.role === 'icon' && e.slot === 'icon')
    const metrics = {
      padding: host.padding,
      iconSize: icon && Math.max(icon.rect.width, icon.rect.height),
      iconRole: icon?.iconRole,
      iconTextGap:
        icon && title?.firstLine ? title.firstLine.x - icon.rect.x - icon.rect.width : undefined,
      lineHeight: title?.font.lineHeight,
    }
    snapshot.native ??= {
      selector: nativeSelector,
      kind: host.kind,
      metrics,
      variants: {},
      elements: nativeElements,
    }
    const complete = (m: RowMetrics) =>
      m.iconSize !== undefined && m.iconTextGap !== undefined && m.lineHeight !== undefined
    if (complete(metrics) && !complete(snapshot.native.metrics)) {
      snapshot.native.metrics = metrics
      snapshot.native.kind = host.kind
      snapshot.native.elements = nativeElements
    }
    const variant = snapshot.native.variants![host.kind!]
    if (!variant || (complete(metrics) && !complete(variant)))
      snapshot.native.variants![host.kind!] = metrics
  }
  return snapshot
}
export const designCaptureExpression = (selector: string, options: CaptureOptions = {}): string =>
  `(${captureDesign.toString()})(${JSON.stringify(selector)}, ${JSON.stringify(options)})`
