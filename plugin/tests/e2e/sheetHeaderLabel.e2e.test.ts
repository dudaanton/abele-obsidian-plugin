import { expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('sheet-header')

it('keeps the complete contextual action inside its native phone header button', async () => {
  const reports = await withEmulatedPhone(async () =>
    JSON.parse(
      await evalLong(`(async()=>{
      const native=document.createElement('style');
      try {
        window.__abeleTest.openDesignCatalogue('rows');
        await new Promise(r=>setTimeout(r,500));
        await document.fonts.ready;
        const button=document.querySelector('.abele-sheet-header-actions button');
        const label=button.querySelector('.abele-obsidian-icon__text');
        const reports=[];
        for(const mode of ['default','square-glyphs']) {
          // Themes may size native glyph controls as squares. A worded header action must
          // grow with its label while retaining the host's padding and touch height.
          if(mode==='square-glyphs') {
            native.textContent='body.is-phone :where(.abele-obsidian-icon).clickable-icon { width: var(--touch-size-m); overflow: hidden; }';
            document.head.append(native);
            await new Promise(requestAnimationFrame);
          }
          const range=document.createRange();range.selectNodeContents(label);
          const text=range.getBoundingClientRect(),box=button.getBoundingClientRect();
          const image=await require('@electron/remote').getCurrentWebContents().capturePage();
          require('fs').writeFileSync(${JSON.stringify(shots)}+'/notes-phone-'+mode+'.png',image.toPNG());
          reports.push({mode,text:label.textContent,left:text.left-box.left,right:text.right-box.right,width:box.width,height:box.height});
        }
        return JSON.stringify(reports);
      } finally {native.remove();window.__abeleTest.closeDesignCatalogue()}
    })()`)
    )
  )
  for (const report of reports) {
    expect(report.text).toBe('Attach…')
    expect(report.left, report.mode).toBeGreaterThanOrEqual(0)
    expect(report.right, report.mode).toBeLessThanOrEqual(0)
    expect(report.height).toBeGreaterThanOrEqual(44)
  }
}, 120_000)
