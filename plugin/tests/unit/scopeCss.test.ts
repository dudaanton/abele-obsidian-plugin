/**
 * A script's CSS must not reach past its own view.
 *
 * Text in, text out: the scoper walks braces and prefixes each selector, recursing into the
 * at-rules that hold rules and leaving alone the ones that hold declarations. A selector that
 * names the document itself becomes the view's root. No CSSOM: the browsers this runs in
 * disagree about nesting and happy-dom parses no stylesheet at all.
 */
import { describe, it, expect } from 'vitest'
import { scopeCss } from '@/scripting/view/scopeCss'

const P = '.abele-script-view[data-id="v1"]'
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

describe('scopeCss', () => {
  it('prefixes a plain rule', () => {
    expect(squash(scopeCss('.post { color: red; }', P))).toBe(`${P} .post { color: red; }`)
  })

  it('prefixes every selector of a list', () => {
    expect(squash(scopeCss('h1, .a > .b { margin: 0 }', P))).toBe(
      `${P} h1, ${P} .a > .b { margin: 0 }`
    )
  })

  it('recurses into media and supports blocks', () => {
    const out = squash(scopeCss('@media (max-width: 600px) { .a { x: 1 } .b { y: 2 } }', P))
    expect(out).toBe(`@media (max-width: 600px) { ${P} .a { x: 1 } ${P} .b { y: 2 } }`)
    expect(squash(scopeCss('@supports (display: grid) { .g { display: grid } }', P))).toContain(
      `${P} .g`
    )
  })

  it('leaves keyframes and font-face alone', () => {
    const kf = '@keyframes spin { from { r: 0 } to { r: 1 } }'
    expect(squash(scopeCss(kf, P))).toBe(kf)
    expect(squash(scopeCss('@font-face { font-family: x }', P))).toBe(
      '@font-face { font-family: x }'
    )
  })

  it('makes :root, html and body the view root rather than letting them out', () => {
    // `body { display: none }` emitted as written would blank Obsidian; a custom property on
    // `:root` becomes one on the view, which is what the script meant by it.
    expect(squash(scopeCss(':root { --c: red } body { m: 0 } html { p: 0 }', P))).toBe(
      `${P} { --c: red } ${P} { m: 0 } ${P} { p: 0 }`
    )
    expect(squash(scopeCss('html, .a { m: 0 }', P))).toBe(`${P}, ${P} .a { m: 0 }`)
    expect(squash(scopeCss('@media (x) { body { m: 0 } }', P))).toBe(`@media (x) { ${P} { m: 0 } }`)
  })

  it('strips comments and passes statements through', () => {
    expect(squash(scopeCss('/* c */ @import url(x.css); .a { b: 1 }', P))).toBe(
      `@import url(x.css); ${P} .a { b: 1 }`
    )
  })

  it('can address the scope root and its descendants without matching adjacent app elements', () => {
    const host = document.createElement('div')
    host.setAttribute('data-deck-id', 'sample')
    const slide = document.createElement('section'),
      title = document.createElement('h1')
    slide.className = 'abele-slide sample-accent'
    slide.append(title)
    host.append(slide)
    const outside = document.createElement('div')
    outside.className = 'sample-neighbour'
    host.append(outside)
    const prefix = '[data-deck-id="sample"] .abele-slide'
    const scoped = scopeCss(
      '.sample-accent { opacity: .5 } .sample-accent h1 { opacity: .8 } .sample-accent + .sample-neighbour { opacity: 0 }',
      prefix,
      { includeRoot: true }
    )
    const selectors = [...scoped.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim())
    expect([...host.querySelectorAll(selectors[0])]).toContain(slide)
    expect([...host.querySelectorAll(selectors[1])]).toContain(title)
    expect([...host.querySelectorAll(selectors[2])]).not.toContain(outside)
    expect(
      scopeCss('.sample-accent::before { content: "{},;" }', prefix, { includeRoot: true })
    ).toContain(':where(')
  })

  it('does not split CSS strings, attribute values or functional selector lists as structure', () => {
    const source =
      '.a:is(.one, .two), [data-label="x,y"] { content: "}; .outside { color: red; }"; background: url("sample,a.svg"); }'
    const scoped = scopeCss(source, P)
    expect(scoped).toContain(`${P} .a:is(.one, .two), ${P} [data-label="x,y"]`)
    expect(scoped).toContain('content: "}; .outside { color: red; }";')
  })

  it('does not throw on unbalanced braces and keeps what parsed', () => {
    expect(squash(scopeCss('.a { b: 1 } .c { d: 2', P))).toBe(`${P} .a { b: 1 }`)
  })

  it('recurses into a block at-rule it does not know to hold declarations', () => {
    expect(squash(scopeCss('@starting-style { .a { x: 1 } }', P))).toBe(
      `@starting-style { ${P} .a { x: 1 } }`
    )
    expect(squash(scopeCss('@scope (.card) { .a { x: 1 } }', P))).toContain(`${P} .a`)
    const webkit = '@-webkit-keyframes spin { from { r: 0 } }'
    expect(squash(scopeCss(webkit, P))).toBe(webkit)
    expect(squash(scopeCss('@counter-style t { system: cyclic }', P))).toBe(
      '@counter-style t { system: cyclic }'
    )
  })

  it('prefixes a descendant of body or html instead of letting it out', () => {
    expect(squash(scopeCss('body .post { m: 0 }', P))).toBe(`${P} body .post { m: 0 }`)
    expect(squash(scopeCss('html.theme-dark .post { m: 0 }', P))).toBe(
      `${P} html.theme-dark .post { m: 0 }`
    )
    expect(squash(scopeCss('body { m: 0 }', P))).toBe(`${P} { m: 0 }`)
  })
})
