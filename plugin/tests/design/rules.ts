/**
 * The design rules every screen is held to, measured on the live DOM.
 *
 * One set for the prototype kit and for the plugin: the kit runs it on its screens and the
 * plugin's live design test runs it inside Obsidian, so a rule added here turns red wherever the
 * code has not caught up. The numbers are those of the design notes («Правила дизайна, которые
 * можно проверить»); keep the two in step.
 *
 * `checkScreen` is handed to a browser as source — `page.evaluate(checkScreen, …)`, or
 * `(${checkScreen})(…)` through Obsidian's eval — so it reaches for nothing outside itself and is
 * written in types that strip away, nothing that compiles to code.
 *
 * Gaps and positions are measured as the eye sees them: from the glyphs, not from CSS boxes,
 * whose line height and padding hide several pixels.
 */

export interface RuleResult {
  id: string
  title: string
  ok: boolean
  detail: string
}

export interface ScreenCheck {
  rules: RuleResult[]
  /** One signature per table, for a check across screens that every table looks the same. */
  tables: { where: string; sig: string }[]
}

export interface ScreenScope {
  /** The screen itself: its tables, glyphs and pointers are checked. Defaults to the body. */
  root?: Element
  /**
   * Where rows are looked for (rule 24). Defaults to the whole document, because Obsidian puts
   * a modal and a suggestion list outside the view that opened them.
   */
  rows?: ParentNode
}

