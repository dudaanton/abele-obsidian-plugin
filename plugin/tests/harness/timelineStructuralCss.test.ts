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
    const css = timelineStructuralCss([
      root,
      phone,
      history,
      block,
      { cssText: '@media(max-width:600px){...}', cssRules: [padding, block] },
    ])
    expect(css).toContain(root.cssText)
    expect(css).toContain(phone.cssText)
    expect(css).toContain(history.cssText)
    expect(css).toContain('@media(max-width:600px){' + padding.cssText + '}')
    expect(css).not.toContain('date-block')
  })
})
