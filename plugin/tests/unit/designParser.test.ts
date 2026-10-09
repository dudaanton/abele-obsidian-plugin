import { describe, it, expect } from 'vitest'
import { inspectDesign } from '../helpers/designParser'

describe('parsed design contracts', () => {
  it('resolves aliases and reads comparisons without confusing > with a tag end', () => {
    const source = `<template><ObsidianIcon v-if="items.length > 1" icon="plus" @click="add" /></template><script setup>import ObsidianIcon from './obsidian/Icon.vue'</script>`
    expect(inspectDesign(source)).toContain('unnamed icon action')
    expect(inspectDesign(source.replace('icon="plus"', 'icon="plus" tooltip="Add item"'))).toEqual(
      []
    )
  })
  it('rejects text disclosure, inline styling, local dates and literal CSS including named colours', () => {
    const source = `<template><div style="color: red">▶</div></template><script setup>const label = date.toLocaleString()</script><style>.x { color: red; padding: 8px; font-size: 0.8em; }</style>`
    expect(inspectDesign(source)).toEqual(
      expect.arrayContaining([
        'text disclosure glyph',
        'inline style',
        'local display date',
        'literal colour: color',
        'literal spacing: padding',
        'literal typography: font-size',
      ])
    )
  })
  it('parses nested CSS, allowing only documented hairlines, breakpoints and native tokens', () => {
    const source = `<template><span>text</span></template><style lang="scss">.x { color: var(--text-normal); border: 1px solid var(--background-modifier-border); @media (width < 390px) { padding: var(--size-4-2); } }</style>`
    expect(inspectDesign(source)).toEqual([])
    expect(inspectDesign(source.replace('var(--size-4-2)', '1rem'))).toContain(
      'literal spacing: padding'
    )
  })
  it('does not let an invented token become a private palette', () => {
    expect(inspectDesign('<style>.x { color: var(--my-grey); }</style>')).toContain(
      'unapproved token: --my-grey'
    )
  })
  it('rejects raw flat rows but accepts named alternatives and the kit implementation', () => {
    expect(
      inspectDesign(
        '<template><article v-for="item in items">{{item.title}}</article></template>',
        { screen: true }
      )
    ).toContain('raw flat object row')
    expect(
      inspectDesign('<template><TreeItem v-for="item in items" /></template>', { screen: true })
    ).toEqual([])
  })
})
