import { it, expect } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { targets } from './helpers/target'
targets('desktop')
it.skipIf(!isObsidianRunning() || !hasTestApi())(
  'keeps nested source history readable in a narrow native row',
  async () => {
    await reloadApp('app.emulateMobile(true)')
    try {
      const result = JSON.parse(
        await evalLong(`(async()=>{
      const win=require('@electron/remote').getCurrentWindow(), size=win.getContentSize();
      win.setContentSize(390,844);
      try {
        window.__abeleTest.openDesignCatalogue('artifact'); await new Promise(r=>setTimeout(r,150));
        document.querySelector('.abele-disclosure__control').click(); await new Promise(r=>setTimeout(r,150));
        const titles=[...document.querySelectorAll('.abele-event-list .abele-list-row__title-text')];
        return titles.map(el=>el.getBoundingClientRect().width);
      } finally {window.__abeleTest.closeDesignCatalogue();win.setContentSize(...size)}
    })()`)
      ) as number[]
      expect(result.length).toBeGreaterThanOrEqual(2)
      expect(result.every((width) => width >= 80)).toBe(true)
    } finally {
      await reloadApp('app.emulateMobile(false)')
    }
  }
)
