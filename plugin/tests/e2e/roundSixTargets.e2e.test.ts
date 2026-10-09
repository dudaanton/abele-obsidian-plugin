import { it, expect } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { targets } from './helpers/target'
targets('desktop')
it.skipIf(!isObsidianRunning() || !hasTestApi())(
  'pads a native phone checkbox hit area without resizing its painted toggle',
  async () => {
    await reloadApp('app.emulateMobile(true)')
    try {
      const size = JSON.parse(
        await evalLong(
          `(async()=>{const win=require('@electron/remote').getCurrentWindow(),size=win.getContentSize();win.setContentSize(390,844);try{window.__abeleTest.openDesignCatalogue('controls');await new Promise(r=>setTimeout(r,150));const el=document.querySelector('.abele-design-catalogue [role="checkbox"]'),paint=el.querySelector('.abele-checkbox__paint')||el;return {hit:el.getBoundingClientRect().height,paint:paint.getBoundingClientRect().height}}finally{window.__abeleTest.closeDesignCatalogue();win.setContentSize(...size)}})()`
        )
      )
      expect(size.hit).toBeGreaterThanOrEqual(44)
      expect(size.paint).toBe(30)
    } finally {
      await evalLong('window.__abeleTest.closeDesignCatalogue()')
      await reloadApp('app.emulateMobile(false)')
    }
  }
)
it.skipIf(!isObsidianRunning() || !hasTestApi())(
  'keeps legacy phone navigation hit boxes at least 44px without enlarging their glyphs',
  async () => {
    await reloadApp('app.emulateMobile(true)')
    try {
      const result = JSON.parse(
        await evalLong(
          `(async()=>{const win=require('@electron/remote').getCurrentWindow(),size=win.getContentSize();win.setContentSize(390,844);try{window.__abeleTest.openDesignCatalogue('navigation');await new Promise(r=>setTimeout(r,150));return [...document.querySelectorAll('.abele-tabs__tab, .abele-breadcrumbs__item, .abele-fold-heading.is-collapsible, .abele-tree-item__self.is-clickable')].map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,glyph:el.querySelector('svg')?.getBoundingClientRect().width}));}finally{window.__abeleTest.closeDesignCatalogue();win.setContentSize(...size)}})()`
        )
      ) as { width: number; height: number; glyph?: number }[]
      expect(result.length).toBeGreaterThanOrEqual(7)
      expect(result.every((r) => r.width >= 44 && r.height >= 44)).toBe(true)
      expect(result.filter((r) => r.glyph).every((r) => r.glyph! <= 20)).toBe(true)
    } finally {
      await reloadApp('app.emulateMobile(false)')
    }
  }
)
