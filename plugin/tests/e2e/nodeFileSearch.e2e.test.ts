import { it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { startPairedNode, PAIRED_PRELUDE } from './helpers/pairedNode'
import { evalLong, evalRaw } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('abele-node-file-search')
const prelude = `${PAIRED_PRELUDE}
const visible=selector=>[...document.querySelectorAll(selector)].find(el=>el.getBoundingClientRect().width>0&&!el.closest('.workspace-leaf.mod-hidden'));
const file=()=>visible('.abele-file-view');`

async function capture(name: string) {
  await evalLong(
    `(async()=>{await new Promise(r=>setTimeout(r,150));require('fs').writeFileSync(${JSON.stringify(resolve(shots, name + '.png'))},(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());return 'captured'})()`
  )
}

/** Check the real host command and native keymap, starting with the freshly opened file. */
async function search(shell: string, entry: string) {
  await evalLong(`(async()=>{${prelude}
    await until(()=>file()?.textContent.includes('marker'),'The ordinary file');
    const find=file().querySelector('[data-node-find]');if(!find)throw Error('Find button missing on ordinary file');
    find.click();await until(()=>file()?.querySelector('[role=search] input'),'Find button');
    const close=async()=>{file().querySelector('[role=search] input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await until(()=>!file().querySelector('[role=search]'),'Find closes')};
    await close();
    if(!app.commands.executeCommandById('editor:open-search'))throw Error('Current-file command unavailable');
    await until(()=>file()?.querySelector('[role=search] input'),'Current-file command');await close();
    file().querySelector('.cm-content').focus();return 'button and host command'})()`)
  await evalLong(
    `(()=>{const web=require('@electron/remote').getCurrentWebContents(),modifiers=require('process').platform==='darwin'?['meta']:['control'];web.sendInputEvent({type:'keyDown',keyCode:'F',modifiers});web.sendInputEvent({type:'keyUp',keyCode:'F',modifiers});return 'native find'})()`
  )
  await evalLong(`(async()=>{${prelude}
    await until(()=>file()?.querySelector('[role=search] input'),'Native find');
    const input=file().querySelector('[role=search] input');if(document.activeElement!==input)throw Error('Find did not focus its input');
    input.value='marker';input.dispatchEvent(new Event('input',{bubbles:true}));
    await until(()=>file()?.querySelectorAll('.abele-github-find__match').length===2,'Both file matches');
    if(input.getBoundingClientRect().width<parseFloat(getComputedStyle(input).fontSize)*4)throw Error('Find input too narrow');return 'matches'})()`)
  await capture(`${shell}-${entry}-search`)
  await evalLong(
    `(async()=>{${prelude}file().querySelector('[role=search] input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await until(()=>!file().querySelector('[role=search]'),'Find closes');return 'closed'})()`
  )
}

async function checkTools(shell: string, entry: string) {
  await evalLong(`(async()=>{${prelude}
        file().querySelector('[aria-label="Toggle line blame"]').click();await until(()=>file()?.querySelector('.abele-github-blame-range'),'Line blame');return 'blame'})()`)
  await capture(`${shell}-${entry}-blame`)
  await evalLong(`(async()=>{${prelude}
        file().querySelector('[aria-label="Toggle line blame"]').click();
        const leaf=app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.contentEl.contains(file()));const row=file().querySelectorAll('.cm-line')[1],range=document.createRange();range.selectNodeContents(row);const box=range.getBoundingClientRect();row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:box.left+box.width/2,clientY:box.top+box.height/2}));
        await until(()=>[...document.querySelectorAll('.menu-item')].find(el=>el.textContent.includes('Go to definition of')),'Definition menu');[...document.querySelectorAll('.menu-item')].find(el=>el.textContent.includes('Go to definition of')).click();await until(()=>file()?.querySelector('.abele-github-code__line_target')&&leaf.view.getState().line===1&&!leaf.view.getState().endLine,'Definition destination');return 'definition'})()`)
}

async function fileSearchScenario(shell: 'desktop' | 'phone') {
  const node = await startPairedNode()
  const project = resolve(node.state, '../sample-project')
  const git = (...args: string[]) =>
    promisify(execFile)('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: project,
    })
  try {
    mkdirSync(resolve(project, 'src'))
    writeFileSync(resolve(project, 'src/sample.ts'), 'export const marker = 1\nmarker\n')
    await git('add', 'src/sample.ts')
    await git(
      '-c',
      'user.name=Sample',
      '-c',
      'user.email=sample@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'Add sample source'
    )
    writeFileSync(resolve(project, 'src/sample.ts'), 'export const marker = 2\nmarker\n')
    const ids = JSON.parse(
      await evalLong(`(async()=>{${prelude}
      const client=nodes.connection(${JSON.stringify(node.registration)}).client;
      const project=await client.registerProject(${JSON.stringify(project)},'trusted');
      const rows=await client.repository.worktrees({project_id:project.project_id});
      const root=rows.entries.find(w=>w.kind==='root');
      await client.nodePath.execution({project_id:project.project_id,target:{kind:'worktree',worktree_id:root.worktree_id},enabled:true});
      const session=await client.nodePath.createSession({title:'Source links',provider:'fake',target:{kind:'worktree',worktree_id:root.worktree_id}});
      return JSON.stringify({project:project.project_id,root:root.worktree_id,session:session.session_id})})()`)
    ) as { project: string; root: string; session: string }
    const citation =
      'abele-node-code:' +
      encodeURIComponent(
        JSON.stringify({
          scope: [node.node, ids.project, 'worktree', ids.root],
          path: 'src/sample.ts',
          line: 1,
          endLine: 2,
        })
      )

    const scenario = async (shell: 'desktop' | 'phone') => {
      const sidebar = async (mode: 'Changes' | 'Files') => {
        await evalLong(`(async()=>{${prelude}
          const model=api.NodePathService.getInstance().model(${JSON.stringify(node.registration)});await api.NodePathService.getInstance().ready(${JSON.stringify(node.registration)});await model.refresh();await model.select(${JSON.stringify(ids.root)});
          const leaf=app.workspace.getLeavesOfType('abele-node-sidebar')[0]??app.workspace.getLeftLeaf(false);await leaf.setViewState({type:'abele-node-sidebar',active:true,state:{registrationId:${JSON.stringify(node.registration)}}});await app.workspace.revealLeaf(leaf);app.workspace.leftSplit.expand();
          await until(()=>visible('.abele-node-modes [role=tab][aria-label^="${mode}"]'),'The node mode');visible('.abele-node-modes [role=tab][aria-label^="${mode}"]').click();return 'node mode'})()`)
      }
      const closeFile = async () => {
        await evalLong(
          `(()=>{${prelude}for(const leaf of app.workspace.getLeavesOfType('abele-node-file'))if(leaf.view.getState().target.registrationId===${JSON.stringify(node.registration)})leaf.detach();return 'closed fixture files'})()`
        )
      }
      await sidebar('Changes')
      await evalLong(
        `(async()=>{${prelude}await until(()=>[...visible('.abele-node-panel').querySelectorAll('.tree-item-self')].find(r=>r.textContent.includes('sample.ts')),'Changed file row');[...visible('.abele-node-panel').querySelectorAll('.tree-item-self')].find(r=>r.textContent.includes('sample.ts')).click();await until(()=>file()?.querySelector('.abele-diff'),'Initial comparison');return 'clicked change'})()`
      )
      await evalLong(`(async()=>{${prelude}
        await until(()=>file()?.querySelector('.abele-file-view__tools')?.children.length,'Comparison controls');
        const tools=file().querySelector('.abele-file-view__tools'),when=file().querySelector('.abele-file-view__when');
        if(when&&tools.getBoundingClientRect().top>=when.getBoundingClientRect().bottom)throw Error('Search controls add a separate comparison header row');return 'compact comparison controls'})()`)
      await capture(`${shell}-initial-comparison`)
      await search(shell, 'changes')
      await checkTools(shell, 'changes')
      await closeFile()
      await sidebar('Files')
      await evalLong(`(async()=>{${prelude}
        await until(()=>visible('.abele-file-tree'),'File tree');let tree=visible('.abele-file-tree');await until(()=>[...tree.querySelectorAll('.tree-item-self')].find(r=>r.querySelector('.abele-tree-item__text')?.textContent==='src'),'Source folder');const folder=[...tree.querySelectorAll('.tree-item-self')].find(r=>r.querySelector('.abele-tree-item__text')?.textContent==='src');if(folder.getAttribute('aria-expanded')==='false')folder.click();await until(()=>[...tree.querySelectorAll('.tree-item-self')].find(r=>r.querySelector('.abele-tree-item__text')?.textContent==='sample.ts'),'File row');[...tree.querySelectorAll('.tree-item-self')].find(r=>r.querySelector('.abele-tree-item__text')?.textContent==='sample.ts').click();return 'clicked tree file'})()`)
      await search(shell, 'tree')
      await checkTools(shell, 'tree')
      await closeFile()
      await node.open(ids.session, 'Source links')
      await evalLong(
        `(async()=>{${prelude}const presenter=chats.getNodeSession(chats.activeTabId.value);await until(()=>presenter.binding.value,'Chat binding');await presenter.send(${JSON.stringify(`[Source](src/sample.ts) [Lines](${citation})`)},[{kind:'hang'}]);await until(()=>chat()?.querySelector('a'),'Rendered chat links');await until(()=>presenter.projection.value.activeRuns.length,'Fake run');await presenter.interrupt(presenter.projection.value.activeRuns[0]);return 'fake source message'})()`
      )
      for (const label of ['Source', 'Lines']) {
        await evalLong(
          `(async()=>{${prelude}await chats.revealSidebar({focus:false});await until(()=>chat(),'Chat');const link=[...chat().querySelectorAll('a')].find(a=>a.textContent===${JSON.stringify(label)});if(!link)throw Error('Chat source link missing');link.click();await until(()=>file()?.textContent.includes('marker'),'Chat file opens');return 'clicked chat link'})()`
        )
        await search(shell, label.toLowerCase())
        await checkTools(shell, label.toLowerCase())
        await closeFile()
      }
    }
    await scenario(shell)
  } finally {
    await evalLong(
      `(()=>{${prelude}for(const leaf of app.workspace.getLeavesOfType('abele-node-file'))if(leaf.view.getState().target.registrationId===${JSON.stringify(node.registration)})leaf.detach();return 'closed fixture files'})()`
    ).catch(() => {})
    await node.close()
    evalRaw(`document.querySelector('.modal-close-button')?.click()`)
  }
}

it('searches ordinary files opened from changes, the tree and chat links in desktop and phone layouts', async () => {
  await fileSearchScenario('desktop')
  await withEmulatedPhone(() => fileSearchScenario('phone'))
}, 240000)
