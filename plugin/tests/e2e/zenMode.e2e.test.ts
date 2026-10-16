import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AI_SIDEBAR_VIEW_TYPE } from '../../src/constants/views'
import {
  enterPhone,
  evalJson,
  evalLong,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop')
const available = isObsidianRunning() && hasTestApi()
const folder = `Sample zen ${randomUUID()}`
const shots = shotDir('zen-mode')
const command = `app.commands.executeCommandById(Object.keys(app.commands.commands).find(id => id.endsWith(':toggle-zen-mode')))`
const run = (body: string) => evalLong(`(async () => { ${body} })()`)
let layout: unknown
let wasOn = false

beforeAll(async () => {
  if (!available) return
  layout = evalJson('app.workspace.getLayout()')
  wasOn = evalJson("document.body.classList.contains('abele-zen')")
  await run(`
    if (document.body.classList.contains('abele-zen')) ${command};
    await app.vault.createFolder(${JSON.stringify(folder)});
    await app.vault.create(${JSON.stringify(folder + '/Sample note.md')}, '# Sample page\\n\\nA short page for focused reading.');
    await app.vault.create(${JSON.stringify(folder + '/Sample board.canvas')}, JSON.stringify({nodes:[],edges:[]}));
  `)
})

afterAll(async () => {
  if (!available) return
  await run(`if(document.body.classList.contains('abele-zen')) ${command};`)
  await reloadApp('app.emulateMobile(false)')
  await run(`
    await app.workspace.changeLayout(${JSON.stringify(layout)});
    const folder=app.vault.getAbstractFileByPath(${JSON.stringify(folder)});
    if(folder) await app.vault.delete(folder, true);
    if (${wasOn} && !document.body.classList.contains('abele-zen')) ${command};
  `)
})

describe.runIf(available)('zen window', () => {
  for (const phone of [false, true]) {
    it(`keeps note, canvas and chat focused on ${phone ? 'phone emulation' : 'desktop'}`, async () => {
      if (phone) await enterPhone(390, 844)
      for (const kind of ['note', 'canvas', 'chat']) {
        await run(`
          if(document.body.classList.contains('abele-zen')) ${command};
          const leaf=${kind === 'chat' ? 'app.workspace.getRightLeaf(false)' : "app.workspace.getLeaf('tab')"};
          if(${kind === 'chat'}) await leaf.setViewState({type:${JSON.stringify(AI_SIDEBAR_VIEW_TYPE)},active:true});
          else await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(folder + (kind === 'canvas' ? '/Sample board.canvas' : '/Sample note.md'))}));
          app.workspace.setActiveLeaf(leaf, {focus:true});
          ${command};
        `)
        await expect
          .poll(() => evalJson("document.body.classList.contains('abele-zen')"))
          .toBe(true)
        expect(evalJson("!!app.workspace.activeLeaf.view.containerEl.closest('.mod-root')")).toBe(
          true
        )
        expect(evalJson("document.body.classList.contains('abele-zen-wide')")).toBe(
          kind === 'canvas'
        )
        expect(
          evalJson(`(() => {
          const selectors=['.workspace-ribbon','.status-bar','.mobile-navbar'];
          return selectors.every(s=>[...document.querySelectorAll(s)].every(el=>!el.getBoundingClientRect().height));
        })()`)
        ).toBe(true)
        await run(`
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const image=await require('@electron/remote').getCurrentWebContents().capturePage();
          require('fs').writeFileSync(${JSON.stringify(shots + '/' + (phone ? 'phone' : 'desktop') + '-' + kind + '.png')},image.toPNG());
        `)
      }
    })
  }

  it('restores zen after restart and gives a modal the first Escape', async () => {
    await reloadApp('app.emulateMobile(false)')
    expect(evalJson("document.body.classList.contains('abele-zen')")).toBe(true)
    await run(`
      const {Modal}=require('obsidian'); const modal=new Modal(app); modal.open();
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      modal.close();
    `)
    expect(evalJson("document.body.classList.contains('abele-zen')")).toBe(true)
    await run(
      `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));`
    )
    await expect.poll(() => evalJson("document.body.classList.contains('abele-zen')")).toBe(false)
  })
})
