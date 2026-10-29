import { afterEach, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { reloadApp } from './helpers/obsidianCli'
import { cleanupCreatedViews } from './helpers/debugAttachLifecycle'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const SHOTS = shotDir('abele-debug-session-reload')
const types = [
  'abele-trace-run',
  'abele-request',
  'abele-timeline-sidebar-view',
  'abele-debug-view',
]
let created: string[] = []

function cleanup() {
  evalAsync(
    `(async()=>{await (${cleanupCreatedViews.toString()})(app.workspace,${JSON.stringify(created)},${JSON.stringify(types)});return true})()`
  )
  created = []
}
afterEach(cleanup)

async function scene(phone: boolean) {
  created = evalAsync<string[]>(`(async()=>{
    const ids=[];
    for(const type of ${JSON.stringify(types)}) {
      if(app.workspace.getLeavesOfType(type).length)continue;
      const leaf=type==='abele-debug-view'?app.workspace.getRightLeaf(false):app.workspace.getLeaf('tab');
      await leaf.setViewState({type,active:false,state:{}});ids.push(leaf.id);
    }
    await app.workspace.requestSaveLayout.run();return ids;
  })()`)
  for (const pluginOnly of [false, true]) {
    if (pluginOnly)
      evalAsync(
        `(async()=>{await app.plugins.disablePlugin('abele');await app.plugins.enablePlugin('abele');return true})()`
      )
    else await reloadApp()
    const result = evalAsync<{ titles: string[]; debug: number }>(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      let leaves=[];
      for(let i=0;i<200;i++) {
        leaves=${JSON.stringify(types)}.flatMap(type=>app.workspace.getLeavesOfType(type));
        if(leaves.length>=4&&leaves.every(leaf=>!${JSON.stringify(types)}.includes(leaf.view.getDisplayText())&&!${JSON.stringify(types)}.includes(leaf.tabHeaderInnerTitleEl?.textContent??leaf.view.getDisplayText())))break;
        await wait(50);
      }
      const debug=app.workspace.getLeavesOfType('abele-debug-view');
      if(debug[0])await app.workspace.revealLeaf(debug[0]);
      const split=debug[0]?.getRoot();
      if(${phone}&&(split===app.workspace.leftSplit||split===app.workspace.rightSplit)){split.collapse();await wait(300);split.expand();await wait(700)}
      const image=await require('@electron/remote').getCurrentWebContents().capturePage();
      require('fs').writeFileSync(${JSON.stringify(SHOTS + '/' + (phone ? 'phone' : 'desktop') + (pluginOnly ? '-plugin' : '-window') + '-reload.png')},image.toPNG());
      return {titles:leaves.map(leaf=>leaf.tabHeaderInnerTitleEl?.textContent??leaf.view.getDisplayText()),views:leaves.map(leaf=>({type:leaf.view.getViewType(),title:leaf.view.getDisplayText()})),debug:debug.length};
    })()`)
    expect(result.debug).toBe(1)
    expect(result.titles.length).toBeGreaterThanOrEqual(4)
    for (const title of result.titles) {
      expect(title.trim()).not.toBe('')
      expect(types, JSON.stringify({ phone, pluginOnly, ...result })).not.toContain(title)
    }
  }
}

it('restores readable headers and one Debug view after window and plugin reload', async () => {
  await scene(false)
}, 180000)
it('restores readable headers and one Debug view after phone window and plugin reload', async () => {
  await withEmulatedPhone(async () => {
    try {
      await scene(true)
    } finally {
      cleanup()
    }
  })
}, 240000)
