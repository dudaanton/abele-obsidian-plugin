import { expect, it } from 'vitest'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import { connect, type Socket } from 'node:net'
import { evalLong, evalRaw, reloadApp } from './helpers/obsidianCli'
import { targets } from './helpers/target'

// The node side panel's own views, in the desktop and phone shells: the place row and its search
// over every worktree, one gone from disk among them; the header's modes, with a repository's
// changes under their groups, deep paths in a narrow panel, the history and its commits, and a
// comparison with another branch; the place menu's switch for the project's other worktrees, on
// and off; the header that stays put while a long tree scrolls under it; a file edited and saved
// in its own tab; and a change staged, committed and another discarded from the panel.
targets('desktop')
const cli = process.env.ABELE_NODE_CLI
const shots = process.env.ABELE_E2E_SHOTS
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const prelude = `const api=window.__abeleTest,nodes=api.NodeService.getInstance();const wait=ms=>new Promise(r=>setTimeout(r,ms));const until=async f=>{for(let i=0;i<400;i++){if(f())return;await wait(50)}throw Error('Node side panel did not settle: '+f.toString())};const visible=selector=>[...document.querySelectorAll(selector)].find(el=>el.getBoundingClientRect().width>0&&getComputedStyle(el).visibility!=='hidden'&&!el.closest('.workspace-leaf.mod-hidden'));const rowOf=(root,text)=>[...root.querySelectorAll('.tree-item-self')].find(r=>r.querySelector('.abele-tree-item__text')?.textContent===text);const closeMenu=()=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));const drawer=async()=>{if(!app.isMobile)return;await wait(300);app.workspace.leftSplit.expand();await until(()=>visible('.abele-node-place__row'))};const tab=m=>visible('.abele-node-modes [role="tab"][aria-label^="'+m+'"]');const shownMode=m=>tab(m)?.getAttribute('aria-selected')==='true';const pickMode=async m=>{await until(()=>tab(m));if(!shownMode(m))tab(m).click();await until(()=>shownMode(m))};const menuItem=t=>[...document.querySelectorAll('.menu-item')].find(i=>i.textContent.includes(t));const placeMenu=async t=>{closeMenu();await drawer();visible('.abele-node-place > .abele-obsidian-icon').click();await until(()=>menuItem(t));return menuItem(t)};const suggestion=t=>[...document.querySelectorAll('.suggestion-item')].find(i=>i.querySelector('.suggestion-title')?.textContent===t);const closePrompt=async()=>{const input=document.querySelector('.prompt-input');input?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));await wait(150);if(document.querySelector('.prompt'))document.querySelector('.modal-container .modal-bg')?.click();await until(()=>!document.querySelector('.prompt'))};const group=(tree,t)=>[...tree.querySelectorAll('.abele-file-tree__group')].find(g=>g.querySelector(':scope > .tree-item-self .abele-tree-item__text')?.textContent===t);const reopenPanel=async id=>{for(const leaf of app.workspace.getLeavesOfType('abele-node-sidebar'))leaf.detach();const leaf=app.workspace.getLeftLeaf(false);await leaf.setViewState({type:'abele-node-sidebar',active:true,state:{registrationId:id}});await app.workspace.revealLeaf(leaf);if(app.isMobile)app.workspace.leftSplit.expand();await until(()=>visible('.abele-node-panel_ready .abele-node-place__row'))};`
async function capture(name: string) {
  if (!shots) return
  await evalLong(
    `(async()=>{await new Promise(r=>setTimeout(r,300));const path=${JSON.stringify(resolve(shots, 'node-sidebar-' + name + '.png'))};require('fs').mkdirSync(require('path').dirname(path),{recursive:true});const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(path,image.toPNG());return 'captured'})()`
  )
}

const deep = [
  'packages/sample-app/src/components/panels/settings/SampleSettingsPanel.vue',
  'packages/sample-app/src/components/panels/settings/sample-settings-helpers.ts',
  'packages/sample-app/src/stores/sample-preferences-store.ts',
  'packages/sample-server/src/routes/handlers/sample-route-handlers.ts',
  'docs/guide/getting-started-with-the-sample-application.md',
]

