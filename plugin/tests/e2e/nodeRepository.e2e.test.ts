import { expect, it } from 'vitest'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { evalLong, evalRaw } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const cli = process.env.ABELE_NODE_CLI
const draftText = 'export const value = 5\n' + '// Sample context line\n'.repeat(100)
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const SHOTS = shotDir('abele-node-repository')
// The files and the README of a node home span its whole width, as a GitHub home's main column does.
// On a desktop both sidebars fold away first, so the home is wide enough for side-by-side columns.
const homeFills = `const homeFills=async(root,shot,wide)=>{
  await until(()=>root.querySelector('.abele-github-folder__readme')?.textContent.includes('Sample repository'));
  const splits=wide?[app.workspace.leftSplit,app.workspace.rightSplit].filter(s=>!s.collapsed):[];
  try{
    for(const split of splits)split.collapse();
    if(wide)await until(()=>root.getBoundingClientRect().width>=760);
    await wait(300);
    const capture=await require('@electron/remote').getCurrentWebContents().capturePage();
    require('fs').writeFileSync(${JSON.stringify(SHOTS)}+'/'+shot,capture.toPNG());
    const width=root.getBoundingClientRect().width;
    for(const [name,el] of [['files',root.querySelector('.abele-github-folder__list')],['README',root.querySelector('.abele-github-folder__readme')]])
      if(Math.abs(el.getBoundingClientRect().width-width)>4)throw Error('Node home '+name+' does not fill the tab: '+el.getBoundingClientRect().width+' of '+width);
  }finally{for(const split of splits)split.expand()}
};`
const prelude = `const api=window.__abeleTest,nodes=api.NodeService.getInstance();const wait=ms=>new Promise(r=>setTimeout(r,ms));const until=async f=>{for(let i=0;i<200;i++){if(f())return;await wait(50)}throw Error('Repository UI did not settle: '+f.toString())};`
const committedBlame = `const committedBlame=async (node,project,workspace,shot)=>{
  const open=path=>api.openNodeRepository(node,project,workspace,{path});
  await open('history.ts');
  await until(()=>document.querySelector('.abele-github-blob')?.textContent.includes('third = 30'));
  const toggle=document.querySelector('[aria-label="Toggle line blame"]');
  if(toggle.getAttribute('aria-pressed')!=='true')toggle.click();
  await until(()=>{const names=[...document.querySelectorAll('.abele-github-blame-range__name')].map(e=>e.textContent.trim());return names.includes('Ivy')&&names.includes('Noah')});
  await wait(300);
  const rows=[...document.querySelectorAll('.abele-github-blame-range')];
  const dates=new Set();
  for(const row of rows){
    for(const selector of ['.abele-github-blame-range__name','.abele-github-blame-range__date']){
      const label=row.querySelector(selector);
      if(!label.textContent.trim()||label.scrollWidth>label.clientWidth+1)throw Error('Blame attribution clipped: '+label.outerHTML);
    }
    dates.add(row.querySelector('.abele-github-blame-range__date').textContent.trim());
    if(row.textContent.includes('Committed fixture details'))throw Error('Commit message is inline');
    if(!row.querySelector('button').getAttribute('aria-label')?.includes('Committed fixture details'))throw Error('Full commit message is missing from tooltip');
  }
  if(dates.size<2)throw Error('Blame dates are not distinct');
  const gutter=document.querySelector('.abele-github-blame');
  const edges=(el,margin=false)=>{const style=getComputedStyle(el);return ['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth',...(margin?['marginLeft','marginRight']:[])].reduce((sum,key)=>sum+(parseFloat(style[key])||0),0)};
  // Include the CodeMirror gutterElement and marker host, not just the Vue range header.
  const natural=Math.max(...rows.map(row=>{let width=row.getBoundingClientRect().width;for(let el=row.parentElement;el&&el!==gutter;el=el.parentElement)width+=edges(el,true);return width}));
  const chrome=edges(gutter);
  const capture=await require('@electron/remote').getCurrentWebContents().capturePage();
  require('fs').writeFileSync(${JSON.stringify(SHOTS)}+'/'+shot,capture.toPNG());
  if(Math.abs(gutter.getBoundingClientRect().width-natural-chrome)>3)throw Error('Blame column does not fit its content: '+JSON.stringify({gutter:gutter.getBoundingClientRect().width,chrome,rows:rows.map(row=>({text:row.textContent,width:row.getBoundingClientRect().width,parent:row.parentElement.getBoundingClientRect().width,button:row.querySelector('button').getBoundingClientRect().width}))}));
  await open('app.ts');
  await until(()=>document.querySelector('.abele-github-blob')?.textContent.includes('export const value'));
};`
it('opens the real node repository in the shared tab, follows history, compares, searches and refreshes external edits', async () => {
  if (!cli) throw new Error('Set ABELE_NODE_CLI to the built node CLI')
  mkdirSync('../.scratch', { recursive: true })
  const dir = mkdtempSync(resolve('../.scratch/r-')),
    projectPath = resolve(dir, 'sample-project')
  mkdirSync(projectPath)
  let identity = {
    GIT_AUTHOR_NAME: 'Ivy',
    GIT_AUTHOR_EMAIL: 'ivy@example.invalid',
    GIT_COMMITTER_NAME: 'Ivy',
    GIT_COMMITTER_EMAIL: 'ivy@example.invalid',
    GIT_AUTHOR_DATE: new Date(Date.now() - 8 * 86400_000).toISOString(),
    GIT_COMMITTER_DATE: new Date(Date.now() - 8 * 86400_000).toISOString(),
  }
  const git = (...args: string[]) =>
    promisify(execFile)('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: projectPath,
      env: { ...process.env, ...identity },
    })
  await git('init', '--initial-branch=main')
  writeFileSync(resolve(projectPath, 'app.ts'), 'export const value = 1\n')
  writeFileSync(resolve(projectPath, 'README.md'), '# Sample repository\n')
  writeFileSync(
    resolve(projectPath, 'history.ts'),
    'export const first = 1\nexport const second = 2\nexport const third = 3\nexport const fourth = 4\n'
  )
  await git('add', '.')
  await git(
    '-c',
    'user.name=Sample',
    '-c',
    'user.email=sample@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Add sample files\n\nCommitted fixture details from the first author.'
  )
  identity = {
    GIT_AUTHOR_NAME: 'Noah',
    GIT_AUTHOR_EMAIL: 'noah@example.invalid',
    GIT_COMMITTER_NAME: 'Noah',
    GIT_COMMITTER_EMAIL: 'noah@example.invalid',
    GIT_AUTHOR_DATE: new Date(Date.now() - 2 * 86400_000).toISOString(),
    GIT_COMMITTER_DATE: new Date(Date.now() - 2 * 86400_000).toISOString(),
  }
  writeFileSync(
    resolve(projectPath, 'history.ts'),
    'export const first = 1\nexport const second = 2\nexport const third = 30\nexport const fourth = 40\n'
  )
  await git('add', 'history.ts')
  await git(
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Update sample history\n\nCommitted fixture details from the second author.'
  )
  const head = (await git('rev-parse', 'HEAD')).stdout.trim()
  await git('worktree', 'add', '-b', 'feature', resolve(dir, 'external-worktree'))
  writeFileSync(resolve(projectPath, 'app.ts'), 'export const value = 2\n')
  await git('add', 'app.ts')
  writeFileSync(resolve(projectPath, 'app.ts'), 'export const value = 3\n')
  writeFileSync(resolve(projectPath, 'new.txt'), 'Untracked sample\n')
  let child: ChildProcess | undefined,
    registration = ''
  const env = { ...process.env, ABELE_CLAUDE_PATH: resolve('tests/fixtures/nodeClaude.mjs') }
  try {
    const enrolled = JSON.parse(
      (
        await promisify(execFile)(
          process.execPath,
          [cli, 'token', 'create', 'sample-reader', '--state-dir', dir, '--json'],
          { env }
        )
      ).stdout
    )
    child = spawn(process.execPath, [cli, 'start', '--state-dir', dir, '--port', '0', '--json'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = '',
      errors = ''
    child.stdout!.on('data', (data) => {
      output += data
    })
    child.stderr!.on('data', (data) => {
      errors += data
    })
    for (let i = 0; i < 300 && !output.includes('"listening"'); i++) {
      if (child.exitCode !== null) throw new Error(errors)
      await pause(20)
    }
    const ready = JSON.parse(output.split('\n').find((line) => line.includes('"listening"'))!)
    registration = await evalLong(`(async()=>{${prelude}
      const node=await nodes.add('Sample repository node','http://127.0.0.1:${ready.port}',${JSON.stringify(enrolled.token)});
      window.__sampleRepositoryNode=node.id;
      const client=nodes.connection(node.id).client,project=await client.registerProject(${JSON.stringify(projectPath)},'trusted');
      await client.setRepositorySettings({project_id:project.project_id,external_read:false,default_branch:'main'});
      const catalogue=await client.repository.worktrees({project_id:project.project_id,include_selection:true});
      const workspace=catalogue.entries.find(w=>w.kind==='root');
      window.__sampleRepositoryProject=project.project_id;window.__sampleRepositoryWorkspace=workspace.worktree_id;
      // A folder as a whole opens in the node panel, with that place chosen, not in a tab.
      await api.openNodeRepository(node.id,project.project_id,workspace.worktree_id);
      const panel=()=>document.querySelector('.abele-node-sidebar');
      await until(()=>panel()?.querySelector('.abele-node-place__name')?.textContent.trim()==='main'&&panel().querySelector('.abele-node-place__where')?.textContent.trim()==='sample-project');
      if(app.workspace.getLeavesOfType('abele-github').some(l=>l.view.model?.sourceTarget?.source?.node===node.id))throw Error('The folder opened a repository tab');
      return node.id;
    })()`)
    // The worktrees and the independent status columns are the node panel's: a partly staged file
    // is both a change and staged, an untracked one only a change, and the external worktree is
    // offered to attach from the place's menu.
    await evalLong(`(async()=>{${prelude}
      const panel=()=>document.querySelector('.abele-node-sidebar');
      const changes=panel().querySelector('.abele-node-modes [role="tab"][aria-label^="Changes"]');
      if(changes.getAttribute('aria-selected')!=='true')changes.click();
      const group=title=>[...panel().querySelectorAll('.abele-file-tree__group')].find(g=>g.querySelector(':scope > .tree-item-self .abele-tree-item__text')?.textContent.trim()===title);
      const paths=title=>[...(group(title)?.querySelectorAll('.tree-item-self[data-path]')??[])].map(r=>r.dataset.path);
      await until(()=>paths('Changes').includes('app.ts')&&paths('Changes').includes('new.txt')&&paths('Staged').includes('app.ts'));
      if(paths('Staged').includes('new.txt'))throw Error('An untracked file is shown as staged');
      panel().querySelector('.abele-node-place > .abele-obsidian-icon').click();
      await until(()=>[...document.querySelectorAll('.menu-item')].some(el=>el.querySelector('.menu-item-title')?.textContent.trim()==='Attach a worktree'&&!el.classList.contains('is-disabled')));
      [...document.querySelectorAll('.menu-item')].find(el=>el.querySelector('.menu-item-title')?.textContent.trim()==='Attach a worktree').click();
      await until(()=>document.querySelector('.modal.abele-modal')?.textContent.includes('Agent execution still needs separate approval'));
      require('fs').writeFileSync(${JSON.stringify(SHOTS)}+'/attach-permission-desktop.png',(await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG());
      [...document.querySelectorAll('.modal.abele-modal button')].find(button=>button.textContent.trim()==='Allow editing').click();
      await until(()=>[...document.querySelectorAll('.prompt .suggestion-item')].some(el=>el.querySelector('.suggestion-title')?.textContent==='feature'&&el.querySelector('.suggestion-note')?.textContent.includes('external-worktree')));
      require('fs').writeFileSync(${JSON.stringify(SHOTS)}+'/attach-picker-desktop.png',(await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG());
      [...document.querySelectorAll('.prompt .suggestion-item')].find(el=>el.querySelector('.suggestion-title')?.textContent==='feature').click();
      await until(()=>!document.querySelector('.prompt'));
      await until(()=>panel().querySelector('.abele-node-place__name')?.textContent.trim()==='feature');
      const connection=nodes.connection(window.__sampleRepositoryNode);
      window.__sampleRepositoryExternal=api.NodePathService.getInstance().model(window.__sampleRepositoryNode).current.value.id;
      if(!(await connection.client.repository.editingStatus({worktree_id:window.__sampleRepositoryExternal})).enabled)throw Error('Attaching did not enable the approved file editing');
      require('fs').writeFileSync(${JSON.stringify(SHOTS)}+'/attached-worktree-desktop.png',(await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG());
      await api.NodePathService.getInstance().model(window.__sampleRepositoryNode).select(window.__sampleRepositoryWorkspace);
      await until(()=>panel().querySelector('.abele-node-place__name')?.textContent.trim()==='main');
      // The independent save-lock scenario below starts with its approval explicitly revoked.
      await connection.client.repository.editing({worktree_id:window.__sampleRepositoryExternal,enabled:false});
      return 'panel status';
    })()`)
    await evalLong(`(async()=>{${prelude}
      const panel=()=>document.querySelector('.abele-node-sidebar');
      const row=path=>panel().querySelector('[data-path="'+path+'"]');
      const files=panel().querySelector('.abele-node-modes [role="tab"][aria-label^="Files"]');files.click();
      await until(()=>row('README.md'));
      const operate=async(path,label,value)=>{
        row(path).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:200}));
        await until(()=>[...document.querySelectorAll('.menu-item')].some(item=>item.querySelector('.menu-item-title')?.textContent.trim()===label));
        [...document.querySelectorAll('.menu-item')].find(item=>item.querySelector('.menu-item-title')?.textContent.trim()===label).click();
        await until(()=>document.querySelector('.modal.abele-modal'));
        const modal=document.querySelector('.modal.abele-modal');
        if(value!==undefined){const input=modal.querySelector('input');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));await wait(50)}
        const submit=label.startsWith('New ')?'Create':label;
        [...modal.querySelectorAll('button')].find(button=>button.textContent.trim()===submit).click();
        await until(()=>!document.querySelector('.modal.abele-modal'));
      };
      await operate('README.md','New folder…','sample-created');
      await until(()=>row('sample-created'));
      row('sample-created').click();
      const model=api.NodePathService.getInstance().model(window.__sampleRepositoryNode);
      await until(()=>model.entries.value.find(entry=>entry.path==='sample-created')?.children!==undefined);
      await operate('sample-created','New file…','sample-created/new-file.ts');
      await until(()=>row('sample-created/new-file.ts'));
      await operate('sample-created/new-file.ts','Rename…','sample-created/renamed.ts');
      await until(()=>row('sample-created/renamed.ts')&&!row('sample-created/new-file.ts'));
      await operate('sample-created/renamed.ts','Move…','sample-moved.ts');
      await until(()=>row('sample-moved.ts')&&!row('sample-created/renamed.ts'));
      await operate('sample-moved.ts','Delete…');
      await until(()=>!row('sample-moved.ts'));
      for(const leaf of app.workspace.getLeavesOfType('abele-node-file'))if(leaf.getViewState().state?.target?.registrationId===window.__sampleRepositoryNode)leaf.detach();
      return 'file operations applied and tree refreshed';
    })()`)
    const state = JSON.parse(
      await evalLong(`(async()=>{${prelude}
      // The tab's home is the folder's top level, with no file tree beside it.
      await api.openNodeRepository(window.__sampleRepositoryNode,window.__sampleRepositoryProject,window.__sampleRepositoryWorkspace,{location:{kind:'home'}});
      const view=await (async()=>{let found;await until(()=>(found=app.workspace.getLeavesOfType('abele-github').find(l=>l.view.model?.sourceTarget?.provider==='node')?.view)?.contentEl.querySelector('.abele-github-folder')?.textContent.includes('app.ts'));return found})();
      const root=view.contentEl.querySelector('.abele-github-folder');
      if(view.contentEl.querySelector('.abele-github-home'))throw Error('A node tab still has a home page');
      if(view.contentEl.querySelector('.abele-github-tree'))throw Error('A node tab still has a file tree beside it');
      if(!view.contentEl.querySelector('[aria-label="Show in the node panel"]'))throw Error('Show in the node panel is missing');
      ${homeFills}await homeFills(root,'desktop-home.png',true);
      const state=view.getState();if(JSON.stringify(state).includes('127.0.0.1')||JSON.stringify(state).includes(${JSON.stringify(enrolled.token)}))throw Error('Credentials leaked into state');
      const fileRow=[...root.querySelectorAll('.abele-github-folder__list .tree-item-self')].find(el=>el.textContent.includes('app.ts'));
      if(!fileRow)throw Error('Ordinary repository file navigation is missing');fileRow.click();
      await until(()=>document.querySelector('.abele-github-blob')?.textContent.includes('value = 3'));
      document.querySelector('[aria-label="Toggle line blame"]').click();await until(()=>document.querySelector('.abele-github-blame-range')?.textContent.includes('Uncommitted'));
      ${committedBlame}await committedBlame(window.__sampleRepositoryNode,window.__sampleRepositoryProject,window.__sampleRepositoryWorkspace,'blame-committed-desktop.png');
      document.querySelector('[aria-label="Repository actions"]').click();
      await until(()=>[...document.querySelectorAll('.menu-item')].some(el=>el.textContent.trim()==='File history'));
      [...document.querySelectorAll('.menu-item')].find(el=>el.textContent.trim()==='File history').click();await until(()=>document.querySelector('.abele-github-commits')?.textContent.includes('Add sample files'));
      const search=[...document.querySelectorAll('.abele-github-header .abele-obsidian-icon')].find(el=>el.getAttribute('aria-label')?.startsWith('Search the code'));if(!search)throw Error('Search action missing: '+[...document.querySelectorAll('.abele-github-header .abele-obsidian-icon')].map(el=>el.outerHTML).join('|'));search.click();
      await until(()=>document.querySelector('.abele-github-search input'));const input=document.querySelector('.abele-github-search input');input.value='value';input.dispatchEvent(new Event('input',{bubbles:true}));
      await until(()=>document.querySelector('.abele-github-search__results')?.textContent.includes('app.ts'));
      {const capture=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(SHOTS)}+'/search-live-desktop.png',capture.toPNG())}
      return JSON.stringify(state);
    })()`)
    )
    expect(state.sourceTarget.provider).toBe('node')
    const ids = JSON.parse(
      evalRaw(
        `JSON.stringify({project:window.__sampleRepositoryProject,workspace:window.__sampleRepositoryWorkspace})`
      )
    )
    writeFileSync(resolve(projectPath, 'app.ts'), 'export const value = 4\n')
    await evalLong(
      `(async()=>{${prelude}await until(()=>document.querySelector('.abele-github-blob')?.textContent.includes('value = 4'));return 'refreshed'})()`
    )
    await evalLong(`(async()=>{${prelude}
      const code=document.querySelector('.abele-github-blob > .abele-github-code .cm-content');
      if(code.contentEditable!=='true')throw Error('Current working file is not editable in the tab');
      const editor=api.codeView(code);editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:${JSON.stringify(draftText)}},selection:{anchor:10}});
      await until(()=>[...document.querySelectorAll('.abele-node-save button')].some(b=>b.textContent.trim()==='Save file'&&!b.disabled));
      const scroller=code.closest('.abele-github-layout__main');
      // A human scroll interrupts the refresh settling pin before choosing the fixture offset.
      scroller.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:400}));scroller.scrollTop=400;await wait(100);
      window.__sampleRepositoryScroll=scroller.scrollTop;if(scroller.scrollTop<100)throw Error('Scroll fixture was not tall enough');
      window.__sampleRepositoryCursor=editor.state.selection.main.anchor;return 'draft retained';
    })()`)
    writeFileSync(resolve(projectPath, 'app.ts'), 'export const value = 6\n')
    await evalLong(`(async()=>{${prelude}
      await until(()=>document.querySelector('.abele-node-save__state')?.textContent.includes('Changed on disk'));
      const code=document.querySelector('.abele-github-blob > .abele-github-code .cm-content'),editor=api.codeView(code);
      if(!editor.state.doc.toString().includes('value = 5'))throw Error('Refresh lost the draft');
      if(editor.state.selection.main.anchor!==window.__sampleRepositoryCursor)throw Error('Refresh lost the cursor');
      if(Math.abs(code.closest('.abele-github-layout__main').scrollTop-window.__sampleRepositoryScroll)>1)throw Error('Refresh lost the scroll position: '+JSON.stringify({expected:window.__sampleRepositoryScroll,actual:code.closest('.abele-github-layout__main').scrollTop,height:code.closest('.abele-github-layout__main').scrollHeight,viewport:code.closest('.abele-github-layout__main').clientHeight,lines:editor.state.doc.lines,cursor:editor.state.selection.main.anchor}));
      if(document.querySelector('.abele-node-save').textContent.includes('Use loaded version as base'))throw Error('Duplicate reconciliation action');
      const choices=[...document.querySelectorAll('.abele-node-save__state button')].map(b=>b.textContent.trim());
      if(JSON.stringify(choices)!==JSON.stringify(['Reload','Keep mine']))throw Error('Unexpected reconciliation choices: '+choices);
      [...document.querySelectorAll('.abele-node-save__state button')].find(b=>b.textContent.trim()==='Keep mine').click();
      await until(()=>!document.querySelector('.abele-node-save__state')&&[...document.querySelectorAll('.abele-node-save button')].some(b=>b.textContent.trim()==='Save file'&&!b.disabled));
      return 'new disk base adopted without saving';
    })()`)
    expect(readFileSync(resolve(projectPath, 'app.ts'), 'utf8')).toBe('export const value = 6\n')
    // A second external writer wins after explicit adoption; Save must still detect that race.
    writeFileSync(resolve(projectPath, 'app.ts'), 'export const value = 9\n')
    await evalLong(`(async()=>{${prelude}
      [...document.querySelectorAll('.abele-node-save button')].find(b=>b.textContent.trim()==='Save file').click();
      await until(()=>document.querySelector('.abele-node-save')?.textContent.includes('Conflict ·'));
      return 'conflict retained';
    })()`)
    expect(readFileSync(resolve(projectPath, 'app.ts'), 'utf8')).toBe('export const value = 9\n')
    await evalLong(`(async()=>{${prelude}
      [...document.querySelectorAll('.abele-node-save__state button')].find(b=>b.textContent.trim()==='Keep mine').click();
      await until(()=>!document.querySelector('.abele-node-save__state')&&[...document.querySelectorAll('.abele-node-save button')].some(b=>b.textContent.trim()==='Save file'&&!b.disabled));
      [...document.querySelectorAll('.abele-node-save button')].find(b=>b.textContent.trim()==='Save file').click();
      await until(()=>document.querySelector('.abele-node-save')?.textContent.includes('Saved ·'));
      await api.openNodeRepository(window.__sampleRepositoryNode,window.__sampleRepositoryProject,window.__sampleRepositoryExternal,{path:'app.ts'});
      const external=app.workspace.getLeavesOfType('abele-github').find(l=>l.view.model?.sourceTarget?.source.workspace===window.__sampleRepositoryExternal).view.contentEl;
      await until(()=>external.querySelector('[aria-label="Allow external workspace editing"]'));
      await until(()=>external.querySelector('.abele-github-blob > .abele-github-code .cm-content'));
      if(external.querySelector('.abele-github-blob > .abele-github-code .cm-content').contentEditable!=='false')throw Error('External editing was enabled without approval');
      external.querySelector('[aria-label="Allow external workspace editing"]').click();
      await until(()=>[...document.querySelectorAll('.modal button')].some(b=>b.textContent.trim()==='Allow editing'));
      [...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='Allow editing').click();
      await until(()=>external.querySelector('.abele-github-blob > .abele-github-code .cm-content')?.contentEditable==='true');
      const code=external.querySelector('.abele-github-blob > .abele-github-code .cm-content'),editor=api.codeView(code);
      editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:'export const value = 7\\n'}});
      await until(()=>[...external.querySelectorAll('.abele-node-save button')].some(b=>b.textContent.trim()==='Save file'&&!b.disabled));
      [...external.querySelectorAll('.abele-node-save button')].find(b=>b.textContent.trim()==='Save file').click();
      await until(()=>external.querySelector('.abele-node-save')?.textContent.includes('Saved ·'));
      external.querySelector('[aria-label="Allow external workspace editing"]').click();
      await until(()=>[...document.querySelectorAll('.modal button')].some(b=>b.textContent.trim()==='Turn off editing'));
      [...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='Turn off editing').click();
      await until(()=>external.querySelector('.abele-github-blob > .abele-github-code .cm-content')?.contentEditable==='false');
      return 'external approval and revocation verified';
    })()`)
    expect(readFileSync(resolve(projectPath, 'app.ts'), 'utf8')).toBe(draftText)
    expect(readFileSync(resolve(dir, 'external-worktree/app.ts'), 'utf8')).toBe(
      'export const value = 7\n'
    )
    await evalLong(`(async()=>{${prelude}
      const session={conversationVersion:{value:0},branchSelectionVersion:0},context={session,interactive:true};
      const tools=api.createAgentTools({everything:true,nodeRepositoryApproval:async()=>true});
      const ids={node:window.__sampleRepositoryNode,project:window.__sampleRepositoryProject,workspace:window.__sampleRepositoryWorkspace,path:'app.ts'};
      const read=await tools.find(t=>t.name==='node_file').execute('read',ids,undefined,context);
      const contentId=read.content[0].text.match(/Exact file content identity: ([a-f0-9]{64})/)[1];
      const proposal=tools.find(t=>t.name==='node_propose_edit'),params={...ids,expected_content_id:contentId,text:'export const value = 8\\n'};
      let refused=false;try{await proposal.execute('unapproved',params,undefined,context)}catch(e){refused=e.message.includes('per-edit')}
      if(!refused)throw Error('Proposal accepted without per-edit approval');
      await proposal.execute('approved',params,undefined,{...context,approved:true});
      await until(()=>[...document.querySelectorAll('.abele-github-blob > .abele-github-code .cm-content')].some(el=>el.getBoundingClientRect().width&&el.textContent.includes('value = 8')));
      return 'proposal retained without a node save';
    })()`)
    expect(readFileSync(resolve(projectPath, 'app.ts'), 'utf8')).toBe(draftText)
    await evalLong(`(async()=>{${prelude}
      const root=app.workspace.getLeavesOfType('abele-github').find(l=>l.view.model?.sourceTarget?.source.workspace===window.__sampleRepositoryWorkspace).view.contentEl;
      root.querySelector('.abele-node-save [aria-label="Reload current version"]').click();
      await until(()=>[...document.querySelectorAll('.modal button')].some(b=>b.textContent.trim()==='Cancel'));
      [...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='Cancel').click();
      await until(()=>!document.querySelector('.modal')&&!root.querySelector('.abele-node-save [aria-label="Reload current version"]').disabled);
      if(!root.querySelector('.abele-github-blob > .abele-github-code').textContent.includes('value = 8'))throw Error('Cancel lost the draft');
      root.querySelector('.abele-node-save [aria-label="Reload current version"]').click();
      await until(()=>[...document.querySelectorAll('.modal button')].some(b=>b.textContent.trim()==='Reload'));
      [...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='Reload').click();
      await until(()=>root.querySelector('.abele-github-blob > .abele-github-code')?.textContent.includes('value = 5'));
      return 'reload confirmed from disk';
    })()`)
    expect(readFileSync(resolve(projectPath, 'app.ts'), 'utf8')).toBe(draftText)
    await evalLong(`(async()=>{${prelude}
      await api.openNodeRepository(window.__sampleRepositoryNode,window.__sampleRepositoryProject,window.__sampleRepositoryWorkspace,{location:{kind:'comparison',base:${JSON.stringify(head)},head:'Working tree',direct:true}});
      await until(()=>document.querySelector('.abele-github-compare')?.textContent.includes('value = 5'));
      document.querySelector('[aria-label="Choose changes to review"]').click();
      await until(()=>[...document.querySelectorAll('.menu-item')].some(el=>el.textContent.trim()==='Ready for commit'));
      [...document.querySelectorAll('.menu-item')].find(el=>el.textContent.trim()==='Ready for commit').click();
      await until(()=>document.querySelector('.abele-github-compare')?.textContent.includes('value = 2'));
      return 'compared';
    })()`)
    await withEmulatedPhone(() =>
      evalLong(`(async()=>{${prelude}${homeFills}
        await api.openNodeRepository(${JSON.stringify(registration)},${JSON.stringify(ids.project)},${JSON.stringify(ids.workspace)},{location:{kind:'home'}});
        await until(()=>[...document.querySelectorAll('.abele-github-folder')].some(el=>el.getBoundingClientRect().width));
        await homeFills([...document.querySelectorAll('.abele-github-folder')].find(el=>el.getBoundingClientRect().width),'phone-home.png',false);
        ${committedBlame}await committedBlame(${JSON.stringify(registration)},${JSON.stringify(ids.project)},${JSON.stringify(ids.workspace)},'blame-committed-phone.png');
        const search=[...document.querySelectorAll('.abele-github-header .abele-obsidian-icon')].find(el=>el.getAttribute('aria-label')?.startsWith('Search the code'));search.click();
        await until(()=>document.querySelector('.abele-github-search input'));const input=document.querySelector('.abele-github-search input');input.value='value';input.dispatchEvent(new Event('input',{bubbles:true}));
        await until(()=>document.querySelector('.abele-github-search__results')?.textContent.includes('app.ts'));
        {const capture=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(SHOTS)}+'/search-live-phone.png',capture.toPNG())}
        // The phone keeps a layout of its own; the tab this probe opened must not stay saved in it.
        for(const leaf of app.workspace.getLeavesOfType('abele-github'))leaf.detach();
        await app.workspace.requestSaveLayout.run();
        return 'phone home fills';
      })()`)
    )
  } finally {
    try {
      await evalLong(
        `(async()=>{const id=${JSON.stringify(registration)}||window.__sampleRepositoryNode;for(const leaf of app.workspace.getLeavesOfType('abele-github'))if((leaf.view.model?.sourceTarget??leaf.getViewState().state?.sourceTarget)?.source?.node===id)leaf.detach();for(const leaf of app.workspace.getLeavesOfType('abele-node-file'))if(leaf.getViewState().state?.target?.registrationId===id)leaf.detach();for(const leaf of app.workspace.getLeavesOfType('abele-node-sidebar'))leaf.detach();if(id)window.__abeleTest.NodeService.getInstance().remove(id);delete window.__sampleRepositoryNode;delete window.__sampleRepositoryProject;delete window.__sampleRepositoryWorkspace;delete window.__sampleRepositoryExternal;delete window.__sampleRepositoryCursor;delete window.__sampleRepositoryScroll;document.querySelector('.modal-close-button')?.click();return 'restored'})()`
      )
    } finally {
      if (child?.exitCode === null) {
        child.kill('SIGTERM')
        await new Promise<void>((resolve) => child!.once('exit', () => resolve()))
      }
      rmSync(dir, { recursive: true, force: true })
    }
  }
}, 120000)
