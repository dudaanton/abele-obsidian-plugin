import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { startPairedNode, PAIRED_PRELUDE } from './helpers/pairedNode'
import { evalLong } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('abele-node-file-scroll')

async function scenario(shell: string) {
  const node = await startPairedNode()
  try {
    const project = resolve(node.state, '../sample-project')
    writeFileSync(
      resolve(project, 'long.ts'),
      Array.from({ length: 400 }, (_, i) => `const row${i} = ${i}`).join('\n')
    )
    await evalLong(`(async()=>{${PAIRED_PRELUDE}
      const client=nodes.connection(${JSON.stringify(node.registration)}).client;
      const project=await client.registerProject(${JSON.stringify(project)},'trusted');
      const rows=await client.repository.worktrees({project_id:project.project_id});
      const root=rows.entries.find(w=>w.kind==='root');
      const leaf=app.workspace.getLeaf('tab');
      await leaf.setViewState({type:'abele-node-file',active:true,state:{kind:'file',target:{nodeId:${JSON.stringify(node.node)},registrationId:${JSON.stringify(node.registration)},projectId:project.project_id,kind:'worktree',id:root.worktree_id},path:'long.ts'}});
      await app.workspace.revealLeaf(leaf);return 'opened'})()`)
    for (const mode of ['file', 'diff']) {
      await evalLong(`(async()=>{${PAIRED_PRELUDE}
        const leaf=app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.getState().path==='long.ts');
        leaf.view.file.mode.value=${JSON.stringify(mode)};
        await until(()=>leaf.view.contentEl.querySelector(${JSON.stringify(mode === 'diff' ? '.abele-diff__line' : '.cm-line')}),'Long content');
        const root=leaf.view.contentEl.querySelector('.abele-file-view');
        await until(()=>root.clientHeight>100&&root.scrollHeight>root.clientHeight*2,'Bounded scroll viewport');
        const web=require('@electron/remote').getCurrentWebContents(),cdp=web.debugger;
        const attached=!cdp.isAttached();if(attached)cdp.attach('1.3');
        try {
          root.scrollTop=0;await wait(100);
          require('fs').writeFileSync(${JSON.stringify(resolve(shots, `${shell}-${mode}-before-scroll.png`))},(await web.capturePage()).toPNG());
          const r=root.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height*0.75);
          for(const delta of [480,37]) {
            const before=root.scrollTop;
            await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX:0,deltaY:delta});
            await until(()=>root.scrollTop>before,'Wheel/trackpad scroll moves long content');
          }
          root.scrollTop=0;await wait(100);
          await cdp.sendCommand('Emulation.setTouchEmulationEnabled',{enabled:true});
          await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:0}]});
          for(let step=1;step<=8;step++) {
            await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-step*20,id:0}]});
            await wait(25);
          }
          await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
          await until(()=>root.scrollTop>0,'Touch scroll moves long content');
          root.scrollTop=(root.scrollHeight-root.clientHeight)/2;await wait(200);
          require('fs').writeFileSync(${JSON.stringify(resolve(shots, `${shell}-${mode}-middle.png`))},(await web.capturePage()).toPNG());
          return 'wheel, trackpad and touch scrolled';
        } finally {
          await cdp.sendCommand('Emulation.setTouchEmulationEnabled',{enabled:false});
          if(attached)cdp.detach();
        }
      })()`)
    }
  } finally {
    await evalLong(
      `(()=>{for(const leaf of app.workspace.getLeavesOfType('abele-node-file'))if(leaf.view.getState().target.registrationId===${JSON.stringify(node.registration)})leaf.detach();return 'closed'})()`
    ).catch(() => {})
    await node.close()
  }
}

it('scrolls long node files and diffs with wheel, trackpad and touch on desktop', async () => {
  await scenario('desktop')
}, 120000)

it('scrolls long node files and diffs in phone emulation', async () => {
  await withEmulatedPhone(() => scenario('phone'))
}, 120000)
