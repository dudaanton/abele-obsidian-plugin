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
    if(document.body.classList.contains('is-phone')&&input.getBoundingClientRect().width<file().querySelector('[role=search]').getBoundingClientRect().width*.75)throw Error('Find input does not get the phone width');return 'matches'})()`)
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
        const leaves=app.workspace.getLeavesOfType('abele-node-file'),repos=app.workspace.getLeavesOfType('abele-github').length,leaf=leaves.find(l=>l.view.contentEl.contains(file()));const row=file().querySelectorAll('.cm-line')[1],range=document.createRange();range.selectNodeContents(row);const box=range.getBoundingClientRect(),point={bubbles:true,cancelable:true,clientX:box.left+box.width/2,clientY:box.top+box.height/2};
        row.dispatchEvent(new MouseEvent('mousedown',{...point,metaKey:require('process').platform==='darwin',ctrlKey:require('process').platform!=='darwin',button:0}));
        await until(()=>leaf.view.getState().line===1&&!leaf.view.getState().endLine,'Modifier-click definition');
        if(app.workspace.getLeavesOfType('abele-node-file').length!==leaves.length||app.workspace.getLeavesOfType('abele-github').length!==repos)throw Error('Same-file definition opened another tab');
        if(file().closest('.abele-node-main').querySelector('[role=alert]'))throw Error('Unchanged file became stale');
        file().querySelectorAll('.cm-line')[1].dispatchEvent(new MouseEvent('contextmenu',point));
        await until(()=>[...document.querySelectorAll('.menu-item')].find(el=>el.textContent.includes('Go to definition of')),'Definition menu');[...document.querySelectorAll('.menu-item')].find(el=>el.textContent.includes('Go to definition of')).click();await until(()=>file()?.querySelector('.abele-github-code__line_target')&&leaf.view.getState().line===1&&!leaf.view.getState().endLine,'Definition destination');return 'definition'})()`)
  await capture(`${shell}-${entry}-definition`)
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
    writeFileSync(
      resolve(project, 'src/matches.ts'),
      Array.from({ length: 105 }, (_, i) => `// contentNeedle ${i + 1}`).join('\n') + '\n'
    )
    writeFileSync(
      resolve(project, 'src/other.ts'),
      '// sample source\nexport const sharedValue = "contentNeedle"\n'
    )
    writeFileSync(resolve(project, 'sample-binary.bin'), Buffer.from('contentNeedle\u0000sample'))
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
    writeFileSync(
      resolve(project, 'src/sample.ts'),
      'export const marker = 2\nmarker\nsharedValue\n'
    )
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
      await evalLong(`(async()=>{${prelude}
        file().querySelector('[data-node-search]').click();await until(()=>file()?.querySelector('.abele-github-search input'),'File-tab code search');
        const input=file().querySelector('.abele-github-search input');input.value='contentNeedle';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
        await until(()=>file()?.querySelectorAll('.abele-github-search__line').length===106&&file().querySelector('mark')?.textContent==='contentNeedle','Highlighted whole-project results in file tab');return 'file-tab content search'})()`)
      await capture(`${shell}-file-tab-content-search`)
      await evalLong(
        `(async()=>{${prelude}file().querySelector('[aria-label="Close code search"]').click();await until(()=>!file()?.querySelector('.abele-github-search'),'File-tab code search closes');return 'closed code search'})()`
      )
      await evalLong(`(async()=>{${prelude}
        const current=app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.contentEl.contains(file())),before=app.workspace.getLeavesOfType('abele-node-file').length;
        const jump=()=>{const row=file().querySelectorAll('.cm-line')[2],range=document.createRange();range.selectNodeContents(row);const box=range.getBoundingClientRect();row.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,clientX:box.left+box.width/2,clientY:box.top+box.height/2,metaKey:require('process').platform==='darwin',ctrlKey:require('process').platform!=='darwin'}))};jump();
        await until(()=>file()?.textContent.includes('export const sharedValue'),'Other-file definition');
        const destination=app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.contentEl.contains(file()));if(destination===current||app.workspace.getLeavesOfType('abele-node-file').length!==before+1)throw Error('Other-file definition did not get its own tab');if(current.view.getState().path!=='src/sample.ts')throw Error('Definition replaced the source tab');
        await app.workspace.revealLeaf(current);await until(()=>file()?.textContent.includes('export const marker'),'Return to source');jump();await until(()=>destination.view.contentEl.contains(file()),'Reuse definition tab');if(app.workspace.getLeavesOfType('abele-node-file').length!==before+1)throw Error('Definition opened a duplicate destination');return 'cross-file definition and reuse'})()`)
      await capture(`${shell}-other-file-definition`)
      await closeFile()
      await sidebar('Files')
      await evalLong(`(async()=>{${prelude}
        await until(()=>visible('[data-node-project-search]'),'Project content search');visible('[data-node-project-search]').click();
        await until(()=>visible('.abele-github-search__query'),'Project search field');const input=visible('.abele-github-search__query');input.value='contentNeedle';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
        await until(()=>visible('.abele-github-search__match'),'Highlighted project matches');
        const search=visible('.abele-github-search');if(!search.textContent.includes('src/matches.ts')||!search.querySelector('.abele-github-search__number'))throw Error('Project results lack path or line');
        await until(()=>[...search.querySelectorAll('button')].find(b=>b.textContent.includes('Load more')),'Project search continuation');return 'first project page'})()`)
      await capture(`${shell}-project-content-page`)
      await evalLong(`(async()=>{${prelude}
        const search=visible('.abele-github-search');[...search.querySelectorAll('button')].find(b=>b.textContent.includes('Load more')).click();
        await until(()=>search.querySelectorAll('.abele-github-search__line').length===106,'All project search pages');
        if(!search.textContent.includes('Some files or matches were omitted'))throw Error('Missing plain search-limit explanation');return 'all project matches'})()`)
      await capture(`${shell}-project-content-all`)
      await evalLong(`(async()=>{${prelude}
        const result=[...visible('.abele-github-search').querySelectorAll('.abele-github-search__file')].find(el=>el.textContent.includes('src/other.ts'));result.querySelector('.abele-github-search__line').click();
        await until(()=>file()?.textContent.includes('sharedValue'),'Content result opens ordinary file');const leaf=app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.contentEl.contains(file()));if(leaf.view.getState().line!==2)throw Error('Content result lost its line');return 'content destination'})()`)
      await capture(`${shell}-project-content-destination`)
      await closeFile()
      await sidebar('Files')
      await evalLong(`(async()=>{${prelude}
        const search=visible('.abele-github-search'),input=search.querySelector('input');input.value='missingNeedle123';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await until(()=>search.querySelector('.abele-github-search__summary')&&!search.querySelector('.abele-github-search__line'),'Empty content search');return 'empty project search'})()`)
      await capture(`${shell}-project-content-empty`)
      await evalLong(`(async()=>{${prelude}
        const search=visible('.abele-github-search');search.querySelector('[aria-label="Read the query as a regular expression"]').click();const input=search.querySelector('input');input.value='[';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await until(()=>search.querySelector('.abele-github-search__error'),'Invalid regular expression');return 'project search error'})()`)
      await capture(`${shell}-project-content-error`)
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
