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
