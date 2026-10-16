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
let savedMobile: string | null = null
let wasOn = false

const restoreLayout = (saved: unknown) =>
  run(`
  if(document.body.classList.contains('abele-zen')) ${command};
  const layout=${JSON.stringify(saved)}, original=new Set();
  const visit=node=>{if(node.type==='leaf')original.add(node.id);for(const child of node.children??[])visit(child)};
  visit(layout.main);
  const opened=[];
  app.workspace.iterateRootLeaves(leaf=>{if(!original.has(leaf.id))opened.push(leaf)});
  for(const leaf of opened)leaf.detach();
  await app.workspace.changeLayout(layout);
  await app.workspace.requestSaveLayout.run();
  await window.__abeleTest.AbeleConfig.getInstance().saveSettings();
`)

const leavePhone = async () => {
  if (!evalJson('!!app.isMobile')) return
  // Mobile has a separate persisted workspace. Restore it before the reload saves it.
  await restoreLayout(savedMobile === null ? layout : JSON.parse(savedMobile))
  await reloadApp('app.emulateMobile(false)')
}

beforeAll(async () => {
  if (!available) return
  layout = evalJson('app.workspace.getLayout()')
  savedMobile = JSON.parse(
    await run(`
    const path=app.vault.configDir+'/workspace-mobile.json';
    return JSON.stringify(await app.vault.adapter.exists(path)?await app.vault.adapter.read(path):null);
  `)
  ) as string | null
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
  await leavePhone()
  await restoreLayout(layout)
  await run(`
    const mobilePath=app.vault.configDir+'/workspace-mobile.json', savedMobile=${JSON.stringify(savedMobile)};
    if(savedMobile!==null)await app.vault.adapter.write(mobilePath,savedMobile);
    else if(await app.vault.adapter.exists(mobilePath))await app.vault.adapter.remove(mobilePath);
    const folder=app.vault.getAbstractFileByPath(${JSON.stringify(folder)});
    if(folder) await app.vault.delete(folder, true);
    if (${wasOn} && !document.body.classList.contains('abele-zen')) ${command};
    await window.__abeleTest.AbeleConfig.getInstance().saveSettings();
    await app.workspace.requestSaveLayout.run();
  `)
})

describe.runIf(available)('zen window', () => {
  for (const phone of [false, true]) {
    it(`keeps note, canvas and chat focused on ${phone ? 'phone emulation' : 'desktop'}`, async () => {
      try {
        if (phone) {
          await enterPhone(390, 844)
          await restoreLayout(savedMobile === null ? layout : JSON.parse(savedMobile))
        }
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
      } finally {
        if (phone) await leavePhone()
      }
    })
  }

  it('restores zen after restart and gives a modal the first Escape', async () => {
    await run(`
      if(!document.body.classList.contains('abele-zen')) ${command};
      await window.__abeleTest.AbeleConfig.getInstance().saveSettings();
    `)
    await reloadApp('app.emulateMobile(false)')
    expect(evalJson("document.body.classList.contains('abele-zen')")).toBe(true)
    const escape = () =>
      run(
        `document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true,cancelable:true}));`
      )
    try {
      // The page evaluator cannot require Obsidian's plugin API. Use the same real dialog
      // entry point as the script-form e2e files, without awaiting its dismissal promise.
      await run(`
        void window.__abeleTest.showFormModal([
          {name:'sample',label:'Sample overlay',type:'markdown',text:'A sample dialog over the page.'}
        ]);
      `)
      await expect.poll(() => evalJson("!!document.querySelector('.abele-script-form')")).toBe(true)
      await escape()
      await expect
        .poll(() => evalJson("!!document.querySelector('.abele-script-form')"))
        .toBe(false)
      expect(evalJson("document.body.classList.contains('abele-zen')")).toBe(true)
      await escape()
      await expect.poll(() => evalJson("document.body.classList.contains('abele-zen')")).toBe(false)
    } finally {
      await run(
        `document.querySelector('.abele-script-form')?.closest('.modal-container')?.querySelector('.modal-bg')?.click();`
      )
    }
  })
})
