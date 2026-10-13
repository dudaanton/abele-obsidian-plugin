import { readFileSync } from 'node:fs'
import { compileString } from 'sass-embedded'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync('src/components/gallery/gallery.scss', 'utf8')

// Resolve equal-specificity declarations in the emitted stylesheet, including matching
// container queries. DOM test environments do not evaluate container queries.
function columnsAt(widthEm: number) {
  let columns = ''
  postcss.parse(compileString(stylesheet).css).walkRules('.abele-gallery__masonry', (rule) => {
    const parent = rule.parent
    if (parent?.type === 'atrule' && parent.name === 'container') {
      const maximum = /max-width:\s*([\d.]+)em/.exec(parent.params)
      if (!maximum) throw new Error(`Unsupported container query: ${parent.params}`)
      if (widthEm > Number(maximum[1])) return
    }
    rule.walkDecls('columns', (declaration) => {
      columns = declaration.value
    })
  })
  return columns
}

describe('gallery masonry columns', () => {
  it('uses two columns in a narrow pane and three in a wide pane', () => {
    expect(columnsAt(24)).toBe('2')
    expect(columnsAt(30)).toBe('2')
    expect(columnsAt(60)).toBe('3')
  })
})
