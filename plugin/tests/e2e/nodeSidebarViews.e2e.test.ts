import { expect, it } from 'vitest'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import { connect, type Socket } from 'node:net'
import { evalLong, evalRaw, reloadApp } from './helpers/obsidianCli'
import { targets } from './helpers/target'

// The node side panel's own views, in the desktop and phone shells: a repository's changed files
// in their folders and as a list, with deep paths in a narrow panel; a worktree gone from disk;
// the folder menu's switch for the project's other worktrees, on and off; and the header that
// stays put while a long tree scrolls under it.
targets('desktop')
const cli = process.env.ABELE_NODE_CLI
const shots = process.env.ABELE_E2E_SHOTS
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const prelude = `const api=window.__abeleTest,nodes=api.NodeService.getInstance();const wait=ms=>new Promise(r=>setTimeout(r,ms));const until=async f=>{for(let i=0;i<400;i++){if(f())return;await wait(50)}throw Error('Node side panel did not settle: '+f.toString())};const visible=selector=>[...document.querySelectorAll(selector)].find(el=>el.getBoundingClientRect().width>0&&getComputedStyle(el).visibility!=='hidden'&&!el.closest('.workspace-leaf.mod-hidden'));const rowOf=(root,text)=>[...root.querySelectorAll('.tree-item-self')].find(r=>r.querySelector('.abele-tree-item__text')?.textContent===text);const closeMenu=()=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));`
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
        `(async()=>{${prelude}await until(()=>nodes.connection(${JSON.stringify(registration)}).state.value==='connected');require('@electron/remote').getCurrentWindow().setContentSize(1200,850);const client=nodes.connection(${JSON.stringify(registration)}).client;const project=await client.nodePath.register({path:${JSON.stringify(repo)},trust:'untrusted',exact_root:true});await client.setRepositorySettings({project_id:project.project_id,external_read:true,default_branch:'trunk'});const rows=await client.repository.worktrees({project_id:project.project_id,include_selection:true});const root=rows.entries.find(w=>w.kind==='root');for(const w of rows.entries.filter(w=>w.kind==='external'))await client.nodePath.worktreeSelection({project_id:project.project_id,worktree_id:w.worktree_id,listed:true});const sidebar=app.workspace.getLeftLeaf(false);await sidebar.setViewState({type:'abele-node-sidebar',active:true,state:{registrationId:${JSON.stringify(registration)}}});await app.workspace.revealLeaf(sidebar);const service=api.NodePathService.getInstance(),model=service.model(${JSON.stringify(registration)});await service.ready(${JSON.stringify(registration)});await model.refresh();await model.select(root.worktree_id);return JSON.stringify({project:project.project_id,root:root.worktree_id})})()`,
        60000
      )
    )
    // The worktree is taken off the disk behind the node's back; its row says so.
    rmSync(gone, { recursive: true, force: true })
    const shell = async (prefix: string) => {
      await evalLong(
        `(async()=>{${prelude}const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await model.refresh();await model.select(${JSON.stringify(ids.root)});await until(()=>visible('.abele-file-tree [aria-label^="Changed files in their folders"].is-active'));const tree=visible('.abele-file-tree');await until(()=>tree.textContent.includes('SampleSettingsPanel.vue'));if(!rowOf(tree,'sample-app/src')||!rowOf(tree,'components/panels/settings'))throw Error('A folder holding one folder was not joined into one row: '+tree.textContent);const missing=[...visible('.abele-folder-tree').querySelectorAll('.tree-item-self')].find(r=>r.textContent.includes('gone-topic'));if(!missing)throw Error('The worktree gone from disk is not listed');if(!missing.getAttribute('aria-label')?.includes('missing from disk'))throw Error('Its row does not say it is missing: '+missing.outerHTML);if(missing.textContent.includes('Missing from disk'))throw Error('The words stand beside the name again');return 'changed tree'})()`
      )
      await capture(prefix + '-changed-tree')
      await evalLong(
        `(async()=>{${prelude}visible('.abele-file-tree [aria-label^="Only changed files"]').click();const tree=visible('.abele-file-tree');await until(()=>tree.querySelector('.abele-tree-item__where'));for(const row of tree.querySelectorAll('.abele-tree-item__named')){const name=row.querySelector('.abele-tree-item__text'),where=row.querySelector('.abele-tree-item__where');for(const line of [name,where]){const height=line.getBoundingClientRect().height,lineHeight=parseFloat(getComputedStyle(line).lineHeight)||16;if(height>lineHeight*1.5)throw Error('A name or path broke onto several lines: '+line.textContent)}}const path=[...tree.querySelectorAll('.tree-item-self')].find(r=>r.textContent.includes('SampleSettingsPanel.vue'));if(path.getAttribute('aria-label')!=='packages/sample-app/src/components/panels/settings/SampleSettingsPanel.vue')throw Error('The whole path is not in the row tooltip: '+path.getAttribute('aria-label'));return 'changed list'})()`
      )
      await capture(prefix + '-changed-list')
      const menu = async (expectChecked: boolean) =>
        evalLong(
          `(async()=>{${prelude}closeMenu();const row=[...visible('.abele-folder-tree').querySelectorAll('.abele-folder-tree__copy > .tree-item-self')].find(r=>r.textContent.includes('trunk'));row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:row.getBoundingClientRect().left+40,clientY:row.getBoundingClientRect().bottom}));await until(()=>[...document.querySelectorAll('.menu-item')].some(i=>i.textContent.includes('Allow external workspace browsing')));const item=[...document.querySelectorAll('.menu-item')].find(i=>i.textContent.includes('Allow external workspace browsing'));const checked=item.classList.contains('mod-checked')||!!item.querySelector('.menu-item-icon.mod-checked,.mod-checked');if(checked!==${expectChecked})throw Error('The switch reads '+(checked?'checked':'unchecked')+': '+item.outerHTML);return 'menu'})()`
        )
      // A node too old to report the setting leaves the switch unchecked, and it still works.
      const reports =
        (await evalLong(
          `(async()=>{${prelude}try{await nodes.connection(${JSON.stringify(registration)}).client.request('project.repository_settings.get',{project_id:${JSON.stringify(ids.project)}});return 'reports'}catch{return 'silent'}})()`
        )) === 'reports'
      await menu(reports)
      await capture(prefix + '-external-on')
      await evalLong(
        `(async()=>{${prelude}closeMenu();await nodes.connection(${JSON.stringify(registration)}).client.setRepositorySettings({project_id:${JSON.stringify(ids.project)},external_read:false});return 'off'})()`
      )
      await menu(false)
      await capture(prefix + '-external-off')
      await evalLong(
        `(async()=>{${prelude}closeMenu();await nodes.connection(${JSON.stringify(registration)}).client.setRepositorySettings({project_id:${JSON.stringify(ids.project)},external_read:true});return 'on again'})()`
      )
      await evalLong(
        `(async()=>{${prelude}visible('.abele-file-tree [aria-label="All files"]').click();const tree=visible('.abele-file-tree');await until(()=>rowOf(tree,'notes'));const folder=rowOf(tree,'notes');if(folder.getAttribute('aria-expanded')==='false')folder.click();await until(()=>rowOf(tree,'sample-note-59.md'));const body=tree.querySelector('.abele-file-tree__body'),bar=tree.querySelector('.abele-file-tree__bar'),header=visible('.abele-node-panel'),top=bar.getBoundingClientRect().top;body.scrollTop=body.scrollHeight;await wait(200);if(body.scrollTop===0)throw Error('The files do not scroll on their own');if(Math.abs(bar.getBoundingClientRect().top-top)>1)throw Error('The search moved with the files');if(header.scrollTop!==0)throw Error('The whole panel scrolled');return 'pinned'})()`
      )
      await capture(prefix + '-pinned-header')
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
        `(async()=>{${prelude}closeMenu();for(const type of ['abele-node-sidebar','abele-node-file'])for(const leaf of app.workspace.getLeavesOfType(type))leaf.detach();if(${JSON.stringify(registration)})nodes.remove(${JSON.stringify(registration)});app.workspace.requestSaveLayout();await wait(1000);return 'cleaned'})()`
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