it('shows changed files, a missing worktree, the external worktree switch and a pinned header', async () => {
  if (!cli) throw new Error('Set ABELE_NODE_CLI to a built node CLI')
  const dir = mkdtempSync(resolve(realpathSync(tmpdir()), 'node-sidebar-')),
    state = resolve(dir, 'state'),
    home = resolve(dir, 'home'),
    repo = resolve(home, 'sample-repository')
  mkdirSync(repo, { recursive: true })
  const git = (...args: string[]) =>
    promisify(execFile)('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo })
  const commit = (message: string) =>
    git(
      '-c',
      'user.name=Sample',
      '-c',
      'user.email=sample@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      message
    )
  await git('init', '--initial-branch=trunk')
  const write = (path: string, text: string) => {
    mkdirSync(resolve(repo, path, '..'), { recursive: true })
    writeFileSync(resolve(repo, path), text)
  }
  write('README.md', '# Sample repository\n')
  for (const path of deep.filter((p) => !p.endsWith('helpers.ts'))) write(path, 'sample\n')
  for (let i = 0; i < 60; i++) write(`notes/sample-note-${String(i).padStart(2, '0')}.md`, 'Note\n')
  await git('add', '.')
  await commit('Add sample files')
  // Unstaged, staged, new and deleted changes, most of them deep in the tree.
  write(deep[0], 'changed\n')
  write(deep[1], 'new\n')
  write(deep[2], 'staged\n')
  await git('add', deep[1], deep[2])
  rmSync(resolve(repo, deep[3]))
  write(deep[4], 'changed\n')
  write('README.md', '# Changed sample repository\n')
  const external = resolve(home, 'sample-topic'),
    gone = resolve(home, 'sample-gone')
  await git('worktree', 'add', '-b', 'topic', external)
  await git('worktree', 'add', '-b', 'gone-topic', gone)
  // A second repository of its own for the panel's git writes, so the cases above see the same
  // changes in both shells. Its own identity, which the node's commits take.
  const commits = resolve(home, 'sample-commits')
  mkdirSync(commits)
  const gitIn = (...args: string[]) => promisify(execFile)('/usr/bin/git', args, { cwd: commits })
  await gitIn('init', '--initial-branch=main')
  for (const [key, value] of [
    ['user.name', 'Sample Committer'],
    ['user.email', 'committer@example.invalid'],
    ['commit.gpgsign', 'false'],
    ['core.hooksPath', '/dev/null'],
  ])
    await gitIn('config', key, value)
  writeFileSync(resolve(commits, 'alpha.txt'), 'alpha\n')
  writeFileSync(resolve(commits, 'beta.txt'), 'beta\n')
  await gitIn('add', '.')
  await gitIn('commit', '-m', 'Add commit fixture')
  mkdirSync(state, { mode: 0o700 })
  const config = resolve(state, 'paired.json')
  writeFileSync(
    config,
    JSON.stringify({
      endpoint: 'wss://sample.example.ts.net:8443/channel',
      backend_port: 0,
      origins: ['app://obsidian.md'],
      allow_missing_origin: false,
      allow_null_origin: false,
    }),
    { mode: 0o600 }
  )
  const env = {
    ...process.env,
    HOME: home,
    ABELE_CLAUDE_PATH: resolve('tests/fixtures/nodeClaude.mjs'),
    ABELE_CODEX_PATH: '',
  }
  const command = async (...args: string[]) =>
    JSON.parse(
      (
        await promisify(execFile)(
          process.execPath,
          [cli, ...args, '--state-dir', state, '--json'],
          { env }
        )
      ).stdout
    )
  const proxy = createServer(),
    sockets = new Set<Socket>()
  let child: ChildProcess | undefined,
    registration = '',
    mobile = false
  const oldSize = JSON.parse(
    evalRaw(`JSON.stringify(require('@electron/remote').getCurrentWindow().getContentSize())`)
  ) as number[]
  try {
    child = spawn(
      process.execPath,
      [cli, 'start', '--port', '0', '--paired-config', config, '--node-name', 'Sample node'].concat(
        ['--no-codex', '--state-dir', state, '--json']
      ),
      { env, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let output = '',
      errors = ''
    child.stdout!.on('data', (d) => (output += d))
    child.stderr!.on('data', (d) => (errors += d))
    for (let i = 0; i < 400 && !output.includes('"listening"'); i++) {
      if (child.exitCode !== null) throw new Error(errors)
      await wait(20)
    }
    const ready = JSON.parse(output.split('\n').find((line) => line.includes('"listening"'))!)
    // Only Serve's Host forwarding on loopback; the browser's own Origin is kept.
    proxy.on('upgrade', (request, socket: Socket, head) => {
      if (request.url !== '/channel') return socket.destroy()
      const upstream = connect(ready.paired_port, '127.0.0.1')
      for (const peer of [socket, upstream]) {
        sockets.add(peer)
        peer.on('close', () => sockets.delete(peer))
        peer.on('error', () => {
          socket.destroy()
          upstream.destroy()
        })
      }
      upstream.on('connect', () => {
        const headers = request.rawHeaders.slice()
        for (let i = 0; i < headers.length; i += 2)
          if (headers[i].toLowerCase() === 'host') headers[i + 1] = 'sample.example.ts.net:8443'
        upstream.write(
          `GET /channel HTTP/1.1\r\n${headers.reduce((text, value, i) => text + (i % 2 ? value + '\r\n' : value + ': '), '')}\r\n`
        )
        if (head.length) upstream.write(head)
        socket.pipe(upstream)
        upstream.pipe(socket)
      })
    })
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r))
    const port = (proxy.address() as { port: number }).port
    const invite = await command('pair', 'invite', 'sample-device')
    registration = await evalLong(
      `(async()=>{${prelude}if(nodes.nodes.value.length)throw Error('Use a clean node registry fixture');api.pairedLoopbackTransport(nodes,'ws://127.0.0.1:${port}/channel');const node=await nodes.pair('Sample node',${JSON.stringify(invite)});return node.id})()`,
      60000
    )
    const pending = (await command('pair', 'list')).find(
      (d: { state: string }) => d.state === 'pending'
    )
    await command('pair', 'confirm', pending.installation_id, pending.fingerprint)
    const ids = JSON.parse(
      await evalLong(
        `(async()=>{${prelude}await until(()=>nodes.connection(${JSON.stringify(registration)}).state.value==='connected');require('@electron/remote').getCurrentWindow().setContentSize(1200,850);const client=nodes.connection(${JSON.stringify(registration)}).client;const project=await client.nodePath.register({path:${JSON.stringify(repo)},trust:'untrusted',exact_root:true});await client.setRepositorySettings({project_id:project.project_id,external_read:true,default_branch:'trunk'});const rows=await client.repository.worktrees({project_id:project.project_id,include_selection:true});const root=rows.entries.find(w=>w.kind==='root');const commits=await client.nodePath.register({path:${JSON.stringify(commits)},trust:'untrusted',exact_root:true});await client.setRepositorySettings({project_id:commits.project_id,external_read:false,default_branch:'main'});const commitsRoot=(await client.repository.worktrees({project_id:commits.project_id,include_selection:true})).entries.find(w=>w.kind==='root');for(const w of rows.entries.filter(w=>w.kind==='external'))await client.nodePath.worktreeSelection({project_id:project.project_id,worktree_id:w.worktree_id,listed:true});const sidebar=app.workspace.getLeftLeaf(false);await sidebar.setViewState({type:'abele-node-sidebar',active:true,state:{registrationId:${JSON.stringify(registration)}}});await app.workspace.revealLeaf(sidebar);const service=api.NodePathService.getInstance(),model=service.model(${JSON.stringify(registration)});await service.ready(${JSON.stringify(registration)});await model.refresh();await model.select(root.worktree_id);return JSON.stringify({project:project.project_id,root:root.worktree_id,commits:commitsRoot.worktree_id})})()`,
        60000
      )
    )
    // The worktree is taken off the disk behind the node's back; its row says so.
    rmSync(gone, { recursive: true, force: true })
    const reg = JSON.stringify(registration),
      root = JSON.stringify(ids.root)
    const shell = async (prefix: string) => {
      // The place row names the branch and its folder; the header holds the modes, and a place
      // with changes opens on them, unstaged and staged apart, a folder holding one folder joined.
      await evalLong(
        `(async()=>{${prelude}const model=api.NodePathService.getInstance().model(${reg});await model.refresh();model.panelMode.value='files';await model.select(${root});await drawer();await until(()=>shownMode('Changes'));if(!tab('Files')||!tab('History'))throw Error('The header lacks the Files or History mode: '+visible('.abele-node-modes')?.outerHTML);if(!tab('Changes').getAttribute('aria-label').startsWith('Changes: 6 files'))throw Error('The Changes mode does not count the changed files: '+tab('Changes').getAttribute('aria-label'));if(visible('.abele-node-panel .nav-action-button[aria-label="Refresh"]')||visible('.abele-node-panel__node'))throw Error('The old header glyphs or node row stand beside a selected place');if(visible('.abele-node-place__name')?.textContent!=='trunk')throw Error('The place row does not name the branch: '+visible('.abele-node-place')?.textContent);if(visible('.abele-node-place__where')?.textContent!=='sample-repository')throw Error('The folder is not named under the branch: '+visible('.abele-node-place')?.textContent);const tree=visible('.abele-file-tree');await until(()=>tree.textContent.includes('SampleSettingsPanel.vue')&&group(tree,'Changes')&&group(tree,'Staged'));if(tree.querySelector('.abele-file-tree__mode'))throw Error('The tree draws its own mode glyphs under the panel modes');const changes=group(tree,'Changes'),staged=group(tree,'Staged'),at=(g,p)=>g.querySelector('.tree-item-self[data-path="'+p+'"]');if(!at(changes,${JSON.stringify(deep[0])})||at(staged,${JSON.stringify(deep[0])}))throw Error('The unstaged file is not under Changes alone: '+tree.textContent);if(!at(staged,${JSON.stringify(deep[1])})||!at(staged,${JSON.stringify(deep[2])}))throw Error('The staged files are not under Staged: '+staged.textContent);if(group(tree,'Committed'))throw Error('A Committed group on a branch that is not ahead of its base');if(!rowOf(staged,'packages/sample-app/src')||!rowOf(staged,'components/panels/settings'))throw Error('A folder holding one folder was not joined into one row: '+staged.textContent);return 'changed tree'})()`
      )
      await capture(prefix + '-changed-tree')
      // The place search lists every worktree, the one shown marked, the one gone from disk saying
      // so; picking another switches the panel, which opens it on its files when nothing changed.
      await evalLong(
        `(async()=>{${prelude}await drawer();visible('.abele-node-place__row').click();await until(()=>suggestion('sample-repository / topic'));const titles=[...document.querySelectorAll('.suggestion-item .suggestion-title')].map(t=>t.textContent);for(const t of ['sample-repository / trunk','sample-repository / topic','sample-repository / gone-topic'])if(!titles.includes(t))throw Error('The place search does not list '+t+': '+titles.join(' | '));if(!suggestion('sample-repository / trunk').classList.contains('abele-node-suggestion_current'))throw Error('The place shown is not marked in the search');const missing=suggestion('sample-repository / gone-topic'),kind=missing.querySelector('.abele-node-suggestion__kind');if(!kind?.getAttribute('aria-label')?.includes('Not found on the node')&&!kind?.querySelector('svg.lucide-folder-x'))throw Error('The worktree gone from disk does not say it is missing: '+missing.outerHTML);if(missing.textContent.includes('Missing from disk'))throw Error('The words stand beside the name again');return 'place search'})()`
      )
      await capture(prefix + '-place-search')
      await evalLong(
        `(async()=>{${prelude}const model=api.NodePathService.getInstance().model(${reg});suggestion('sample-repository / topic').click();await until(()=>!document.querySelector('.prompt')&&model.currentCopy.value?.branch==='topic'&&visible('.abele-node-place__name')?.textContent==='topic');if(visible('.abele-node-place__where')?.textContent!=='sample-repository')throw Error('The worktree is not named with its folder');await until(()=>shownMode('Files'));return 'switched place'})()`
      )
      await capture(prefix + '-place-topic')
      await evalLong(
        `(async()=>{${prelude}const model=api.NodePathService.getInstance().model(${reg});await drawer();visible('.abele-node-place__row').click();await until(()=>suggestion('sample-repository / trunk'));if(!suggestion('sample-repository / topic').classList.contains('abele-node-suggestion_current'))throw Error('The worktree shown is not marked in the search');suggestion('sample-repository / trunk').click();await until(()=>!document.querySelector('.prompt')&&model.selected.value===${root}&&visible('.abele-node-place__name')?.textContent==='trunk');await until(()=>shownMode('Changes'));return 'back on trunk'})()`
      )
      // Found by name, each file is one row with its folder under it, the whole path in its tooltip.
      await evalLong(
        `(async()=>{${prelude}await drawer();await pickMode('Files');const tree=visible('.abele-file-tree'),parts=${JSON.stringify(deep[0])}.split('/');for(let i=1;i<parts.length;i++){const path=parts.slice(0,i).join('/'),row=()=>tree.querySelector('.tree-item-self[data-path="'+path+'"]');await until(row);if(row().getAttribute('aria-expanded')==='false')row().click()}await until(()=>tree.querySelector('.tree-item-self[data-path="'+${JSON.stringify(deep[0])}+'"]'));const input=tree.querySelector('.abele-file-tree__bar input');input.value='settings';input.dispatchEvent(new Event('input',{bubbles:true}));await until(()=>tree.querySelector('.abele-tree-item__where'));for(const row of tree.querySelectorAll('.abele-tree-item__named')){const name=row.querySelector('.abele-tree-item__text'),where=row.querySelector('.abele-tree-item__where');for(const line of [name,where]){const height=line.getBoundingClientRect().height,lineHeight=parseFloat(getComputedStyle(line).lineHeight)||16;if(height>lineHeight*1.5)throw Error('A name or path broke onto several lines: '+line.textContent)}}const path=[...tree.querySelectorAll('.tree-item-self')].find(r=>r.textContent.includes('SampleSettingsPanel.vue'));if(path.getAttribute('aria-label')!=='packages/sample-app/src/components/panels/settings/SampleSettingsPanel.vue')throw Error('The whole path is not in the row tooltip: '+path.getAttribute('aria-label'));return 'changed list'})()`
      )
      await capture(prefix + '-changed-list')
      await evalLong(
        `(async()=>{${prelude}const input=visible('.abele-file-tree__bar input');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));await until(()=>!visible('.abele-file-tree .abele-tree-item__where'));return 'search cleared'})()`
      )
      // A node that reports the setting gets one switch; one that cannot say, both ways. The
      // place's menu holds it, and not the row items the panel already has.
      const menu = async (expectChecked: boolean, title: string) =>
        evalLong(
          `(async()=>{${prelude}const item=await placeMenu(${JSON.stringify(title)});const checked=item.classList.contains('mod-checked')||!!item.querySelector('.menu-item-icon.mod-checked,.mod-checked');if(checked!==${expectChecked})throw Error('The switch reads '+(checked?'checked':'unchecked')+': '+item.outerHTML);const titles=[...document.querySelectorAll('.menu-item-title')].map(t=>t.textContent);for(const gone of ['New chat','History','Refresh folder'])if(titles.includes(gone))throw Error('The place menu still has '+gone+': '+titles.join(' | '));return 'menu'})()`
        )
      // A node too old to report the setting leaves the switch unchecked, and it still works.
      const reports =
        (await evalLong(
          `(async()=>{${prelude}try{await nodes.connection(${reg}).client.request('project.repository_settings.get',{project_id:${JSON.stringify(ids.project)}});return 'reports'}catch{return 'silent'}})()`
        )) === 'reports'
      const switchTitle = reports
        ? 'Browse external workspaces'
        : 'Allow external workspace browsing'
      await menu(reports, switchTitle)
      await capture(prefix + '-external-on')
      await evalLong(
        `(async()=>{${prelude}closeMenu();await nodes.connection(${reg}).client.setRepositorySettings({project_id:${JSON.stringify(ids.project)},external_read:false});return 'off'})()`
      )
      await menu(false, switchTitle)
      await capture(prefix + '-external-off')
      await evalLong(
        `(async()=>{${prelude}closeMenu();await nodes.connection(${reg}).client.setRepositorySettings({project_id:${JSON.stringify(ids.project)},external_read:true});return 'on again'})()`
      )
      await evalLong(
        `(async()=>{${prelude}closeMenu();await drawer();await pickMode('Files');const tree=visible('.abele-file-tree');await until(()=>rowOf(tree,'notes'));const folder=rowOf(tree,'notes');if(folder.getAttribute('aria-expanded')==='false')folder.click();await until(()=>rowOf(tree,'sample-note-59.md'));const body=tree.querySelector('.abele-file-tree__body'),bar=tree.querySelector('.abele-file-tree__bar'),header=visible('.abele-node-panel'),top=bar.getBoundingClientRect().top;if(document.body.classList.contains('is-phone')){const pane=header.querySelector('.abele-node-panel__content');if(!pane||pane.scrollHeight<=pane.clientHeight||!/auto|scroll/.test(getComputedStyle(pane).overflowY))throw Error('The phone content above the footer does not scroll');pane.scrollTop=pane.scrollHeight;await wait(200);if(pane.scrollTop===0)throw Error('The phone panel did not scroll');const stuck=bar.getBoundingClientRect().top-pane.getBoundingClientRect().top-parseFloat(getComputedStyle(pane).paddingTop);if(Math.abs(stuck)>2)throw Error('The search did not stay at the top: '+stuck);if(header.querySelector('.abele-node-place').getBoundingClientRect().bottom>bar.getBoundingClientRect().top+1)throw Error('The place did not go up out of the way');const footer=header.querySelector('.abele-node-panel__connection-footer');if(pane.getBoundingClientRect().bottom>footer.getBoundingClientRect().top+1)throw Error('Phone files overlap the connection footer');pane.scrollTop=0;return 'pinned'}body.scrollTop=body.scrollHeight;await wait(200);if(body.scrollTop===0)throw Error('The files do not scroll on their own');if(Math.abs(bar.getBoundingClientRect().top-top)>1)throw Error('The search moved with the files');if(header.scrollTop!==0)throw Error('The whole panel scrolled');const below=[...header.parentElement.querySelectorAll('.nav-header')].map(n=>n.getBoundingClientRect()).find(r=>r.height>0&&r.top>=body.getBoundingClientRect().top),edge=below?below.top:header.parentElement.getBoundingClientRect().bottom-parseFloat(getComputedStyle(header.parentElement).paddingBottom);if(edge-body.getBoundingClientRect().bottom>24){const box=el=>el&&{cls:el.className,rect:el.getBoundingClientRect().toJSON(),pad:getComputedStyle(el).padding,flex:getComputedStyle(el).flex,height:getComputedStyle(el).height};throw Error('The files stop short of the panel bottom: '+JSON.stringify({edge,body:box(body),tree:box(tree),panel:box(header),parent:box(header.parentElement),kids:[...header.children].map(box),nav:[...header.parentElement.querySelectorAll('.nav-header')].map(box)}))}body.scrollTop=0;return 'pinned'})()`
      )
      await capture(prefix + '-pinned-header')
      // History lists the commits in the panel, with no branch line over them; the mode outlives
      // the panel view and is kept in the node's snapshot.
      await evalLong(
        `(async()=>{${prelude}closeMenu();await drawer();await pickMode('History');await until(()=>visible('.abele-node-sidebar__history .abele-history__row'));if(visible('.abele-node-sidebar__history .abele-history__branch'))throw Error('A branch line stands over the panel history');if(visible('.abele-node-sidebar .abele-file-tree'))throw Error('The files stay under the history');if(!visible('.abele-node-sidebar__history').textContent.includes('Add sample files'))throw Error('The commit is not listed: '+visible('.abele-node-sidebar__history').textContent);return 'history mode'})()`
      )
      await capture(prefix + '-history')
      await evalLong(
        `(async()=>{${prelude}await reopenPanel(${reg});await until(()=>shownMode('History')&&visible('.abele-node-sidebar__history .abele-history__row'));const model=api.NodePathService.getInstance().model(${reg});await model.refresh();await until(()=>app.loadLocalStorage('abele-node-path-cache:'+${reg})?.panelMode==='history');return 'mode kept'})()`
      )
      // A commit clicked in the panel opens the history tab at that commit.
      await evalLong(
        `(async()=>{${prelude}await drawer();const row=visible('.abele-node-sidebar__history .abele-history__row'),hash=row.querySelector('.abele-history__hash').dataset.tip;row.click();await until(()=>app.workspace.getLeavesOfType('abele-node-history').some(l=>l.view.getState().commit===hash));const leaf=app.workspace.getLeavesOfType('abele-node-history').find(l=>l.view.getState().commit===hash),state=leaf.view.getState();if(state.kind!=='history'||state.target.id!==${root})throw Error('The history tab is not of the place shown: '+JSON.stringify(state));await until(()=>leaf.view.contentEl.querySelector('.abele-history__commit-head .abele-history__subject')?.textContent==='Add sample files');return 'commit opened'})()`
      )
      await capture(prefix + '-history-commit')
      await evalLong(
        `(async()=>{${prelude}for(const leaf of app.workspace.getLeavesOfType('abele-node-history'))leaf.detach();await drawer();await pickMode('Changes');return 'history closed'})()`
      )
      // Compare with… counts the changes against the branch chosen, said in the header with a
      // cross that goes back to what git has saved.
      await evalLong(
        `(async()=>{${prelude}const model=api.NodePathService.getInstance().model(${reg});(await placeMenu('Compare with…')).click();await until(()=>suggestion('topic'));suggestion('topic').click();await until(()=>visible('.abele-node-modes__against-name')?.textContent.trim()==='vs topic');if(!shownMode('Changes'))throw Error('Comparing did not show the changes');if(model.panelBase.value!=='refs/heads/topic')throw Error('The base chosen is '+model.panelBase.value);await until(()=>visible('.abele-branch-codes__base')?.textContent.includes('topic'));return 'compared'})()`
      )
      await capture(prefix + '-compare')
      await evalLong(
        `(async()=>{${prelude}const model=api.NodePathService.getInstance().model(${reg});const cross=visible('.abele-node-modes__against button');if(!cross)throw Error('No cross beside the branch compared with');cross.click();await until(()=>!visible('.abele-node-modes__against')&&model.panelBase.value==='');return 'compare stopped'})()`
      )
      // A file is edited in its own tab: the pencil, the edit, Save writes it on the node, and
      // leaving the editor shows the file as saved.
      const text = `# Edited on ${prefix}\n`
      const fileLeaf = `app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.getState().path==='README.md')`
      const tabAction = `async t=>{const leaf=${fileLeaf};if(app.isMobile){leaf.view.containerEl.querySelector('.view-action[aria-label="More options"]').click();const item=()=>[...document.querySelectorAll('.menu-item')].find(i=>i.querySelector('.menu-item-title')?.textContent===t.split(' · ')[0].replace(/^Save to the node$/,'Save'));await until(()=>item()&&!item().classList.contains('is-disabled'));item().click()}else{const action=()=>leaf.view.containerEl.querySelector('.view-action[aria-label="'+t+'"]');await until(action);action().click()}}`
      await evalLong(
        `(async()=>{${prelude}const act=${tabAction};await drawer();await pickMode('Files');const tree=visible('.abele-file-tree');await until(()=>rowOf(tree,'README.md'));rowOf(tree,'README.md').click();await until(()=>${fileLeaf}?.view.file?.document.value);const leaf=${fileLeaf};await app.workspace.revealLeaf(leaf);if(leaf.view.containerEl.querySelector('.view-action[aria-label="Open in code editor"]'))throw Error('The code editor action is back');await act('Edit the file');await until(()=>leaf.view.contentEl.querySelector('.cm-content')?.contentEditable==='true');if(leaf.view.getState().edit!==true)throw Error('The tab state does not say it is editing');if(app.workspace.getLeavesOfType('abele-node-editor').length)throw Error('A separate editor tab opened');return 'editing'})()`
      )
      await evalLong(
        `(async()=>{${prelude}const act=${tabAction};const leaf=${fileLeaf},editor=api.codeView(leaf.view.contentEl.querySelector('.cm-content'));editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:${JSON.stringify(text)}}});await until(()=>leaf.view.containerEl.querySelector('.view-action[aria-label="Save to the node · ⌘ S"]'));await act('Save to the node · ⌘ S');await until(()=>leaf.view.contentEl.querySelector('.abele-node-save')?.textContent.includes('Saved ·'));return 'saved'})()`
      )
      expect(readFileSync(resolve(repo, 'README.md'), 'utf8')).toBe(text)
      await capture(prefix + '-edit-saved')
      await evalLong(
        `(async()=>{${prelude}const act=${tabAction};const leaf=${fileLeaf};await act('Stop editing');await until(()=>!leaf.view.contentEl.querySelector('.abele-node-save')&&leaf.view.getState().edit!==true);await until(()=>leaf.view.file?.document.value?.text===${JSON.stringify(text)});await until(()=>leaf.view.contentEl.textContent.includes(${JSON.stringify(text.trim())}));return 'stopped editing'})()`
      )
      await capture(prefix + '-edit-stopped')
      // A tab saved by an earlier version as the code editor comes back as the file, editing.
      await evalLong(
        `(async()=>{${prelude}const target=${fileLeaf}.view.getState().target,leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-node-editor',active:true,state:{kind:'editor',target,path:'README.md'}});await until(()=>leaf.view?.getViewType()==='abele-node-file'&&leaf.view.getState().edit===true&&leaf.view.getState().path==='README.md');await until(()=>leaf.view.contentEl.querySelector('.cm-content')?.contentEditable==='true');if(app.workspace.getLeavesOfType('abele-node-editor').length)throw Error('The editor tab stayed an editor tab');const shown=api.codeView(leaf.view.contentEl.querySelector('.cm-content')).state.doc.toString();if(shown!==${JSON.stringify(text)})throw Error('The editor does not open on the saved text: '+shown);for(const l of app.workspace.getLeavesOfType('abele-node-file'))l.detach();return 'editor tab restored'})()`
      )
      // With a node that writes git: one changed file staged from its row, committed from the
      // commit field, listed newest in History with the repository's author; another discarded
      // through its glyph and the question, back to what was committed.
      writeFileSync(resolve(commits, 'alpha.txt'), `alpha ${prefix}\n`)
      writeFileSync(resolve(commits, 'beta.txt'), `beta ${prefix}\n`)
      const message = `Commit alpha from ${prefix}`
      await evalLong(
        `(async()=>{${prelude}const model=api.NodePathService.getInstance().model(${reg});await model.refresh();await model.select(${JSON.stringify(ids.commits)});await drawer();await until(()=>visible('.abele-node-place__name')?.textContent==='main');await until(()=>shownMode('Changes')&&tab('Changes').getAttribute('aria-label').startsWith('Changes: 2 files'));const tree=()=>visible('.abele-file-tree'),at=(g,p)=>g?.querySelector('.tree-item-self[data-path="'+p+'"]');await until(()=>at(group(tree(),'Changes'),'alpha.txt')&&at(group(tree(),'Changes'),'beta.txt'));if(group(tree(),'Staged')||visible('.abele-commit-box'))throw Error('A commit field or Staged group with nothing staged');const stage=at(group(tree(),'Changes'),'alpha.txt').querySelector('[aria-label="Stage"]');if(!stage)throw Error('No Stage glyph on the changed row: '+at(group(tree(),'Changes'),'alpha.txt').outerHTML);stage.click();await until(()=>at(group(tree(),'Staged'),'alpha.txt')&&!at(group(tree(),'Changes'),'alpha.txt')&&at(group(tree(),'Changes'),'beta.txt'));await until(()=>visible('.abele-commit-box textarea'));return 'staged'})()`
      )
      await capture(prefix + '-git-staged')
      await evalLong(
        `(async()=>{${prelude}const box=visible('.abele-commit-box'),field=box.querySelector('textarea'),commit=()=>[...box.querySelectorAll('button')].find(b=>b.textContent.trim()==='Commit');field.value=${JSON.stringify(message)};field.dispatchEvent(new Event('input',{bubbles:true}));await until(()=>commit()&&!commit().disabled);commit().click();const tree=()=>visible('.abele-file-tree');await until(()=>!group(tree(),'Staged')&&!visible('.abele-commit-box')&&tab('Changes').getAttribute('aria-label').startsWith('Changes: 1 file'));await pickMode('History');await until(()=>visible('.abele-node-sidebar__history .abele-history__row .abele-history__row-subject')?.textContent===${JSON.stringify(message)});const row=visible('.abele-node-sidebar__history .abele-history__row');if(!row.querySelector('.abele-history__row-meta')?.textContent.includes('Sample Committer'))throw Error('The commit is not by the repository author: '+row.textContent);return 'committed'})()`
      )
      const head = await gitIn('log', '-1', '--format=%s|%an')
      expect(head.stdout.trim()).toBe(`${message}|Sample Committer`)
      expect((await gitIn('status', '--porcelain')).stdout).toBe(' M beta.txt\n')
      await capture(prefix + '-git-committed')
      await evalLong(
        `(async()=>{${prelude}await pickMode('Changes');const tree=()=>visible('.abele-file-tree'),at=(g,p)=>g?.querySelector('.tree-item-self[data-path="'+p+'"]');await until(()=>at(group(tree(),'Changes'),'beta.txt'));at(group(tree(),'Changes'),'beta.txt').querySelector('[aria-label="Discard the changes to this file…"]').click();const yes=()=>[...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='Discard');await until(yes);if(!visible('.modal')?.textContent.includes('Discard the changes?'))throw Error('Discarding did not ask first');yes().click();await until(()=>!visible('.modal')&&tab('Changes').getAttribute('aria-label')==='Changes: none');return 'discarded'})()`
      )
      expect(readFileSync(resolve(commits, 'beta.txt'), 'utf8')).toBe(
        (await gitIn('show', 'HEAD:beta.txt')).stdout
      )
      expect((await gitIn('status', '--porcelain')).stdout).toBe('')
    }
    await shell('desktop')
    // Into the real phone shell, with this fixture's paired transport put back.
    await reloadApp('app.emulateMobile(true)')
    mobile = true
    await evalLong(
      `(async()=>{${prelude}require('@electron/remote').getCurrentWindow().setContentSize(390,844);api.pairedLoopbackTransport(nodes,'ws://127.0.0.1:${port}/channel');const connection=nodes.connection(${JSON.stringify(registration)});await connection.refreshAuthorization();connection.start();await connection.connect();const service=api.NodePathService.getInstance();await service.ready(${JSON.stringify(registration)});const sidebar=app.workspace.getLeavesOfType('abele-node-sidebar')[0]??app.workspace.getLeftLeaf(false);await sidebar.setViewState({type:'abele-node-sidebar',active:true,state:{registrationId:${JSON.stringify(registration)}}});await app.workspace.revealLeaf(sidebar);app.workspace.leftSplit.expand();await until(()=>visible('.abele-node-panel_ready'));return 'phone drawer'})()`,
      60000
    )
    await shell('phone')
  } finally {
    try {
      await evalLong(
        `(async()=>{${prelude}closeMenu();for(const type of ['abele-node-sidebar','abele-node-file','abele-node-history','abele-node-editor'])for(const leaf of app.workspace.getLeavesOfType(type))leaf.detach();if(${JSON.stringify(registration)})nodes.remove(${JSON.stringify(registration)});app.workspace.requestSaveLayout();await wait(1000);return 'cleaned'})()`
      )
    } catch {
      /* The daemon and proxy must still stop after a failed shell probe. */
    }
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((r) => proxy.close(() => r()))
    if (child && child.exitCode === null) {
      child.kill('SIGTERM')
      await new Promise<void>((r) => child!.once('exit', () => r()))
    }
    if (mobile) await reloadApp('app.emulateMobile(false)')
    evalRaw(
      `require('@electron/remote').getCurrentWindow().setContentSize(${oldSize[0]},${oldSize[1]});'restored'`
    )
    rmSync(dir, { recursive: true, force: true })
  }
}, 240000)