export function checkScreen(scope: ScreenScope = {}): ScreenCheck {
  const root: Element = scope.root ?? document.body
  const rowsIn: ParentNode = scope.rows ?? document
  const out: RuleResult[] = []
  const rule = (id: string, title: string, failures: string[], extra = '') =>
    out.push({
      id,
      title,
      ok: failures.length === 0,
      detail: failures.length
        ? failures.slice(0, 6).join('; ') +
          (failures.length > 6 ? `; и ещё ${failures.length - 6}` : '')
        : extra,
    })
  const px = (v: number) => Math.round(v * 10) / 10
  const cs = (e: Element, pseudo?: string) => getComputedStyle(e, pseudo)
  const visible = (e: Element | null) =>
    !!e && e.getClientRects().length > 0 && cs(e).visibility !== 'hidden'
  const name = (e: Element) =>
    '«' + (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24) + '»'
  // Where the glyphs are: the line boxes of the text, less the half-leading above and below.
  const glyphs = (e: Element) => {
    const range = document.createRange()
    range.selectNodeContents(e)
    const rects = [...range.getClientRects()].filter((r) => r.height > 0 && r.width > 0)
    if (!rects.length) {
      const r = e.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom }
    }
    const c = cs(e)
    const fs = parseFloat(c.fontSize)
    const lh = parseFloat(c.lineHeight) || fs * 1.2
    const half = Math.max(0, (lh - fs) / 2)
    return {
      top: Math.min(...rects.map((r) => r.top)) + half,
      bottom: Math.max(...rects.map((r) => r.bottom)) - half,
    }
  }

  // Р15–16: tables. The head is the cells' size, no word breaks across lines, one-line rows are
  // one height and everything sits at the top.
  const tables: ScreenCheck['tables'] = []
  {
    const f15: string[] = []
    const f16: string[] = []
    for (const t of root.querySelectorAll('table')) {
      if (!visible(t)) continue
      const th = t.querySelector('th')
      const td = t.querySelector('td')
      if (!th || !td) continue
      // The frame is drawn by what holds the table: the kit's frame, or the plugin table's scroller.
      const frame = t.closest('.proto-table-frame, .proto-doc__preview, .abele-table__scroll') || t
      const fc = cs(frame)
      const h = cs(th)
      const d = cs(td)
      tables.push({
        where: name(th),
        sig: `рамка ${fc.borderTopWidth} ${fc.borderRadius} · шапка ${h.fontSize} ${h.fontWeight} ${h.color} ${h.backgroundColor} ${h.paddingTop}/${h.paddingLeft} · ячейка ${d.fontSize} ${d.paddingTop}/${d.paddingLeft} ${d.borderTopWidth}/${d.borderLeftWidth} ${d.verticalAlign}`,
      })
      if (h.fontSize !== d.fontSize)
        f15.push(`${name(th)}: шапка ${h.fontSize}, ячейки ${d.fontSize}`)
      for (const cell of t.querySelectorAll('th, td')) {
        if (cell.closest('[data-specimen]')) continue
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
        let n: Node | null
        while ((n = walker.nextNode())) {
          const text = n.textContent || ''
          const re = /[^\s-]+-?/g
          let m: RegExpExecArray | null
          while ((m = re.exec(text))) {
            const r = document.createRange()
            r.setStart(n, m.index)
            r.setEnd(n, m.index + m[0].length)
            const lines = new Set(
              [...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))
            )
            if (lines.size > 1) f15.push(`${name(cell)}: слово «${m[0]}» разорвано`)
          }
        }
      }
      const singles = [...t.querySelectorAll('tbody tr')].filter((tr) =>
        [...tr.children].every((c) => {
          const g = glyphs(c)
          const lh = parseFloat(cs(c).lineHeight) || 20
          return (
            g.bottom - g.top < lh * 1.5 &&
            !c.querySelector('svg, .proto-tokens__swatch, .proto-tokens__letters')
          )
        })
      )
      const hs = singles.map((tr) => tr.getBoundingClientRect().height)
      if (hs.length > 1 && Math.max(...hs) - Math.min(...hs) > 1)
        f16.push(
          `${name(th)}: однострочные строки от ${px(Math.min(...hs))} до ${px(Math.max(...hs))}`
        )
      const aligns = new Set([...t.querySelectorAll('td')].map((c) => cs(c).verticalAlign))
      if (aligns.size > 1 || !aligns.has('top'))
        f16.push(`${name(th)}: выравнивание ${[...aligns].join(', ')}, нужно по верху`)
    }
    rule('Р15', 'Шапка того же размера, что ячейки; слова не рвутся', f15)
    rule('Р16', 'Однострочные строки одной высоты; всё по верху', f16)
  }

  // Р18: a size step takes its stroke as well as its size.
  {
    const fails: string[] = []
    const v = (n: string) => cs(document.body).getPropertyValue(n).trim()
    const steps = ['l', 'xl'].map((s) => ({
      s,
      size: parseFloat(v(`--icon-${s}`)),
      stroke: parseFloat(v(`--icon-${s}-stroke-width`)),
    }))
    for (const svg of root.querySelectorAll('svg.svg-icon')) {
      if (!visible(svg)) continue
      const w = svg.getBoundingClientRect().width
      const near = steps.filter((x) => Math.abs(x.size - w) < 0.5)
      const st = near.length === 1 ? near[0] : undefined
      if (st && Math.abs(parseFloat(cs(svg).strokeWidth) - st.stroke) > 0.05)
        fails.push(`значок ${w}px: линия ${cs(svg).strokeWidth}, у ступени ${st.s} ${st.stroke}px`)
    }
    rule('Р18', 'Ступень размера берёт все свои переменные (значок — и линию)', fails)
  }

  // Р20: what cannot be pressed has no hand cursor, and neither has what is switched off.
  {
    const fails: string[] = []
    const pressable =
      'a, button, select, input, textarea, label, summary, [role="button"], [role="link"], [role="tab"], [tabindex], .clickable-icon, .is-clickable'
    for (const e of root.querySelectorAll('*')) {
      if (!visible(e)) continue
      if (cs(e).cursor !== 'pointer') continue
      if (e.parentElement && cs(e.parentElement).cursor === 'pointer') continue
      if (!e.closest(pressable))
        fails.push(`${e.tagName.toLowerCase()}.${[...e.classList].join('.')} ${name(e)}`)
      else if (e.closest('[aria-disabled="true"], :disabled'))
        fails.push(`недоступное ${name(e)} с рукой`)
    }
    rule('Р20', 'У ненажимаемого и недоступного нет руки-курсора', fails)
  }

  // Р24: in a row of a tree or a list, every glyph, dot and count stands on the middle of the
  // first line of the name; in one tree the end dots keep one column, whatever the nesting.
  {
    const fails: string[] = []
    const columns = new Map<Element, [string, number][]>()
    const mid = (r: DOMRect) => r.top + r.height / 2
    for (const self of rowsIn.querySelectorAll(
      '.tree-item-self, .suggestion-item, .abele-entry-row'
    )) {
      if (!visible(self)) continue
      const text = self.querySelector(
        '.tree-item-inner, .suggestion-title, .abele-entry-row__title'
      )
      if (!text) continue
      // The first line of the words themselves: an element box (a clamped block) is not a line.
      const words = document
        .createTreeWalker(text, NodeFilter.SHOW_TEXT, {
          acceptNode: (n) =>
            (n.textContent || '').trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
        })
        .nextNode()
      if (!words) continue
      const range = document.createRange()
      range.selectNodeContents(words)
      const first = range.getClientRects()[0]
      if (!first) continue
      const marks = [
        ...self.querySelectorAll(
          ':scope > .tree-item-icon, :scope > .tree-item-inner .abele-tree-item__glyph svg, :scope > .tree-item-flair-outer .abele-status-dot, :scope > .tree-item-flair-outer .tree-item-flair, :scope > .tree-item-flair-outer svg, :scope > .suggestion-icon svg, :scope > .abele-entry-row__body > .abele-entry-row__codes svg, :scope > .abele-entry-row__body > .abele-entry-row__actions svg'
        ),
      ]
        // Only what is drawn: a hidden code measures at the top of the page.
        .filter(
          (m) =>
            visible(m) &&
            m.getBoundingClientRect().height > 0 &&
            (m.textContent !== '' ||
              m.tagName === 'svg' ||
              m.classList.contains('abele-status-dot'))
        )
      // In a narrow pane an entry's codes join its quiet line under the name, as the row lays
      // them out on purpose: there the first line is not theirs to meet.
      const codes = self.querySelector(':scope > .abele-entry-row__body > .abele-entry-row__codes')
      const wrapped = !!codes && codes.getBoundingClientRect().top >= first.bottom - 1
      for (const m of marks) {
        if (wrapped && codes!.contains(m)) continue
        const off = mid(m.getBoundingClientRect()) - mid(first)
        if (Math.abs(off) > 1.5)
          fails.push(
            `${name(text)}: ${m.classList[0] ?? m.tagName} на ${px(off)} от середины строки`
          )
      }
      const tree = self.closest('[role="tree"]')
      if (!tree) continue
      for (const d of self.querySelectorAll(':scope > .tree-item-flair-outer .abele-status-dot')) {
        const list = columns.get(tree) ?? []
        list.push([name(text), Math.round(d.getBoundingClientRect().left)])
        columns.set(tree, list)
      }
    }
    for (const list of columns.values()) {
      const xs = new Set(list.map(([, x]) => x))
      if (xs.size > 1)
        fails.push(`точки в разных столбцах: ${list.map(([n, x]) => `${n} ${x}`).join(', ')}`)
    }
    rule(
      'Р24',
      'Значки, точки и числа строки — по середине первой строки названия, точки дерева в одном столбце',
      fails
    )
  }

  // Р30–31: a row that lights up under the pointer keeps its words off the edge of the light, and
  // two such rows never touch. Measured on every row that can light up, lit or not: the light is
  // its box. Obsidian's own file list keeps 8px inside and 2px between.
  {
    const f30: string[] = []
    const f31: string[] = []
    const ROW =
      '[role="button"], [role="link"], [role="option"], [role="treeitem"], .tree-item-self.is-clickable, .suggestion-item'
    // A row whose light can be seen: Obsidian's own tree and list rows, and ours drawn rounded.
    // Media cards (a picture to the edge), table rows and Obsidian's own empty-state links are
    // left to their own rules.
    const isRow = (e: Element) =>
      e.matches(ROW) &&
      // A heading that only folds has no light of its own.
      !e.matches(
        'button, .clickable-icon, a, input, label, tr, .empty-state-action, .abele-fold-heading'
      ) &&
      (e.matches('.tree-item-self, .suggestion-item') ||
        parseFloat(cs(e).borderTopLeftRadius) > 0) &&
      !e.querySelector('img, canvas, video') &&
      !cs(e).display.startsWith('inline') &&
      visible(e) &&
      e.getBoundingClientRect().width > 60 &&
      (e.textContent || '').trim() !== ''
    const rows = [...rowsIn.querySelectorAll(ROW)].filter(isRow)
    // A row inside another row is measured on its own; the outer one only by what is its own.
    for (const row of rows) {
      const box = row.getBoundingClientRect()
      const xs: [number, number][] = []
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
      let n: Node | null = walker.nextNode()
      while (n) {
        if (n instanceof Element) {
          if (n !== row && (isRow(n) || n.matches('.clickable-icon, button, input'))) {
            // A nested row or a button keeps its own box; it counts by its box.
            // An overlay laid over the whole row to take its clicks draws nothing of its own.
            if (!isRow(n) && visible(n) && cs(n).position !== 'absolute') {
              const r = n.getBoundingClientRect()
              if (r.width) xs.push([r.left, r.right])
            }
            n = walker.nextSibling() ?? nextOutside(walker, row)
            continue
          }
          // A glyph by its ink, not its box: it is drawn inside the box with a margin.
          if (n.tagName === 'svg' && visible(n)) {
            let l = Infinity
            let r = -Infinity
            for (const shape of n.querySelectorAll(
              'path, circle, rect, line, polyline, polygon, ellipse'
            )) {
              const g = shape as SVGGraphicsElement
              const m = g.getScreenCTM()
              if (!m) continue
              const b = g.getBBox()
              const half = ((parseFloat(cs(g).strokeWidth) || 0) / 2) * Math.abs(m.a)
              l = Math.min(l, m.a * b.x + m.e - half)
              r = Math.max(r, m.a * (b.x + b.width) + m.e + half)
            }
            if (Number.isFinite(l)) xs.push([l, r])
          }
        } else if ((n.textContent || '').trim()) {
          const parent = n.parentElement
          if (parent && visible(parent) && parseFloat(cs(parent).opacity) > 0) {
            // Words cut off by their box count only as far as they show. Cut with an ellipsis,
            // they end at the box's content edge, where the ellipsis is drawn, not in its padding.
            const ps = cs(parent)
            const box0 = ps.overflow !== 'visible' ? parent.getBoundingClientRect() : null
            const inset = ps.textOverflow === 'ellipsis'
            const clip = box0 && {
              left: box0.left + (inset ? parseFloat(ps.paddingLeft) || 0 : 0),
              right: box0.right - (inset ? parseFloat(ps.paddingRight) || 0 : 0),
            }
            const range = document.createRange()
            range.selectNodeContents(n)
            for (const r of range.getClientRects()) {
              const l = clip ? Math.max(r.left, clip.left) : r.left
              const rt = clip ? Math.min(r.right, clip.right) : r.right
              if (rt - l > 0.5) xs.push([l, rt])
            }
          }
        }
        n = walker.nextNode()
      }
      if (!xs.length) continue
      const left = Math.min(...xs.map(([l]) => l)) - box.left
      const right = box.right - Math.max(...xs.map(([, r]) => r))
      if (left < 5.5 || right < 5.5)
        f30.push(`${name(row)}: слева ${px(left)}, справа ${px(right)}`)
      const next = row.nextElementSibling
      // Obsidian's suggestion list touches row to row, so a list drawn as one may too.
      if (
        next &&
        isRow(next) &&
        !row.matches('.suggestion-item, [role="option"], [role="listbox"] *')
      ) {
        const nb = next.getBoundingClientRect()
        const gap = nb.top - box.bottom
        const lined = [row, next].some((e) => parseFloat(cs(e).borderTopWidth) > 0)
        if (nb.top >= box.bottom - 1 && gap < 1.5 && !lined)
          f31.push(`${name(row)} и ${name(next)}: ${px(gap)}`)
      }
    }
    rule('Р30', 'У подсвечиваемой строки текст и значки не ближе 6px к краю подсветки', f30)
    rule('Р31', 'Подсвечиваемые строки не слипаются, между ними от 2px', f31)
  }

  // Р32: things stacked in one column start at one edge as the eye sees it — the ink of a glyph,
  // not its box, which a glyph fills only to a margin and a button pads further; the border of a
  // field; the first letter of words. A step of 1.5 to 8px between neighbours is an accident; a
  // larger one is an indent and left alone.
  {
    const fails: string[] = []
    const inkLeft = (svg: SVGSVGElement) => {
      let left = Infinity
      for (const shape of svg.querySelectorAll(
        'path, circle, rect, line, polyline, polygon, ellipse'
      )) {
        const g = shape as SVGGraphicsElement
        const m = g.getScreenCTM()
        if (!m) continue
        const b = g.getBBox()
        const half = (parseFloat(cs(g).strokeWidth) || 0) / 2
        // The leftmost of the box's corners on screen, less half the stroke drawn around it.
        for (const [x, y] of [
          [b.x, b.y],
          [b.x, b.y + b.height],
        ])
          left = Math.min(left, m.a * x + m.c * y + m.e - half * Math.abs(m.a))
      }
      return left
    }
    const LIT =
      '.tree-item-self, .abele-entry-row, .nav-file-title, .nav-folder-title, .suggestion-item, ' +
      '[role=option], [role=treeitem], [role=tab], [role=button], [role=link], button, ' +
      '.is-active, .is-selected'
    // Where a block visibly starts: its border if it draws one or a fill, else its first ink.
    const edge = (e: Element): number | null => {
      if (!visible(e)) return null
      const c = cs(e)
      // Centred or right-aligned content keeps to its own axis, not to the column's start.
      if (
        /center|right|end/.test(c.textAlign) ||
        /center|flex-end|end|right/.test(c.justifyContent)
      )
        return null
      const r = e.getBoundingClientRect()
      if (!r.width || !r.height) return null
      // A fill the colour of what is behind it (a sticky row kept opaque) draws no edge.
      const behind = (el: Element | null): string => {
        for (let p = el; p; p = p.parentElement) {
          const bg = cs(p).backgroundColor
          if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg
        }
        return 'rgb(255, 255, 255)'
      }
      const draws = (el: Element) => {
        const ec = cs(el)
        const fill = ec.backgroundColor
        return (
          parseFloat(ec.borderLeftWidth) > 0 ||
          (fill !== 'rgba(0, 0, 0, 0)' &&
            fill !== 'transparent' &&
            fill !== behind(el.parentElement))
        )
      }
      // A row's light is no edge of its own either: the picked file in Obsidian's explorer is lit
      // out to the inset its words keep, and those words line up with the rows around it.
      const light = e.matches(LIT) && !(parseFloat(cs(e).borderLeftWidth) > 0)
      if ((draws(e) && !light) || e.matches('input, select, textarea')) return r.left
      // Where its first line starts: the first thing drawn in it, in reading order.
      const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
      let n: Node | null
      while ((n = walker.nextNode())) {
        // A tree's fold arrow hangs in the gutter before its row, as in Obsidian's explorer, and
        // turns as it folds: the words after it are the row's edge.
        if (n instanceof SVGSVGElement && visible(n) && !n.closest('.collapse-icon'))
          return inkLeft(n)
        // A box drawn inside it before any words — a card in a grid, a filled cell of a strip —
        // is where the block is seen to start, not the words inside that box. Not a row's or a
        // tab's light: that comes and goes with the pointer and the choice, and the words in it
        // are what lines up with the rows beside it.
        if (
          n instanceof HTMLElement &&
          n !== e &&
          visible(n) &&
          !cs(n).display.startsWith('inline') &&
          n.getBoundingClientRect().width > 0 &&
          !n.matches(LIT) &&
          draws(n)
        )
          return n.getBoundingClientRect().left
        if (n instanceof Element && n !== e && n.matches('input, select, textarea, button')) {
          const x = edge(n)
          if (x !== null) return x
        } else if (
          n.nodeType === Node.TEXT_NODE &&
          (n.textContent || '').trim() &&
          // Words laid out but not drawn — a code view's sizer for its line numbers — are no edge.
          n.parentElement &&
          cs(n.parentElement).visibility !== 'hidden'
        ) {
          const range = document.createRange()
          range.selectNodeContents(n)
          const first = [...range.getClientRects()].find((x) => x.width > 0)
          if (first) return first.left
        }
      }
      return null
    }
    const seen = new Set<Element>()
    for (const parent of root.querySelectorAll('*')) {
      if (!visible(parent) || seen.has(parent)) continue
      // Lines of code step in by their own indentation.
      if (/mono/i.test(cs(parent).fontFamily) || parent.closest('pre, code, .cm-editor')) continue
      const kids = [...parent.children].filter((k) => {
        if (!visible(k)) return false
        const d = cs(k).display
        return (
          !d.startsWith('inline') && cs(k).position !== 'absolute' && cs(k).position !== 'fixed'
        )
      })
      if (kids.length < 2) continue
      // A column centred on its axis, not lined up on its start.
      const pc = cs(parent)
      if (pc.flexDirection.startsWith('column') && /center|end/.test(pc.alignItems)) continue
      // Rows of one grid of centred cells, a month's weekdays over its days: they line up by
      // the middle of each column, so their first letters start where their widths put them.
      const centredGrid = (k: Element) =>
        cs(k).display === 'grid' &&
        [...k.children].every(
          (c) => cs(c).textAlign === 'center' || /center/.test(cs(c).alignItems)
        )
      if (kids.every(centredGrid)) continue
      // Stacked, not side by side: each starts below the one before.
      const stacked = kids.every(
        (k, i) =>
          !i || k.getBoundingClientRect().top >= kids[i - 1].getBoundingClientRect().bottom - 1
      )
      if (!stacked) continue
      seen.add(parent)
      const edges = kids.map((k) => [k, edge(k)] as const).filter(([, x]) => x !== null)
      for (let i = 1; i < edges.length; i++) {
        const [a, ax] = edges[i - 1]
        const [b, bx] = edges[i]
        const step = Math.abs((bx as number) - (ax as number))
        if (step > 1.5 && step < 8)
          fails.push(`${name(a)} и ${name(b)}: края расходятся на ${px(step)}`)
      }
    }
    rule(
      'Р32',
      'В одной колонке всё начинается с одного видимого края: рисунок значка, рамка поля, буква',
      fails
    )
  }

  // Р33: a glyph button keeps Obsidian's whole box — its padding on every side — and stands
  // apart from what is beside it. A button pressed flat to fit a line, or touching a code next to
  // it, is hard to hit and reads as part of the words.
  {
    const fails: string[] = []
    // Obsidian's own frame — tab strip, view header, phone bars — is the host's, not ours.
    const HOST =
      '.workspace-tab-header-container, .view-header, .mobile-navbar, .workspace-drawer-header, .workspace-ribbon, .status-bar, .titlebar, .modal-close-button'
    for (const btn of rowsIn.querySelectorAll('.clickable-icon')) {
      if (btn.closest(HOST)) continue
      // Buttons that wait for the pointer are laid out all the same: their box is measured too.
      const laidOut = btn.getClientRects().length > 0 && btn.closest('[hidden]') === null
      if (!visible(btn) && !(laidOut && cs(btn).visibility === 'hidden')) continue
      const svg = btn.querySelector('svg')
      if (!svg || btn.textContent?.trim()) continue
      const b = btn.getBoundingClientRect()
      const g = svg.getBoundingClientRect()
      if (!b.width || !g.height) continue
      if (b.height - g.height < 6 || b.width - g.width < 6)
        fails.push(
          `«${btn.getAttribute('aria-label') || btn.className}»: коробка ${px(b.width)}×${px(b.height)} у значка ${px(g.width)}`
        )
      // Words or codes on the same line touching the button's box.
      if (!visible(btn)) continue
      const line = btn.parentElement?.parentElement
      if (!line) continue
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
      let n: Node | null
      while ((n = walker.nextNode())) {
        if (!(n.textContent || '').trim() || btn.contains(n)) continue
        const host = n.parentElement
        if (!host || !visible(host) || host.closest(HOST)) continue
        const range = document.createRange()
        range.selectNodeContents(n)
        // Words cut off with an ellipsis end where their box does, not where the full text would.
        const clip = host.getBoundingClientRect()
        for (const raw of range.getClientRects()) {
          const r = {
            left: Math.max(raw.left, clip.left),
            right: Math.min(raw.right, clip.right),
            top: raw.top,
            bottom: raw.bottom,
            width: raw.width,
          }
          if (!r.width || r.right <= r.left || r.bottom <= b.top || r.top >= b.bottom) continue
          const gap =
            r.right <= b.left ? b.left - r.right : r.left >= b.right ? r.left - b.right : -1
          if (gap < 2) {
            fails.push(
              `«${btn.getAttribute('aria-label') || btn.className}»: вплотную к «${(n.textContent || '').trim().slice(0, 16)}»`
            )
            break
          }
        }
      }
    }
    rule('Р33', 'Кнопка-значок во всю свою коробку и не прилипает к соседним словам', [
      ...new Set(fails),
    ])
  }

  // Р7–8 measured: a heading sits closer to what follows it than to what comes before it, by
  // 1.2 at least; in a row the line under a name sits closer to the name than the next row does.
  // Gaps are taken glyph to glyph, the way the eye reads them.
  {
    const f7: string[] = []
    const f8: string[] = []
    const inkTop = (e: Element) => glyphs(firstLine(e)).top
    const inkBottom = (e: Element) => glyphs(lastLine(e)).bottom
    // The element holding the first or last words drawn in a block, so a gap is measured to
    // letters and not to a box's padding.
    function firstLine(e: Element): Element {
      const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) =>
          (n.textContent || '').trim() && n.parentElement && visible(n.parentElement)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP,
      })
      return w.nextNode()?.parentElement ?? e
    }
    function lastLine(e: Element): Element {
      const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) =>
          (n.textContent || '').trim() && n.parentElement && visible(n.parentElement)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP,
      })
      let last: Node | null = null
      let n: Node | null
      while ((n = w.nextNode())) last = n
      return last?.parentElement ?? e
    }
    const HEAD =
      '.abele-group-heading, .abele-timeline__date-indicator, .setting-item-heading, .abele-section__header'
    for (const head of root.querySelectorAll(HEAD)) {
      if (!visible(head)) continue
      // A heading's own block: the heading and what follows it inside the same parent.
      const block = head.parentElement
      const next = head.nextElementSibling ?? block?.nextElementSibling
      const prev = (head.previousElementSibling ?? block?.previousElementSibling) as Element | null
      if (!next || !prev || !visible(next) || !visible(prev)) continue
      const below = inkTop(next) - inkBottom(head)
      const above = inkTop(head) - inkBottom(prev)
      if (below <= 0 || above <= 0) continue
      if (above < below * 1.2)
        f7.push(`${name(head)}: до своего ${px(below)}, до предыдущего ${px(above)}`)
    }
    for (const row of rowsIn.querySelectorAll('.abele-entry-row')) {
      if (!visible(row)) continue
      const title = row.querySelector(':scope .abele-entry-row__title')
      const meta = row.querySelector(':scope .abele-entry-row__meta')
      const next = row.nextElementSibling
      if (!title || !meta || !visible(meta) || !next || !next.matches('.abele-entry-row')) continue
      const inner = inkTop(meta) - inkBottom(title)
      const between = inkTop(next) - inkBottom(row)
      if (between > 0 && inner * 1.2 > between)
        f8.push(`${name(title)}: подпись в ${px(inner)}, следующая строка в ${px(between)}`)
    }
    // Р34: a check or a glyph at the start of a row belongs to its words: it sits closer to them
    // than to whatever stands above the row — the heading over the list or the row before.
    const f34: string[] = []
    for (const row of rowsIn.querySelectorAll('.abele-entry-row')) {
      if (!visible(row)) continue
      const lead = row.querySelector(':scope > .abele-entry-row__leading')
      const title = row.querySelector(':scope .abele-entry-row__title')
      // The mark nearest the words: a picture after a check is what the words sit beside.
      const marks = lead ? [...lead.querySelectorAll('input, svg, img, .abele-file-thumb')] : []
      const mark = marks.filter((m) => !marks.some((o) => o !== m && o.contains(m))).pop()
      const prev = row.previousElementSibling ?? row.parentElement?.previousElementSibling
      if (!lead || !title || !mark || !visible(mark) || !prev || !visible(prev)) continue
      const box = mark.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(firstLine(title))
      const words = [...range.getClientRects()].find((r) => r.width > 0)
      if (!words) continue
      const side = words.left - box.right
      const above = box.top - inkBottom(prev)
      if (side > 0 && above > 0 && above < side * 1.2)
        f34.push(`${name(title)}: до своих слов ${px(side)}, до того, что выше, ${px(above)}`)
    }
    // Р35: the rows under a group heading keep one rhythm with it: the first row is no closer to
    // the heading than the rows are to each other, or the first one reads as the heading's own
    // and the rest as another group.
    const f35: string[] = []
    for (const head of rowsIn.querySelectorAll('.abele-group-heading')) {
      if (!visible(head)) continue
      const rows: Element[] = []
      for (let n = head.nextElementSibling; n && rows.length < 2; n = n.nextElementSibling) {
        const row = n.matches('.abele-entry-row') ? n : n.querySelector('.abele-entry-row')
        if (!row) break
        if (visible(row)) rows.push(row)
      }
      if (rows.length < 2) continue
      const below = inkTop(rows[0]) - inkBottom(head)
      const between = inkTop(rows[1]) - inkBottom(rows[0])
      if (below > 0 && between > 0 && below < between * 0.9)
        f35.push(`${name(head)}: до первой строки ${px(below)}, между строками ${px(between)}`)
    }
    rule('Р35', 'Под заголовком группы первая строка не ближе к нему, чем строки друг к другу', f35)

    // Р36: rows of two lines and more are told apart by the eye: a hairline or a faint fill marks
    // where one entry ends and the next begins. Whitespace alone ran the line under one name into
    // the name of the next.
    const f36: string[] = []
    for (const row of rowsIn.querySelectorAll('.abele-entry-row + .abele-entry-row')) {
      const prev = row.previousElementSibling as Element
      if (!visible(row) || !visible(prev)) continue
      // Two lines and more as drawn: a quiet line under the name, or codes moved under it.
      const tall = (r: Element) => {
        const title = r.querySelector(':scope .abele-entry-row__title')
        const lh = title ? parseFloat(cs(title).lineHeight) || 20 : 20
        return r.getBoundingClientRect().height > lh * 1.6
      }
      if (!tall(row) && !tall(prev)) continue
      const line = cs(row, '::before')
      const drawn =
        parseFloat(cs(row).borderTopWidth) > 0 ||
        (line.content !== 'none' && parseFloat(line.borderTopWidth) > 0) ||
        cs(row).backgroundColor !== cs(prev).backgroundColor
      if (!drawn) f36.push(`${name(prev)} и ${name(row)}: между записями ни линии, ни фона`)
    }
    rule('Р36', 'Записи в две строки и больше разделены линией или фоном', f36.slice(0, 6))
    rule('Р7', 'Заголовок ближе к своему, чем к предыдущему, в 1.2 раза и больше', f7)
    rule(
      'Р34',
      'Галочка или значок в начале строки ближе к своим словам, чем к тому, что над строкой',
      f34
    )
    rule('Р8', 'Подпись под названием ближе к нему, чем следующая строка', f8)

    // Р37: no bar down one side of a box that is coloured or has rounded corners — the look of a
    // generated page, not of Obsidian. A grey square rule beside a quote or a nesting is Obsidian's
    // own and stays. Colour belongs in a dot, a glyph or a wash.
    const f37: string[] = []
    const tinted = (c: string) => {
      const [r, g, b] = (c.match(/[\d.]+/g) ?? []).map(Number)
      return Math.max(r, g, b) - Math.min(r, g, b) > 40
    }
    for (const el of rowsIn.querySelectorAll('*')) {
      if (!visible(el)) continue
      const st = cs(el)
      for (const [side, others, corners] of [
        ['Left', ['Right', 'Top', 'Bottom'], ['TopLeft', 'BottomLeft']],
        ['Right', ['Left', 'Top', 'Bottom'], ['TopRight', 'BottomRight']],
      ] as const) {
        const w = parseFloat(st[`border${side}Width`])
        if (w < 2 || st[`border${side}Style`] === 'none') continue
        if (others.some((o) => parseFloat(st[`border${o}Width`]) >= w)) continue
        const round = corners.some((c) => parseFloat(st[`border${c}Radius`]) > 0)
        const colour = tinted(st[`border${side}Color`])
        if (round || colour)
          f37.push(
            `${name(el)}: полоса сбоку ${w}px${colour ? ', цветная' : ''}${round ? ', со скруглением' : ''}`
          )
      }
      // The same bar drawn by an inset shadow offset to one side only, as a line's edge once was.
      for (const m of st.boxShadow.matchAll(
        /(rgba?\([^)]*\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?(?:\s+(-?[\d.]+)px)?\s+inset/g
      )) {
        const [, colour, x, y, blur = '0', spread = '0'] = m
        const w = Math.abs(parseFloat(x))
        if (w < 2 || parseFloat(y) !== 0 || parseFloat(blur) !== 0 || parseFloat(spread) !== 0)
          continue
        if (tinted(colour)) f37.push(`${name(el)}: полоса сбоку тенью ${w}px, цветная`)
      }
    }
    rule('Р37', 'Нет цветной полосы сбоку и полосы сбоку со скруглением', f37)

    // Р39: a window without a frame draws its own buttons over the page: macOS's three lights in the
    // top left corner. A dialog laid over the whole window keeps its words and controls out of
    // there, as Obsidian's tab bar does; in native full screen there are no lights to avoid.
    const f39: string[] = []
    const bodyEl = document.body
    if (
      bodyEl.classList.contains('mod-macos') &&
      bodyEl.classList.contains('is-hidden-frameless') &&
      !bodyEl.classList.contains('is-fullscreen')
    ) {
      const lights = { right: 78, bottom: 38 }
      for (const el of document.querySelectorAll('.modal *')) {
        if (!visible(el)) continue
        // The words by their glyphs, a control by its box: a title's padding may lie under the lights.
        const text = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent!.trim())
        if (!text && !el.matches('button, .clickable-icon, input, select')) continue
        const range = document.createRange()
        if (text) range.selectNodeContents(text)
        const r = text ? range.getBoundingClientRect() : el.getBoundingClientRect()
        if (r.left < lights.right && r.top < lights.bottom && r.right > 0 && r.bottom > 0)
          f39.push(`${name(el)}: под кнопками окна, ${px(r.left)} слева, ${px(r.top)} сверху`)
      }
    }
    rule('Р39', 'Окно на всё окно не залезает под кнопки окна macOS', f39.slice(0, 6))
  }

  return { rules: out, tables }

  // The node after `from`'s subtree, staying inside `root`.
  function nextOutside(walker: TreeWalker, root: Node): Node | null {
    let node: Node | null = walker.currentNode
    while (node && node !== root) {
      if (node.nextSibling) {
        walker.currentNode = node.nextSibling
        return node.nextSibling
      }
      node = node.parentNode
    }
    return null
  }
}
