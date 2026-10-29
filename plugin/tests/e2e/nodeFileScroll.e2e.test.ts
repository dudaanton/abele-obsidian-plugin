import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { startPairedNode, PAIRED_PRELUDE } from './helpers/pairedNode'
import { evalLong } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('abele-node-file-scroll')
const closeFiles = `const close=[...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='Close')??document.querySelector('.modal-close-button,.modal-header-button');close?.click();`

function scrollProbe(shell: string, place: string, mode: string) {
  return `        const web=require('@electron/remote').getCurrentWebContents(),cdp=web.debugger;
        const attached=!cdp.isAttached();if(attached)cdp.attach('1.3');
        try {
          root.scrollTop=0;await wait(100);
          if(${JSON.stringify(mode === 'file' && place === 'tab')}) {
            const content=root.querySelector(".cm-line"),walker=document.createTreeWalker(content,NodeFilter.SHOW_TEXT);
            let text;while((text=walker.nextNode())&&!text.textContent.includes("sampleValue")){}
            if(!text)throw Error("Selection fixture missing");
            const at=text.textContent.indexOf("sampleValue"),range=document.createRange();
            range.setStart(text,at);range.setEnd(text,at+11);
            window.getSelection().removeAllRanges();window.getSelection().addRange(range);
            document.dispatchEvent(new Event("selectionchange"));
            await until(()=>root.querySelector(".abele-code-occurrence"),"Occurrence highlight");
            await until(()=>document.querySelector(".abele-selection-bar_placed"),"Floating selection menu");
            if(root.querySelector(".abele-github-code__bar,.abele-github-selection"))throw Error("Inline selection bar remains");
            require("fs").writeFileSync(${JSON.stringify(resolve(shots, `${shell}-${place}-${mode}-selection.png`))},(await web.capturePage()).toPNG());
            window.getSelection().removeAllRanges();document.dispatchEvent(new Event("selectionchange"));
          }

          require('fs').writeFileSync(${JSON.stringify(resolve(shots, `${shell}-${place}-${mode}-before-scroll.png`))},(await web.capturePage()).toPNG());
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
          if(${JSON.stringify(mode === 'file' && place === 'tab')}) {
            const header=root.querySelector(".abele-file-view__header"),box=header.getBoundingClientRect(),viewport=root.getBoundingClientRect();
            if(getComputedStyle(header).position!=="sticky"||box.top<viewport.top-1||box.bottom>viewport.bottom)throw Error("File action header scrolled away");
          }
          require('fs').writeFileSync(${JSON.stringify(resolve(shots, `${shell}-${place}-${mode}-middle.png`))},(await web.capturePage()).toPNG());
          return 'wheel, trackpad and touch scrolled';
        } finally {
          await cdp.sendCommand('Emulation.setTouchEmulationEnabled',{enabled:false});
          if(attached)cdp.detach();
        }`
}

