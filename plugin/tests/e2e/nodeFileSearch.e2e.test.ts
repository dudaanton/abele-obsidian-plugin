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
// A split comparison renders the read-only original first; editing targets its working pane.
const prelude = `${PAIRED_PRELUDE}
const visible=selector=>[...document.querySelectorAll(selector)].find(el=>el.getBoundingClientRect().width>0&&!el.closest('.workspace-leaf.mod-hidden'));
const file=()=>visible('.abele-file-view')??visible('.abele-node-main:has([data-node-find])');
const content=()=>file()?.querySelector('.cm-content[contenteditable="true"]')??file()?.querySelector('.cm-content');`

async function capture(name: string) {
  await evalLong(
    `(async()=>{await new Promise(r=>setTimeout(r,150));require('fs').writeFileSync(${JSON.stringify(resolve(shots, name + '.png'))},(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());return 'captured'})()`
  )
}

/** Check the real host command and native keymap, starting with the freshly opened file. */
async function search(shell: string, entry: string) {
  await evalLong(`(async()=>{${prelude}
    await until(()=>file()?.textContent.includes('sampleMarkerIdentifier'),'The ordinary file');
    const find=file().querySelector('[data-node-find]');if(!find)throw Error('Find button missing on ordinary file');
    find.click();await until(()=>file()?.querySelector('[role=search] input'),'Find button');
    const close=async()=>{file().querySelector('[role=search] input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await until(()=>!file().querySelector('[role=search]'),'Find closes')};
    await close();
    if(!app.commands.executeCommandById('editor:open-search'))throw Error('Current-file command unavailable');
    await until(()=>file()?.querySelector('[role=search] input'),'Current-file command');await close();
    content().focus();return 'button and host command'})()`)
  await evalLong(
    `(()=>{const web=require('@electron/remote').getCurrentWebContents(),modifiers=require('process').platform==='darwin'?['meta']:['control'];web.sendInputEvent({type:'keyDown',keyCode:'F',modifiers});web.sendInputEvent({type:'keyUp',keyCode:'F',modifiers});return 'native find'})()`
  )
  await evalLong(`(async()=>{${prelude}
    await until(()=>file()?.querySelector('[role=search] input'),'Native find');
    const input=file().querySelector('[role=search] input');if(document.activeElement!==input)throw Error('Find did not focus its input');
    input.value='sampleMarkerIdentifier';input.dispatchEvent(new Event('input',{bubbles:true}));
    await until(()=>file()?.querySelectorAll('.abele-github-find__match').length===2,'Both file matches').catch(async error=>{require('fs').writeFileSync(${JSON.stringify(resolve(shots, shell + '-' + entry + '-find-failure.png'))},(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());throw Error(String(error)+'; '+JSON.stringify({count:file()?.querySelector('.abele-github-find__count')?.textContent,editors:[...file().querySelectorAll('.cm-editor')].map(el=>({skip:el.hasAttribute('data-find-skip'),editable:el.querySelector('.cm-content')?.contentEditable,matches:el.querySelectorAll('.abele-github-find__match').length,text:el.textContent}))}))});
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
        file().querySelector('[aria-label="Toggle line blame"]').click();await until(()=>file()&&!file().querySelector('.abele-github-blame-range'),'Line blame closes');
        const leaves=app.workspace.getLeavesOfType('abele-node-file'),repos=app.workspace.getLeavesOfType('abele-github').length,leaf=leaves.find(l=>l.view.contentEl.contains(file()));const row=file().querySelectorAll('.cm-line')[1],position=el=>{const range=document.createRange();range.selectNodeContents(el);const box=range.getBoundingClientRect();return {bubbles:true,cancelable:true,clientX:box.left+box.width/2,clientY:box.top+box.height/2}},point=position(row);
        const debug=console.debug,observed=[];console.debug=(...args)=>{observed.push(args.map(value=>String(value)).join(' '));debug.apply(console,args)};
        try {
          row.dispatchEvent(new MouseEvent('mousedown',{...point,metaKey:require('process').platform==='darwin',ctrlKey:require('process').platform!=='darwin',button:0}));
          await until(()=>leaf.view.getState().line===1&&!leaf.view.getState().endLine,'Modifier-click definition');
        } catch(error) {
          throw Error(String(error)+'; '+JSON.stringify({state:leaf.view.getState(),observed,notices:[...document.querySelectorAll('.notice')].map(node=>node.textContent),roots:[...file().querySelectorAll('.abele-code-nav,.abele-lsp-root')].map(node=>node.className)}));
        } finally {console.debug=debug}
        if(app.workspace.getLeavesOfType('abele-node-file').length!==leaves.length||app.workspace.getLeavesOfType('abele-github').length!==repos)throw Error('Same-file definition opened another tab');
        if(file().closest('.abele-node-main').querySelector('[role=alert]'))throw Error('Unchanged file became stale');
        const menuRow=file().querySelectorAll('.cm-line')[1];menuRow.dispatchEvent(new MouseEvent('contextmenu',position(menuRow)));
        await until(()=>[...document.querySelectorAll('.menu-item')].find(el=>el.textContent.includes('Go to definition of')),'Definition menu');[...document.querySelectorAll('.menu-item')].find(el=>el.textContent.includes('Go to definition of')).click();await until(()=>file()?.querySelector('.abele-github-code__line_target, .abele-debug-source__line_here')&&leaf.view.getState().line===1&&!leaf.view.getState().endLine,'Definition destination');return 'definition'})()`)
  await capture(`${shell}-${entry}-definition`)
}

