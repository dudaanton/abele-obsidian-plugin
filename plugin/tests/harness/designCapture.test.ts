import { afterEach, describe, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import { captureDesign, designCaptureExpression } from '../helpers/designCapture'
import { lintDesign } from '../helpers/designLint'

function fixture() {
  document.body.innerHTML = `<div id="surface" style="--size-4-1: 4px; --size-2-1: 2px; color: rgb(30,30,30); background: rgb(255,255,255)">
    <article data-design-row data-design-kind="record"><svg data-design-icon></svg>
      <span data-design-level="title">Example <b>record</b></span>
      <span data-design-level="meta">Supporting facts</span><button data-design-action>Open</button>
      <div style="display:none">Hidden information</div>
    </article></div>`
  for (const [i, el] of [...document.querySelectorAll('*')].entries()) {
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(8 + i, 8 + i, 160, 24))
  }
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
    const inline = (el as HTMLElement).style
    return {
      display: inline.display || 'block',
      visibility: inline.visibility || 'visible',
      opacity: '1',
      overflowX: 'visible',
      overflowY: 'visible',
      fontSize: '14px',
      fontWeight: '400',
      fontFamily: 'sans-serif',
      lineHeight: '20px',
      color: 'rgb(30, 30, 30)',
      backgroundColor: 'rgb(255, 255, 255)',
      paddingTop: '4px',
      paddingRight: '4px',
      paddingBottom: '4px',
      paddingLeft: '4px',
      marginTop: '0px',
      marginRight: '0px',
      marginBottom: '0px',
      marginLeft: '0px',
      rowGap: 'normal',
      columnGap: 'normal',
      width: inline.width.includes('--size-4-1') ? '4px' : '2px',
      getPropertyValue: (key: string) => inline.getPropertyValue(key),
    } as CSSStyleDeclaration
  })
  vi.spyOn(document, 'createRange').mockImplementation(
    () =>
      ({
        setStart: vi.fn(),
        setEnd: vi.fn(),
        getClientRects: () => [new DOMRect(40, 20, 40, 16), new DOMRect(40, 40, 40, 16)],
      }) as unknown as Range
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    measureText: () => ({ fontBoundingBoxAscent: 12, fontBoundingBoxDescent: 4 }),
  } as unknown as CanvasRenderingContext2D)
}
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})
describe('renderer design capture', () => {
  it('captures visible boxes, first Range line, baseline, roles, typography and inherited theme scale', () => {
    fixture()
    const s = captureDesign('#surface')
    expect(s.scale).toEqual([0, 2, 4])
    expect(s.elements.some((e) => e.text.includes('Hidden'))).toBe(false)
    const title = s.elements.find((e) => e.level === 'title')!
    expect(title).toMatchObject({
      text: 'Example record',
      role: 'text',
      kind: 'record',
      slot: 'text',
      firstLine: { x: 40, y: 20, width: 40, height: 16 },
      baseline: 32,
      padding: [4, 4, 4, 4],
    })
    expect(title.lines).toHaveLength(4)
    expect(s.elements.find((e) => e.role === 'icon')?.slot).toBe('icon')
    expect(s.elements.find((e) => e.role === 'control')?.selector).toBe('button')
    expect(document.querySelector('#surface')?.children).toHaveLength(1)
  })
  it('detects painted Unicode disclosures even when excluded from the semantic text Range', () => {
    fixture()
    const meta = document.querySelector('[data-design-level="meta"]')!
    meta.textContent = '\u25b6'
    meta.classList.add('collapse-icon')
    meta.setAttribute('aria-hidden', 'true')
    expect(lintDesign(captureDesign('#surface')).some((v) => v.rule === 'text-triangle')).toBe(true)
  })
  it('measures opacity-only native hover icons without including transparent icons in the visible container', () => {
    fixture()
    document
      .querySelector('#surface')!
      .insertAdjacentHTML(
        'beforebegin',
        '<div class="backlink-pane"><div class="tree-item-self"><span class="collapse-icon"><svg></svg></span><div class="tree-item-inner">Linked entries</div></div></div>'
      )
    for (const el of document.querySelectorAll('*'))
      if (!vi.isMockFunction(el.getBoundingClientRect))
        vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 16, 16))
    const base = vi.mocked(window.getComputedStyle).getMockImplementation()!
    vi.mocked(window.getComputedStyle).mockImplementation(
      (el) => ({ ...base(el), opacity: el.matches('svg') ? '0' : '1' }) as CSSStyleDeclaration
    )
    const s = captureDesign('#surface')
    expect(s.elements.some((e) => e.role === 'icon')).toBe(false)
    expect(s.native?.metrics.iconSize).toBe(16)
    expect(s.native?.elements?.find((e) => e.role === 'icon')?.paintVisible).toBe(false)
  })
  it('composites translucent backgrounds before judging colour hierarchy in a dark theme', () => {
    fixture()
    const base = vi.mocked(window.getComputedStyle).getMockImplementation()!
    vi.mocked(window.getComputedStyle).mockImplementation(
      (el) =>
        ({
          ...base(el),
          backgroundColor:
            el.id === 'surface'
              ? 'rgb(20, 20, 20)'
              : el.hasAttribute('data-design-row')
                ? 'rgba(255, 255, 255, 0.2)'
                : 'rgba(0, 0, 0, 0)',
        }) as CSSStyleDeclaration
    )
    expect(captureDesign('#surface').elements.find((e) => e.level === 'title')?.background).toBe(
      'rgb(67, 67, 67)'
    )
  })
  it('prefers a fully measurable native result row over an iconless section heading', () => {
    fixture()
    document
      .querySelector('#surface')!
      .insertAdjacentHTML(
        'beforebegin',
        '<div class="backlink-pane"><div class="tree-item-self"><div class="tree-item-inner">Linked entries</div></div><div class="tree-item"><div class="tree-item-self search-result-file-title"><svg></svg><div class="tree-item-inner">Result entry</div></div></div></div>'
      )
    for (const el of document.querySelectorAll('*'))
      if (!vi.isMockFunction(el.getBoundingClientRect))
        vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 16, 16))
    const s = captureDesign('#surface')
    expect(s.native?.metrics.iconSize).toBe(16)
    expect(s.native?.kind).toBe('search-result')
    expect(s.native?.metrics.iconTextGap).toBeTypeOf('number')
  })
  it('prefers the Backlinks reference over an earlier indented file explorer row', () => {
    fixture()
    document
      .querySelector('#surface')!
      .insertAdjacentHTML(
        'beforebegin',
        '<div class="nav-file-title"><span class="nav-file-title-content">File entry</span></div><div class="backlink-pane"><div class="tree-item-self"><div class="tree-item-inner">Linked entries</div></div></div>'
      )
    for (const el of document.querySelectorAll('*'))
      if (!vi.isMockFunction(el.getBoundingClientRect))
        vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 160, 24))
    const s = captureDesign('#surface')
    expect(s.native?.elements?.[0].selector).toContain('tree-item-self')
    expect(s.native?.variants).toHaveProperty('backlinks-section')
  })
  it('uses a top-level file reference regardless of expanded nested rows and their icon completeness', () => {
    fixture()
    document.querySelector('#surface')!.insertAdjacentHTML(
      'beforebegin',
      `<div class="nav-folder"><div class="tree-item-children">
        <div class="tree-item-self nav-file-title" data-path="Sample/Deep/nested.md"><svg></svg><span class="nav-file-title-content">Nested entry</span></div>
      </div></div>
      <div class="tree-item-self nav-file-title" data-path="sample.md"><span class="nav-file-title-content">Root entry</span></div>`
    )
    for (const el of document.querySelectorAll('*'))
      if (!vi.isMockFunction(el.getBoundingClientRect))
        vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 160, 24))
    const base = vi.mocked(window.getComputedStyle).getMockImplementation()!
    vi.mocked(window.getComputedStyle).mockImplementation(
      (el) =>
        ({
          ...base(el),
          paddingLeft: el.getAttribute('data-path')?.includes('/') ? '58px' : '24px',
        }) as CSSStyleDeclaration
    )
    const expanded = captureDesign('#surface')
    expect(expanded.native?.kind).toBe('nav-file:0')
    expect(expanded.native?.metrics.padding?.[3]).toBe(24)
    expect(expanded.native?.variants?.['nav-file:2'].padding?.[3]).toBe(58)
    document.querySelector('.tree-item-children')!.setAttribute('style', 'display:none')
    const collapsed = captureDesign('#surface')
    expect(collapsed.native?.kind).toBe(expanded.native?.kind)
    expect(collapsed.native?.metrics).toEqual(expanded.native?.metrics)
    expect(collapsed.native?.elements).toEqual(expanded.native?.elements)
    // An explicit selector still allows a deliberate depth-specific comparison.
    document.querySelector('.tree-item-children')!.removeAttribute('style')
    expect(
      captureDesign('#surface', { nativeSelector: '[data-path="Sample/Deep/nested.md"]' }).native
        ?.kind
    ).toBe('nav-file:2')
  })
  it('does not silently substitute an indented file when no top-level native reference is visible', () => {
    fixture()
    document
      .querySelector('#surface')!
      .insertAdjacentHTML(
        'beforebegin',
        '<div class="tree-item-self nav-file-title" data-path="Sample/nested.md"><span class="nav-file-title-content">Nested entry</span></div>'
      )
    for (const el of document.querySelectorAll('.nav-file-title, .nav-file-title-content'))
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 160, 24))
    expect(captureDesign('#surface').native).toBeUndefined()
    expect(
      lintDesign(captureDesign('#surface'), { requireNative: true }).map((v) => v.rule)
    ).toContain('native-reference-missing')
  })
  it('classifies a compound native kit row once, without treating its wrapper or edge glyph as text', () => {
    fixture()
    document.querySelector('#surface')!.innerHTML =
      `<article class="tree-item abele-list-row"><div class="tree-item-self abele-list-row__line"><span class="abele-list-row__leading"><svg class="lucide-file-text"></svg></span><div class="tree-item-inner abele-list-row__content"><button class="abele-list-row__main"><span class="abele-list-row__title-line"><span class="abele-list-row__title-text">sample</span><span class="abele-list-row__extension">.md</span></span><span class="abele-meta-line">Work</span></button><div class="abele-list-row__actions"><button class="abele-disclosure__control"><span class="collapse-icon"><svg></svg></span></button></div></div></div></article>`
    for (const el of document.querySelectorAll('#surface *'))
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 20, 100, 20))
    const s = captureDesign('#surface')
    const titles = s.elements.filter((e) => e.level === 'title')
    expect(titles).toHaveLength(1)
    expect(titles[0].text).toBe('sample .md')
    expect(titles[0].kind).toBe('list-row')
    expect(
      s.elements.find((e) => e.selector.includes('abele-list-row__content'))?.level
    ).toBeUndefined()
    const edge = s.elements.find((e) => e.selector.includes('abele-disclosure__control'))!
    expect(edge.level).toBeUndefined()
    expect(edge.slot).toBeUndefined()
    expect(s.elements.find((e) => e.selector === 'svg' && e.parent)?.slot).toBe('action')
    expect(s.elements.find((e) => e.selector === 'svg.lucide-file-text')?.iconRole).toBe('content')
  })
  it('measures the whole event metadata band and standalone row timestamp, not the inline actor fragment alone', () => {
    fixture()
    document.querySelector('#surface')!.innerHTML =
      `<div class="abele-list-row__title"><span class="abele-relative-time">Today</span><div class="abele-event-list__meta"><span class="abele-meta-line">A reader</span><span class="abele-relative-time">Yesterday</span></div></div>`
    for (const el of document.querySelectorAll('#surface *'))
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 20, 100, 20))
    expect(
      captureDesign('#surface')
        .elements.filter((e) => e.level === 'meta')
        .map((e) => e.text)
    ).toEqual(['Today', 'A reader Yesterday'])
  })
  it('does not classify a subordinate recovery glyph as the row leading icon', () => {
    fixture()
    document.querySelector('#surface')!.innerHTML =
      '<article class="abele-list-row"><div class="tree-item-self abele-list-row__line"><span class="abele-list-row__leading"><svg class="file"></svg></span><div class="abele-list-row__recovery"><button><svg class="retry"></svg>Retry</button></div></div></article>'
    for (const el of document.querySelectorAll('#surface *'))
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 20, 100, 20))
    const s = captureDesign('#surface')
    expect(s.elements.find((e) => e.selector === 'svg.file')?.slot).toBe('icon')
    expect(s.elements.find((e) => e.selector === 'svg.retry')?.slot).toBeUndefined()
  })
  it('keeps an image fallback glyph inside its thumbnail rather than treating it as a row leading icon', () => {
    fixture()
    document.querySelector('#surface')!.innerHTML =
      '<article class="abele-list-row"><div class="tree-item-self abele-list-row__line"><span class="abele-list-row__leading"><span class="abele-image-thumbnail"><svg class="fallback"></svg></span></span></div></article>'
    for (const el of document.querySelectorAll('#surface *'))
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 20, 64, 64))
    expect(
      captureDesign('#surface').elements.find((e) => e.selector === 'svg.fallback')?.slot
    ).toBeUndefined()
  })
  it('records separate comparison scopes for a source history nested in a file row', () => {
    fixture()
    document.querySelector('#surface')!.innerHTML =
      '<article class="abele-list-row"><div class="tree-item-self abele-list-row__line"><div class="abele-list-row__detail"><ol class="abele-event-list"><li><article class="abele-list-row"><div class="tree-item-self abele-list-row__line"></div></article></li></ol></div></div></article>'
    for (const el of document.querySelectorAll('#surface *'))
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 20, 100, 20))
    const s = captureDesign('#surface'),
      rows = s.elements.filter((e) => e.selector === 'div.tree-item-self.abele-list-row__line')
    expect(rows).toHaveLength(2)
    expect(rows[0].rowScope).not.toBe(rows[1].rowScope)
    expect(rows[1].rowScope).toBe(s.elements.find((e) => e.selector === 'ol.abele-event-list')!.id)
  })
  it('does not make a static tree label into a touch action', () => {
    fixture()
    document
      .querySelector('[data-design-row]')!
      .insertAdjacentHTML('beforeend', '<div role="treeitem">Read only</div>')
    const el = document.querySelector('[role="treeitem"]')!
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 20, 100, 20))
    expect(captureDesign('#surface').elements.find((e) => e.selector === 'div')?.role).not.toBe(
      'control'
    )
  })
  it('measures native search/select padding in an independent host-only context and retains modified actual insets', () => {
    fixture()
    document.querySelector('#surface')!.innerHTML =
      '<div class="abele-obsidian-search"><div class="search-input-container"><input type="search" /></div></div><select class="dropdown"><option>Work</option></select>'
    for (const el of document.querySelectorAll('#surface *'))
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 20, 100, 44))
    const base = vi.mocked(window.getComputedStyle).getMockImplementation()!
    vi.mocked(window.getComputedStyle).mockImplementation(
      (el) =>
        ({
          ...base(el),
          paddingLeft: el.matches('input')
            ? el.closest('.abele-obsidian-search')
              ? '35px'
              : '30px'
            : el.matches('select')
              ? '10.4px'
              : '4px',
        }) as CSSStyleDeclaration
    )
    const s = captureDesign('#surface')
    expect(s.elements.find((e) => e.selector === 'input')?.nativePadding?.[3]).toBe(30)
    expect(s.elements.find((e) => e.selector === 'input')?.padding[3]).toBe(35)
    expect(s.elements.find((e) => e.selector === 'select.dropdown')?.nativePadding?.[3]).toBe(10.4)
    expect(document.querySelectorAll('[data-design-native-probe]')).toHaveLength(0)
  })
  it('omits hidden native measuring clones from paint and overflow, but retains ordinary clipped content', () => {
    fixture()
    document.querySelector('#surface')!.innerHTML =
      '<div class="abele-obsidian-dropdown"><select class="dropdown"><option>Work</option></select><select class="dropdown is-measuring" style="visibility:hidden"><option>Work</option></select></div>'
    for (const el of document.querySelectorAll('#surface *'))
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 20, 100, 44))
    const s = captureDesign('#surface')
    expect(s.elements.some((e) => e.selector.includes('is-measuring'))).toBe(false)
  })
  it('classifies native tree text and content icon separately from the collapse hit gutter', () => {
    fixture()
    document.querySelector('#surface')!.innerHTML =
      '<div class="tree-item-self abele-tree-item__self"><span class="collapse-icon"><svg class="collapse"></svg></span><div class="tree-item-inner abele-tree-item__inner"><span class="abele-tree-item__glyph"><svg class="folder"></svg></span><span class="abele-tree-item__text">Work</span></div></div>'
    for (const el of document.querySelectorAll('#surface *'))
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 20, 100, 44))
    const s = captureDesign('#surface')
    expect(s.elements.filter((e) => e.level === 'title').map((e) => e.selector)).toEqual([
      'span.abele-tree-item__text',
    ])
    expect(s.elements.find((e) => e.selector === 'svg.collapse')?.slot).toBeUndefined()
    expect(s.elements.find((e) => e.selector === 'svg.folder')?.slot).toBe('icon')
    expect(
      s.elements.find((e) => e.selector.includes('abele-tree-item__self'))?.nativeRow
    ).toBeDefined()
  })
  it('captures only painted header title fragments so a close button over blank header space is not an overlap', () => {
    fixture()
    document.querySelector('#surface')!.innerHTML =
      '<div class="modal-header"><div class="modal-title">Title</div></div>'
    for (const el of document.querySelectorAll('#surface *'))
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 20, 300, 44))
    const base = vi.mocked(window.getComputedStyle).getMockImplementation()!
    vi.mocked(window.getComputedStyle).mockImplementation(
      (el) =>
        ({
          ...base(el),
          backgroundColor: el.matches('.modal-header') ? 'rgba(0, 0, 0, 0)' : 'rgb(255, 255, 255)',
        }) as CSSStyleDeclaration
    )
    const header = captureDesign('#surface').elements.find(
      (e) => e.selector === 'div.modal-header'
    )!
    expect(header.fragments?.[0]).toEqual({ x: 40, y: 20, width: 40, height: 16 })
  })
  it('measures the entire compound status band including its decorative native glyph', () => {
    fixture()
    document.querySelector('#surface')!.innerHTML =
      '<div class="abele-list-row__state"><span class="abele-list-row__status-icon" aria-hidden="true"><svg></svg></span><span>Working</span></div>'
    for (const el of document.querySelectorAll('#surface *'))
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 20, 16, 16))
    expect(captureDesign('#surface').elements.find((e) => e.level === 'meta')?.firstLine?.x).toBe(
      20
    )
  })
  it('recognizes a clamped quote only with its own labelled accessible full-text disclosure', () => {
    fixture()
    document.querySelector('#surface')!.innerHTML =
      '<figure class="abele-quote"><blockquote id="sample-quote" class="abele-quote__text_preview">Full passage</blockquote><button aria-label="Expand quote" aria-controls="sample-quote" aria-expanded="false">Expand quote</button></figure>'
    for (const el of document.querySelectorAll('#surface *'))
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 20, 100, 44))
    expect(
      captureDesign('#surface').elements.find((e) => e.selector.includes('blockquote'))
        ?.fullTextAvailable
    ).toBe(true)
    document.querySelector('button[aria-controls]')!.removeAttribute('aria-controls')
    expect(
      captureDesign('#surface').elements.find((e) => e.selector.includes('blockquote'))
        ?.fullTextAvailable
    ).toBe(false)
  })
  it('throws on absent containers rather than reporting a vacuous pass', () => {
    fixture()
    expect(() => captureDesign('#missing')).toThrow('No visible')
  })
  it('is executable as source text without module dependencies', () => {
    fixture()
    const s = runInNewContext(designCaptureExpression('#surface'), { document, NodeFilter, Node })
    expect(s.elements.some((e: { level: string }) => e.level === 'title')).toBe(true)
  })
})
