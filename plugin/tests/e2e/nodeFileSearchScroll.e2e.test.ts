import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { startPairedNode, PAIRED_PRELUDE } from './helpers/pairedNode'
import { evalLong } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('abele-node-file-search-scroll')

async function scenario(shell: string) {
  const node = await startPairedNode()
  try {
    const project = resolve(node.state, '../sample-project')
    writeFileSync(
      resolve(project, 'long.ts'),
      Array.from(
        { length: 1200 },
        (_, i) => `// ${[180, 600, 1080].includes(i) ? 'distantNeedle' : 'filler'} line ${i + 1}`
      ).join('\n')
    )
    await evalLong(`(async()=>{${PAIRED_PRELUDE}
      const client=nodes.connection(${JSON.stringify(node.registration)}).client;
      const project=await client.registerProject(${JSON.stringify(project)},'trusted');
      const rows=await client.repository.worktrees({project_id:project.project_id});
      const root=rows.entries.find(w=>w.kind==='root');await client.nodePath.execution({project_id:project.project_id,target:{kind:'worktree',worktree_id:root.worktree_id},enabled:true});
      const leaf=app.workspace.getLeaf('tab');
      await leaf.setViewState({type:'abele-node-file',active:true,state:{kind:'file',target:{nodeId:${JSON.stringify(node.node)},registrationId:${JSON.stringify(node.registration)},projectId:project.project_id,kind:'worktree',id:root.worktree_id},path:'long.ts',edit:true}});
      await app.workspace.revealLeaf(leaf);return 'opened'})()`)
    const failures: string[] = []
    for (const mode of ['edit', 'view', 'diff']) {
      for (const entry of ['button', 'command', 'keyboard']) {
        try {
          await evalLong(`(async()=>{${PAIRED_PRELUDE}
          const leaf=app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.getState().path==='long.ts');
          if(${JSON.stringify(mode)}==='edit')await until(()=>leaf.view.contentEl.querySelector('.cm-content[contenteditable="true"]'),'Editable code',15000);
          else {leaf.view.editing.stop();leaf.view.file.mode.value=${JSON.stringify(mode === 'diff' ? 'diff' : 'file')};}
          await wait(200);if(${JSON.stringify(mode)}==='diff')await until(()=>leaf.view.contentEl.querySelector('.abele-diff'),'Comparison before find',15000);
          const root=leaf.view.contentEl;
          if(${JSON.stringify(entry)}==='button')root.querySelector('[data-node-find]').click();
          else if(${JSON.stringify(entry)}==='command')app.commands.executeCommandById('editor:open-search');
          else {const focus=root.querySelector('.cm-content')??root.querySelector('.abele-file-view');focus.tabIndex=-1;focus.focus();const web=require('@electron/remote').getCurrentWebContents(),modifiers=require('process').platform==='darwin'?['meta']:['control'];web.sendInputEvent({type:'keyDown',keyCode:'F',modifiers});web.sendInputEvent({type:'keyUp',keyCode:'F',modifiers});}
          await until(()=>root.querySelector('[role=search] input'),'Find input');
          const input=root.querySelector('[role=search] input');input.value='distantNeedle';input.dispatchEvent(new Event('input',{bubbles:true}));
          await until(()=>root.querySelector('.abele-github-find__count').textContent.includes('3'),'Three matches');
          return 'searching'})()`)
          for (const [step, key] of ['initial', 'next', 'next', 'next', 'previous'].entries()) {
            await evalLong(`(async()=>{${PAIRED_PRELUDE}
            const leaf=app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.getState().path==='long.ts'),root=leaf.view.contentEl,input=root.querySelector('[role=search] input');
            if(${JSON.stringify(key)}!=='initial'&&${JSON.stringify(entry)}==='button')root.querySelector('[role=search] button:has(.lucide-arrow-'+(${key === 'previous'}?'up':'down')+')').click();else if(${JSON.stringify(key)}!=='initial')input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:${key === 'previous'},bubbles:true}));
            const visibleMatch=()=>{const mark=root.querySelector('.abele-github-find__match_current');if(!mark)return false;const view=api.codeView(mark.closest('.cm-editor')),selection=view.state.selection.main;if(view.posAtDOM(mark)!==selection.from||view.state.doc.lineAt(selection.from).number!==${[181, 601, 1081, 181, 1081][step]})return false;const box=mark.closest('.cm-line').getBoundingClientRect(),bar=input.closest('[role=search]').getBoundingClientRect();let top=Math.max(0,bar.bottom),bottom=innerHeight;for(let el=mark.parentElement;el;el=el.parentElement){if(['auto','scroll','hidden'].includes(getComputedStyle(el).overflowY)){const r=el.getBoundingClientRect();top=Math.max(top,r.top);bottom=Math.min(bottom,r.bottom)}}return box.height>0&&box.top>=top&&box.bottom<=bottom};await until(visibleMatch,'Current selected match inside visible viewport',5000);await wait(200);if(!visibleMatch())throw Error('Current selected match left the viewport after paint');
            const mark=root.querySelector('.abele-github-find__match_current'),view=api.codeView(mark.closest('.cm-editor')),selection=view.state.selection.main;
            if(view.state.doc.sliceString(selection.from,selection.to)!=='distantNeedle')throw Error('Selection does not cover current match');
            if(view.state.doc.lineAt(selection.from).number!==${[181, 601, 1081, 181, 1081][step]})throw Error('Navigation selected the wrong occurrence');
            if(${step}===4)require('fs').writeFileSync(${JSON.stringify(resolve(shots, `${shell}-${mode}-${entry}-${step}-${key}.png`))},(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());return 'visible and selected'})()`)
          }
        } catch (error) {
          failures.push(`${shell}/${mode}/${entry}: ${String(error)}`)
        } finally {
          await evalLong(
            `(()=>{const input=document.querySelector('[role=search] input');input?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return 'closed'})()`
          )
        }
      }
    }
    if (failures.length) throw new Error(failures.join('\n'))
  } finally {
    await evalLong(
      `(()=>{for(const leaf of app.workspace.getLeavesOfType('abele-node-file'))if(leaf.view.getState().target.registrationId===${JSON.stringify(node.registration)})leaf.detach();return 'closed'})()`
    ).catch(() => {})
    await node.close()
  }
}

it('scrolls and selects distant file matches in edit, view and comparison on desktop', async () => {
  await scenario('desktop')
}, 180000)
it('scrolls and selects distant file matches in phone emulation', async () => {
  await withEmulatedPhone(() => scenario('phone'))
}, 180000)
