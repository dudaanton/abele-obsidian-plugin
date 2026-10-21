import { expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { enableGithub, PRELUDE, restoreGithub, startFakeGithub } from './helpers/githubLive'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('blame-author')

it('reserves fourteen characters for long attribution in desktop and phone layouts', async () => {
  const gh = await startFakeGithub({ mode: 'long-author' })
  const measure = async (mode: string) =>
    JSON.parse(
      await evalLong(`(async()=>{
    ${PRELUDE}
    const leaf=await openTab(${JSON.stringify(`${gh.web}/blob/main/src/long.ts`)});
    const root=leaf.view.containerEl;
    const toggle=await until(()=>root.querySelector('button[aria-label="Toggle line blame"]'));
    if(toggle.getAttribute('aria-pressed')!=='true')toggle.click();
    const name=await until(()=>root.querySelector('.abele-github-blame-range__name'));
    if(!name)throw Error('No blame author');
    await document.fonts.ready;await new Promise(r=>setTimeout(r,500));
    const probe=document.createElement('span');probe.style.font=getComputedStyle(name).font;probe.style.width='14ch';probe.style.display='inline-block';name.after(probe);
    const minimum=probe.getBoundingClientRect().width;probe.remove();
    const box=name.getBoundingClientRect();
    const number=[...root.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].find(el=>el.textContent==='1');
    const numberRange=document.createRange();numberRange.selectNodeContents(number);const numberBox=numberRange.getBoundingClientRect();
    const numberHit=number.contains(document.elementFromPoint(numberBox.left+numberBox.width/2,numberBox.top+numberBox.height/2));
    const action=root.querySelector('.abele-github-blame-range__open'),css=getComputedStyle(action),label=getComputedStyle(action.querySelector('.abele-obsidian-button__label'));
    const image=await require('@electron/remote').getCurrentWebContents().capturePage();
    require('fs').writeFileSync(${JSON.stringify(shots)}+'/'+${JSON.stringify(mode)}+'.png',image.toPNG());
    return JSON.stringify({name:name.textContent,width:box.width,minimum,sideways:root.scrollWidth-root.clientWidth,gutter:root.querySelector('.abele-github-blame').getBoundingClientRect().width,numberHit,nameLeft:box.left,codeLeft:root.querySelector('.cm-editor').getBoundingClientRect().left,button:action.getBoundingClientRect().toJSON(),padding:[css.paddingTop,css.paddingRight,css.paddingBottom,css.paddingLeft],margin:[css.marginLeft,css.marginRight],gap:label.gap,date:root.querySelector('.abele-github-blame-range__date').getBoundingClientRect().width,range:root.querySelector('.abele-github-blame-range').getBoundingClientRect().width});
  })()`)
    )
  try {
    enableGithub(gh.origin)
    const desktop = await measure('desktop')
    restoreGithub()
    const phone = await withEmulatedPhone(async () => {
      enableGithub(gh.origin)
      try {
        return await measure('phone')
      } finally {
        restoreGithub()
      }
    })
    console.log('Blame author geometry', JSON.stringify({ desktop, phone }))
    for (const report of [desktop, phone]) {
      expect(report.name).toBe('Alexandria Montgomery-Whitfield')
      expect(report.width).toBeGreaterThanOrEqual(report.minimum - 0.5)
      expect(report.sideways).toBe(0)
      // The attribution reserves its words, while the native button inset is an outset.
      // The short-author phone fixture separately retains its existing 160px limit.
      expect(report.gutter).toBeLessThanOrEqual(
        report.width + report.date + parseFloat(report.gap) + 0.5
      )
      expect(report.numberHit).toBe(true)
      expect(report.nameLeft).toBeGreaterThanOrEqual(report.codeLeft - 0.5)
    }
  } finally {
    try {
      restoreGithub()
    } finally {
      await gh.stop()
    }
  }
}, 180_000)
