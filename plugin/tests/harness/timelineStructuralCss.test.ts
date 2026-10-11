import { describe, expect, it } from 'vitest'
import { timelineStructuralCss } from '../e2e/contracts/timelineStructuralCss'

describe('timeline frozen-reference structural shell', () => {
  it('retains the current shared root, nested phone spacing and history, not date-block appearance', () => {
    const root = {
      selectorText: '.abele-sidebar-panel',
      cssText: '.abele-sidebar-panel{position:absolute;top:0}',
    }
    const phone = {
      selectorText: 'body.is-phone .workspace-split.mod-root .abele-sidebar-panel',
      cssText: 'body.is-phone .workspace-split.mod-root .abele-sidebar-panel{top:111px}',
    }
    const padding = {
      selectorText: '.abele-sidebar-panel',
      cssText: '.abele-sidebar-panel{padding:16px}',
    }
    const history = {
      selectorText: '.abele-timeline__history',
      cssText: '.abele-timeline__history{position:sticky}',
    }
    const block = {
      selectorText: '.abele-timeline__date-block',
      cssText: '.abele-timeline__date-block{font-weight:bold}',
    }
    const header = {
      selectorText: '.abele-ai-chat__header, .abele-obsidian-button',
      cssText: '.abele-ai-chat__header, .abele-obsidian-button{padding:8px}',
    }
    const search = {
      selectorText: '.abele-timeline__search',
      cssText: '.abele-timeline__search{height:32px}',
    }
    const css = timelineStructuralCss(
      [
        header.cssText,
        search.cssText,
        root.cssText,
        phone.cssText,
        history.cssText,
        block.cssText,
        '@media(max-width:600px){' + padding.cssText + block.cssText + '}',
      ].join('\n')
    )
    expect(css).toContain(header.cssText)
    expect(css).toContain(search.cssText)
    expect(css).toContain(root.cssText)
    expect(css).toContain(phone.cssText)
    expect(css).toContain(history.cssText)
    expect(css).toContain('@media(max-width:600px){' + padding.cssText + '}')
    expect(css).not.toContain('date-block')
  })

  it('keeps variable shorthands with longhand overrides and nested selector commas intact', () => {
    const chrome =
      '.abele-sidebar-panel{padding:calc(var(--p-spacing) * 2);padding-top:calc(var(--icon-size) + 16px)}'
    const nested = ':is(.abele-sidebar-panel,.sample-panel){margin:4px}'
    const date = '.abele-timeline__date-block{display:flex}'
    expect(timelineStructuralCss(chrome + nested + date)).toBe(chrome + nested)
    expect(timelineStructuralCss(chrome + nested + date, true)).toBe(date)
  })
})