async function fileSearchScenario(shell: 'desktop' | 'phone') {
  const node = await startPairedNode()
  const project = resolve(node.state, '../sample-project')
  const matchesPath =
    'src/a-long-sample-directory/another-long-sample-directory/long-sample-matches.ts'
  const git = (...args: string[]) =>
    promisify(execFile)('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: project,
    })
  try {
    const comparisonBase = (await git('rev-parse', 'HEAD')).stdout.trim()
    mkdirSync(resolve(project, 'src'))
    mkdirSync(resolve(project, 'src/a-long-sample-directory/another-long-sample-directory'), {
      recursive: true,
    })
    writeFileSync(
      resolve(project, 'src/sample.ts'),
      'export const sampleMarkerIdentifier = 1\nsampleMarkerIdentifier\n'
    )
    writeFileSync(
      resolve(project, matchesPath),
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
      'export const sampleMarkerIdentifier = 2\nsampleMarkerIdentifier\nsharedValue\n'
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
          const model=api.NodePathService.getInstance().model(${JSON.stringify(node.registration)});await api.NodePathService.getInstance().ready(${JSON.stringify(node.registration)});if(model.current.value?.id!==${JSON.stringify(ids.root)}){await model.refresh();await model.select(${JSON.stringify(ids.root)})}
          let leaf=app.workspace.getLeavesOfType('abele-node-sidebar').find(l=>l.view.getState().registrationId===${JSON.stringify(node.registration)});if(!leaf){leaf=app.workspace.getLeftLeaf(false);await leaf.setViewState({type:'abele-node-sidebar',active:true,state:{registrationId:${JSON.stringify(node.registration)}}})}await app.workspace.revealLeaf(leaf);app.workspace.leftSplit.expand();
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
        await app.workspace.revealLeaf(current);await until(()=>file()?.textContent.includes('export const sampleMarkerIdentifier'),'Return to source');jump();await until(()=>destination.view.contentEl.contains(file()),'Reuse definition tab');if(app.workspace.getLeavesOfType('abele-node-file').length!==before+1)throw Error('Definition opened a duplicate destination');return 'cross-file definition and reuse'})()`)
      await capture(`${shell}-other-file-definition`)
      await closeFile()
      await sidebar('Files')
      await evalLong(`(async()=>{${prelude}
        await until(()=>visible('[data-node-project-search]'),'Project content search');visible('[data-node-project-search]').click();
        await until(()=>visible('.abele-github-search__query input'),'Project search field');const input=visible('.abele-github-search__query input');input.value='contentNeedle';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
        await until(()=>visible('.abele-github-search__match'),'Highlighted project matches');
        const search=visible('.abele-github-search');if(!search.textContent.includes(${JSON.stringify(matchesPath)})||!search.querySelector('.abele-github-search__number'))throw Error('Project results lack path or line');
        await until(()=>[...search.querySelectorAll('button')].find(b=>b.textContent.includes('Load more')),'Project search continuation');return 'first project page'})()`)
      await capture(`${shell}-project-content-page`)
      await evalLong(`(async()=>{${prelude}
        const search=visible('.abele-github-search'),more=[...search.querySelectorAll('button')].find(b=>b.textContent.includes('Load more'));more.scrollIntoView({block:'nearest'});await wait(150);const r=more.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);if(!hit||!more.contains(hit))throw Error('Project paging control is clipped or covered');
        if(!document.body.classList.contains('is-phone')){const bar=visible('.abele-file-tree__bar'),pane=bar.closest('.view-content');if(pane&&bar.getBoundingClientRect().top<pane.getBoundingClientRect().top-1)throw Error('Paging scrolls the fixed file search out of view')}return 'paging reachable'})()`)
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
          `(async()=>{${prelude}await chats.revealSidebar({focus:false});await until(()=>chat(),'Chat');const link=[...chat().querySelectorAll('a')].find(a=>a.textContent===${JSON.stringify(label)});if(!link)throw Error('Chat source link missing');link.click();await until(()=>file()?.textContent.includes('sampleMarkerIdentifier'),'Chat file opens');return 'clicked chat link'})()`
        )
        await search(shell, label.toLowerCase())
        await checkTools(shell, label.toLowerCase())
        await closeFile()
      }
      // A retained debugger source uses the same ordinary file tab and its search controls.
      await evalLong(`(async()=>{${prelude}
        const target={nodeId:${JSON.stringify(node.node)},registrationId:${JSON.stringify(node.registration)},projectId:${JSON.stringify(ids.project)},kind:'worktree',id:${JSON.stringify(ids.root)}};
        const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-node-file',active:true,state:{kind:'file',target,path:'src/sample.ts',debug:{conversationId:'sample-debug-chat',sourceId:'sample-source',debugSessionId:'sample-debug',incarnation:'sample-incarnation'}}});await app.workspace.revealLeaf(leaf);
        await until(()=>file()?.querySelector('.abele-debug-source__margin'),'Mapped source in ordinary file');return 'mapped source'})()`)
      await evalLong(`(async()=>{${prelude}
        const source=file().querySelector('.abele-debug-source'),leaf=app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.contentEl.contains(file()));leaf.view.file.mode.value='diff';await until(()=>file()?.querySelector('.abele-diff'),'Mapped-source comparison');
        if(!source.isConnected)throw Error('Comparison destroyed the mapped source');file().querySelector('[data-node-find]').click();await until(()=>file()?.querySelector('[role=search] input'),'Find from mapped comparison');if(file().querySelector('.abele-debug-source')!==source)throw Error('Find remounted the mapped source');file().querySelector('[role=search] input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await until(()=>!file()?.querySelector('[role=search]'),'Mapped comparison find closes');return 'mapped source retained'})()`)
      await search(shell, 'mapped-source')
      await checkTools(shell, 'mapped-source')
      await closeFile()
      for (const comparison of [false, true]) {
        if (comparison) {
          await evalLong(`(async()=>{${prelude}
            const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-node-file',active:true,state:{kind:'file',target:{nodeId:${JSON.stringify(node.node)},registrationId:${JSON.stringify(node.registration)},projectId:${JSON.stringify(ids.project)},kind:'worktree',id:${JSON.stringify(ids.root)}},path:'src/sample.ts',stage:{kind:'committed',base:${JSON.stringify(comparisonBase)}}}});await app.workspace.revealLeaf(leaf);await until(()=>file()?.querySelector('[data-node-find]'),'Committed comparison');return 'comparison file'})()`)
        } else {
          await node.open(ids.session, 'Source links')
          await evalLong(
            `(async()=>{${prelude}await chats.revealSidebar({focus:false});await until(()=>chat()?.querySelector('a'),'Chat source link');[...chat().querySelectorAll('a')].find(a=>a.textContent==='Source').click();await until(()=>file()?.querySelector('[data-node-find]'),'Ordinary file');return 'source file'})()`
          )
        }
        await evalLong(`(async()=>{${prelude}
        const leaf=app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.contentEl.contains(file())),edit=leaf.containerEl.querySelector('.view-action[aria-label="Edit the file"]');if(edit)edit.click();else{const menu=leaf.containerEl.querySelector('.view-action.mod-more-options, .view-action[aria-label="More options"]');if(!menu)throw Error('File view menu missing');menu.click();await until(()=>[...document.querySelectorAll('.menu-item')].find(i=>i.textContent.includes('Edit the file')),'Edit menu action');[...document.querySelectorAll('.menu-item')].find(i=>i.textContent.includes('Edit the file')).click()}
        await until(()=>file()?.querySelector('.cm-content[contenteditable="true"]')?.contentEditable==='true','Editable file').catch(async error=>{require('fs').writeFileSync(${JSON.stringify(resolve(shots, `${shell}-${comparison ? 'comparison' : 'file'}-edit-failure.png`))},(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());throw Error(String(error)+'; '+JSON.stringify({comparison:${comparison},state:leaf.view.getState(),active:leaf.view.editing?.active.value,locked:leaf.view.editing?.locked.value,text:leaf.view.contentEl.textContent,editors:[...leaf.view.contentEl.querySelectorAll('.cm-content')].map(el=>({editable:el.contentEditable,text:el.textContent})),modals:[...document.querySelectorAll('.modal')].map(el=>el.textContent)}))});return 'edit ordinary file'})()`)
        const entry = comparison ? 'edited-comparison' : 'edited-file'
        await search(shell, entry)
        await evalLong(`(async()=>{${prelude}
        const leaves=app.workspace.getLeavesOfType('abele-node-file'),leaf=leaves.find(l=>l.view.contentEl.contains(file())),repos=app.workspace.getLeavesOfType('abele-github').length,row=content().querySelectorAll('.cm-line')[1],range=document.createRange();range.selectNodeContents(row);const box=range.getBoundingClientRect();row.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,clientX:box.left+box.width/2,clientY:box.top+box.height/2,metaKey:require('process').platform==='darwin',ctrlKey:require('process').platform!=='darwin'}));
        await until(()=>leaf.view.getState().line===1&&file()?.querySelector('.abele-github-code__line_target'),'Definition inside edited file');if(!leaf.view.getState().edit||app.workspace.getLeavesOfType('abele-node-file').length!==leaves.length||app.workspace.getLeavesOfType('abele-github').length!==repos)throw Error('Edited definition replaced the editor or opened another tab');return 'edited definition'})()`)
        await capture(`${shell}-${entry}-definition`)
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
