/**
 * A script's CSS must not reach past its own view.
 *
 * Text in, text out: the scoper walks braces and prefixes each selector, recursing into the
 * at-rules that hold rules and leaving alone the ones that hold declarations. No CSSOM: the
 * browsers this runs in disagree about nesting and happy-dom parses no stylesheet at all.
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

  it('leaves keyframes, font-face and root selectors alone', () => {
    const kf = '@keyframes spin { from { r: 0 } to { r: 1 } }'
    expect(squash(scopeCss(kf, P))).toBe(kf)
    expect(squash(scopeCss('@font-face { font-family: x }', P))).toBe(
      '@font-face { font-family: x }'
    )
    expect(squash(scopeCss(':root { --c: red } body { m: 0 } html { p: 0 }', P))).toBe(
      ':root { --c: red } body { m: 0 } html { p: 0 }'
    )
  })

  it('strips comments and passes statements through', () => {
    expect(squash(scopeCss('/* c */ @import url(x.css); .a { b: 1 }', P))).toBe(
      `@import url(x.css); ${P} .a { b: 1 }`
    )
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
    expect(squash(scopeCss('body { m: 0 }', P))).toBe('body { m: 0 }')
  })
})
