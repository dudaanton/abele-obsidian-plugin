import { describe, expect, it } from 'vitest'
import { runtimeElements } from '../../scripts/bundle-size.mjs'

describe('bundle review patterns', () => {
  it.each([
    'document.createElement("script")',
    "doc.createElement('script')",
    'doc.createElement( "script" )',
    "doc.createElement('script', { is: 'sample' })",
    "createEl('script')",
    'doc.createElementNS("http://www.w3.org/1999/xhtml", "script")',
    "doc.createElementNS(namespace, 'script')",
  ])('detects runtime script creation: %s', (code) => {
    expect(runtimeElements(code)).toEqual({ script: 1, style: 0 })
  })

  it('counts runtime styles separately from scripts and static stylesheet references', () => {
    expect(runtimeElements(`doc.createElement('style'); createEl("style"); 'styles.css'`)).toEqual({
      script: 0,
      style: 2,
    })
  })
})
