import { readFileSync } from 'node:fs'
import { compileString } from 'sass-embedded'
import postcss from 'postcss'
import { expect, it } from 'vitest'

it('keeps the title geometry identical in normal, hover and focus states', () => {
  const css = postcss.parse(
    compileString(readFileSync('src/components/calendarSmall.scss', 'utf8')).css
  )
  const title = '.abele-calendar__header .abele-calendar__header-month-year'
  const geometry = ['padding', 'border', 'font-size', 'font-weight', 'margin-inline-start']
  const declarations = (selector: string) => {
    const values: Record<string, string> = {}
    css.walkRules((rule) => {
      if (!rule.selectors.includes(selector)) return
      rule.walkDecls((decl) => {
        if (geometry.includes(decl.prop)) values[decl.prop] = decl.value
      })
    })
    return values
  }
  const normal = declarations(title)
  expect(Object.keys(normal).sort()).toEqual([...geometry].sort())
  // Explicit shared geometry also shields role buttons from host interaction styles.
  for (const state of [':hover', ':focus-visible']) {
    expect(declarations(title + state)).toEqual(normal)
  }
  css.walkRules((rule) => {
    if (!rule.selectors.some((selector) => selector.startsWith(title + ':'))) return
    rule.walkDecls((decl) => {
      if (decl.prop in normal) expect(decl.value).toBe(normal[decl.prop])
      else expect(['background-color', 'color', 'border-radius', 'cursor']).toContain(decl.prop)
    })
  })
})