async function scenario(shell: string) {
  const node = await startPairedNode()
  try {
    const project = resolve(node.state, '../sample-project')
    writeFileSync(
      resolve(project, 'long.ts'),
      Array.from({ length: 400 }, (_, i) => `const row${i} = ${i} // sampleValue`).join('\n')
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
      // Opening a leaf starts the read; its completion selects the initial mode. Wait before
      // switching, otherwise the read can replace file mode with the added file's comparison.
      await evalLong(`(async()=>{${PAIRED_PRELUDE}
        const leaf=app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.getState().path==='long.ts');
        await until(()=>!leaf.view.file.busy.value,'File load');
        if(leaf.view.file.error.value)throw Error('File load: '+leaf.view.file.error.value);
        if(!leaf.view.file.document.value?.text.includes('const row399 = 399'))throw Error('Long fixture missing: '+leaf.view.contentEl.textContent);
        leaf.view.file.mode.value=${JSON.stringify(mode)};
        await until(()=>leaf.view.contentEl.querySelector(${JSON.stringify(mode === 'diff' ? '.abele-diff__line' : '.cm-line')}),'Long content');
        const root=leaf.view.contentEl.querySelector('.abele-file-view');
        await until(()=>root.clientHeight>100&&root.scrollHeight>root.clientHeight*2,'Bounded scroll viewport');
        ${scrollProbe(shell, 'tab', mode)}
      })()`)
    }
    const session = await node.session('Scroll sample')
    const workspacePath = await evalLong(`(async()=>{${PAIRED_PRELUDE}
      const client=nodes.connection(${JSON.stringify(node.registration)}).client;
      const session=await client.getSession(${JSON.stringify(session)});
      return (await client.getWorkspace(session.workspace_id)).path;
    })()`)
    writeFileSync(
      resolve(workspacePath, 'long.ts'),
      Array.from({ length: 400 }, (_, i) => `const row${i} = ${i} // sampleValue`).join('\n')
    )
    execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', 'add', 'long.ts'], {
      cwd: workspacePath,
    })
    await node.open(session, 'Scroll sample')
    for (const mode of ['file', 'diff']) {
      await evalLong(`(async()=>{${PAIRED_PRELUDE}
        const presenter=chats.getNodeSession('node:'+${JSON.stringify(node.registration)}+':'+${JSON.stringify(session)});
        await until(()=>presenter.workspaceId.value&&chat(),'Chat ready');
        presenter.openResource('long.ts');
        await until(()=>document.querySelector('.abele-node-files .cm-line'),'Chat file loaded');
        const dialog=document.querySelector('.abele-node-files');
        if(${JSON.stringify(mode)}==='diff') {
          [...dialog.querySelectorAll('button')].find(b=>b.textContent.trim()==='Diffs').click();
          const snapshot=()=>[...dialog.querySelectorAll('button')].find(b=>b.textContent.trim()==='Open new snapshot'&&!b.disabled);
          await until(snapshot,'Chat snapshot action');snapshot().click();
          await until(()=>dialog.querySelector('.abele-github-file .cm-line'),'Chat diff loaded');
        }
        const scrollRoot=()=>{
          const content=dialog.querySelector(${JSON.stringify(mode === 'diff' ? '.abele-github-file .cm-content' : '.cm-content')});
          if(!content?.textContent.includes('const row0 = 0'))return null;
          let el=content.parentElement;
          while(el&&!(el.clientHeight>100&&el.scrollHeight>el.clientHeight*2&&/auto|scroll/.test(getComputedStyle(el).overflowY)))el=el.parentElement;
          return el;
        };
        const root=await until(scrollRoot,'Chat bounded scroll viewport').catch(error=>{
          const boxes=[];
          for(let el=dialog.querySelector('.cm-content');el;el=el.parentElement)
            boxes.push([el.className,el.clientHeight,el.scrollHeight,getComputedStyle(el).overflowY]);
          throw Error(error.message+'; '+JSON.stringify(boxes)+'; '+dialog.textContent.slice(0,800));
        });
        ${scrollProbe(shell, 'chat', mode)}
      })()`)
      await evalLong(`(async()=>{${PAIRED_PRELUDE}
        ${closeFiles}
        await until(()=>!document.querySelector('.abele-node-files'),'Chat files closed');return 'closed';
      })()`)
    }
  } finally {
    await evalLong(
      `(()=>{${closeFiles}for(const leaf of app.workspace.getLeavesOfType('abele-node-file'))if(leaf.view.getState().target.registrationId===${JSON.stringify(node.registration)})leaf.detach();return 'closed'})()`
    ).catch(() => {})
    await node.close()
  }
}

it('scrolls long node files and diffs with wheel, trackpad and touch on desktop', async () => {
  await scenario('desktop')
}, 240000)

it('scrolls long node files and diffs in phone emulation', async () => {
  await withEmulatedPhone(() => scenario('phone'))
}, 240000)
