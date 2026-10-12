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

targets('desktop')
const cli = process.env.ABELE_NODE_CLI
const shots = process.env.ABELE_NODE_PATH_SCREENSHOTS ?? process.env.ABELE_E2E_SHOTS
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const prelude = `const api=window.__abeleTest,nodes=api.NodeService.getInstance();const wait=ms=>new Promise(r=>setTimeout(r,ms));const until=async f=>{for(let i=0;i<400;i++){if(f())return;await wait(50)}throw Error('Node path did not settle: '+f.toString())};const visible=selector=>[...document.querySelectorAll(selector)].find(el=>el.getBoundingClientRect().width>0&&getComputedStyle(el).visibility!=='hidden'&&!el.closest('.workspace-leaf.mod-hidden')); const button=(root,text)=>[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===text);`
async function capture(name: string) {
  if (!shots) return
  await evalLong(
    `(async()=>{await new Promise(r=>setTimeout(r,250));const path=${JSON.stringify(resolve(shots, name + '.png'))};require('fs').mkdirSync(require('path').dirname(path),{recursive:true});const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(path,image.toPNG());return 'captured'})()`
  )
}

async function reopenNodePane(name: string) {
  try {
    await evalLong(
      `(async()=>{${prelude}for(const leaf of app.workspace.getLeavesOfType('abele-node-sidebar'))leaf.detach();app.commands.executeCommandById('abele:open-node');await until(()=>app.workspace.getLeavesOfType('abele-node-sidebar').length===1);await until(()=>visible('.abele-node-panel_ready .abele-status-dot_green'));const view=app.workspace.getLeavesOfType('abele-node-sidebar')[0].view;if(!nodes.nodes.value.some(n=>n.id===view.getState().registrationId))throw Error('Reopened pane lost its registered node');if(visible('.abele-node-panel_found,.abele-node-panel_remote'))throw Error('Reopened pane asks to connect again');return 'registered pane reopened'})()`
    )
  } catch (error) {
    await capture(name + '-error')
    const diagnostic = await evalLong(
      `(()=>{${prelude}return JSON.stringify({mobile:app.isMobile,drawer:{collapsed:app.workspace.leftSplit.collapsed,width:app.workspace.leftSplit.containerEl?.offsetWidth},nodes:nodes.nodes.value.map(n=>({id:n.id,state:nodes.connection(n.id).state.value})),views:app.workspace.getLeavesOfType('abele-node-sidebar').map(l=>({state:l.view.getState(),phase:l.view.localPhase?.value,hidden:l.containerEl.classList.contains('mod-hidden')})),panels:[...document.querySelectorAll('.abele-node-panel')].map(el=>({class:el.className,rect:el.getBoundingClientRect().toJSON(),visibility:getComputedStyle(el).visibility,text:el.textContent.slice(0,300)}))})})()`
    )
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${diagnostic}`)
  }
  await capture(name)
}
async function checkFileLookup(prefix: string) {
  await evalLong(
    `(async()=>{${prelude}visible('.abele-file-tree [aria-label="All files"]').click();await until(()=>visible('.abele-file-tree')?.textContent.includes('Ignored files are not shown.'));if(visible('.abele-file-tree').textContent.includes('hidden.txt'))throw Error('Ignored content was included');return 'all files'})()`
  )
  await capture(prefix + '-all-files')
  // The fixture's nested entries are now loaded by expansion, not by an eager repository walk.
  await evalLong(
    `(async()=>{${prelude}for(const [folder,file] of [['lookup','lookup-72.txt'],['src','sample.ts']]){const tree=visible('.abele-file-tree');const row=[...tree.querySelectorAll('.tree-item-self')].find(el=>el.querySelector('.abele-tree-item__text')?.textContent===folder);if(!row)throw Error('Fixture folder missing: '+folder);if(row.getAttribute('aria-expanded')==='false')row.click();await until(()=>[...tree.querySelectorAll('.abele-tree-item__text')].some(el=>el.textContent===file))}return 'fixture directories loaded lazily'})()`
  )
  await evalLong(
    `(async()=>{${prelude}const input=visible('.abele-file-tree input');input.value='lookup';input.dispatchEvent(new Event('input',{bubbles:true}));await until(()=>visible('.abele-file-tree')?.textContent.includes('50 of 73 · type more to narrow'));if(visible('.abele-file-tree').querySelectorAll('.tree-item-self').length!==50)throw Error('Lookup cap changed');visible('.abele-file-tree__note').scrollIntoView({block:'center'});return 'bounded lookup'})()`
  )
  await capture(prefix + '-lookup-limit')
  await evalLong(
    `(async()=>{${prelude}const tree=visible('.abele-file-tree'),input=tree.querySelector('input');input.value='src/sample.ts';input.dispatchEvent(new Event('input',{bubbles:true}));input.scrollIntoView({block:'center'});await until(()=>tree.querySelectorAll('.tree-item-self').length===1&&tree.textContent.includes('sample.ts'));return 'path lookup'})()`
  )
  await capture(prefix + '-lookup-path')
  await evalLong(
    `(async()=>{${prelude}const input=visible('.abele-file-tree input');input.value='no-such-fixture';input.dispatchEvent(new Event('input',{bubbles:true}));await until(()=>visible('.abele-file-tree')?.textContent.includes('No file matches.'));return 'missing lookup'})()`
  )
  await capture(prefix + '-lookup-missing')
  await evalLong(
    `(async()=>{${prelude}const input=visible('.abele-file-tree input');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));visible('.abele-file-tree [aria-label^="Only changed files"]').click();return 'changes restored'})()`
  )
}
async function checkMixedCommit() {
  await evalLong(
    `(async()=>{${prelude}await until(()=>visible('.abele-history__commit-head'));const history=visible('.abele-history');if(!history.textContent.includes('sample.bin')||!history.textContent.includes('Binary file · no text diff.'))throw Error('Binary metadata missing');if(!history.textContent.includes('Updated sample repository')||!history.querySelector('.abele-diff'))throw Error('Text diff in mixed commit is unavailable');if(visible('.abele-node-main [role="alert"]'))throw Error('Mixed commit failed');return 'mixed commit readable'})()`
  )
}
async function selectText(selector: string) {
  await evalLong(
    `(async()=>{${prelude}await until(()=>visible(${JSON.stringify(selector)}));const text=visible(${JSON.stringify(selector)});if(getComputedStyle(text).userSelect!=='text')throw Error('File text is not selectable');const range=document.createRange();range.selectNodeContents(text);window.getSelection().removeAllRanges();window.getSelection().addRange(range);document.dispatchEvent(new Event('selectionchange'));await until(()=>visible('.abele-file-view__selection'));const bar=visible('.abele-file-view__selection').getBoundingClientRect();if(bar.left<0||bar.right>innerWidth||bar.top<0||bar.bottom>innerHeight)throw Error('Selection actions are clipped');const header=text.closest('.abele-file-view').querySelector('.abele-file-view__header,.abele-diff__header');if(header&&bar.top<header.getBoundingClientRect().bottom)throw Error('Selection actions cover the file header');if(document.body.classList.contains('is-phone')&&bar.top<range.getBoundingClientRect().bottom)throw Error('Phone actions overlap the native selection menu');return 'selected'})()`
  )
}
async function checkPanelColumns() {
  await evalLong(
    `(()=>{${prelude}const panel=visible('.abele-folder-tree');for(const selector of ['.abele-copy-codes__dot','.abele-copy-codes__count','.abele-tree-item__actions']){const columns=[...panel.querySelectorAll(selector)].map(el=>el.getBoundingClientRect().left);if(Math.max(...columns)-Math.min(...columns)>1)throw Error('Nested row codes are not aligned: '+selector+' '+columns.join(','))}return 'aligned'})()`
  )
}
async function clearSelection() {
  await evalLong(
    `(()=>{window.getSelection().removeAllRanges();document.dispatchEvent(new Event('selectionchange'));return 'cleared'})()`
  )
}
async function checkCodeGeometry() {
  await evalLong(
    `(async()=>{${prelude}await until(()=>visible('.abele-node-main .cm-line'));await wait(200);const line=visible('.abele-node-main .cm-line'),content=visible('.abele-node-main .cm-content');if(content.getBoundingClientRect().width<150)throw Error('Code content collapsed');if(line.getBoundingClientRect().height>parseFloat(getComputedStyle(line).lineHeight)*2)throw Error('A short code line wraps one character at a time');if(!line.querySelector('span[class]'))throw Error('Syntax colours missing');if(!visible('.abele-node-main .cm-lineNumbers'))throw Error('Line numbers missing');return 'code geometry'})()`
  )
}

it('pairs and opens target-bound node files history editor and fake chats in the desktop and phone shells', async () => {
  if (!cli) throw new Error('Set ABELE_NODE_CLI to a built node CLI')
  const fixtureRoot = resolve(process.env.ABELE_NODE_PATH_FIXTURE_DIR || realpathSync(tmpdir()))
  mkdirSync(fixtureRoot, { recursive: true, mode: 0o700 })
  const dir = mkdtempSync(resolve(fixtureRoot, 'node-path-')),
    state = resolve(dir, 'state'),
    home = resolve(dir, 'home'),
    repo = resolve(home, 'sample-repository'),
    plain = resolve(home, 'plain-folder')
  mkdirSync(repo, { recursive: true })
  mkdirSync(plain)
  writeFileSync(resolve(plain, 'sample.txt'), 'Plain folder content\n')
  const git = (...args: string[]) =>
    promisify(execFile)('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo })
  await git('init', '--initial-branch=trunk')
  mkdirSync(resolve(repo, 'src'))
  writeFileSync(resolve(repo, 'src/sample.ts'), 'export const value = 1\n')
  writeFileSync(resolve(repo, 'sample.md'), '# Sample repository\n')
  writeFileSync(resolve(repo, 'sample.bin'), Buffer.from([0, 1, 2, 3]))
  writeFileSync(
    resolve(repo, 'sample-image.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
  )
  mkdirSync(resolve(repo, 'lookup'))
  for (let i = 0; i < 73; i++)
    writeFileSync(resolve(repo, `lookup/lookup-${i}.txt`), 'Lookup fixture\n')
  writeFileSync(resolve(repo, '.gitignore'), 'ignored/\n')
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
    'Add sample files'
  )
  writeFileSync(resolve(repo, 'sample.md'), '# Updated sample repository\n')
  writeFileSync(resolve(repo, 'sample.bin'), Buffer.from([0, 4, 5, 6]))
  await git('add', 'sample.md', 'sample.bin')
  await git(
    '-c',
    'user.name=Sample',
    '-c',
    'user.email=sample@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Update document and binary'
  )
  mkdirSync(resolve(repo, 'ignored'))
  writeFileSync(resolve(repo, 'ignored/hidden.txt'), 'Ignored fixture\n')
  writeFileSync(resolve(repo, 'src/sample.ts'), 'export const value = 2\n')
  await git('add', 'src/sample.ts')
  writeFileSync(resolve(repo, 'src/sample.ts'), 'export const value = 3\n')
  writeFileSync(resolve(repo, 'new.txt'), 'New sample file\n')
  const external = resolve(home, 'external-copy')
  await git('worktree', 'add', '-b', 'topic', external)
  mkdirSync(state, { mode: 0o700 })
  const endpoint = 'wss://sample.example.ts.net:8443/channel',
    config = resolve(state, 'paired.json')
  writeFileSync(
    config,
    JSON.stringify({
      endpoint,
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
    localRegistration = '',
    mobile = false
  const oldSize = JSON.parse(
    evalRaw(`JSON.stringify(require('@electron/remote').getCurrentWindow().getContentSize())`)
  ) as number[]
  let savedPreferences = ''
  try {
    child = spawn(
      process.execPath,
      [
        cli,
        'start',
        '--port',
        '0',
        '--paired-config',
        config,
        '--node-name',
        'Sample node',
        '--state-dir',
        state,
        '--json',
      ],
      { env, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let output = '',
      errors = ''
    child.stdout!.on('data', (data) => {
      output += data
    })
    child.stderr!.on('data', (data) => {
      errors += data
    })
    for (let i = 0; i < 400 && !output.includes('"listening"'); i++) {
      if (child.exitCode !== null) throw new Error(errors)
      await wait(20)
    }
    const ready = JSON.parse(output.split('\n').find((line) => line.includes('"listening"'))!)
    proxy.on('upgrade', (request, socket: Socket, head) => {
      if (request.url !== '/channel') {
        socket.destroy()
        return
      }
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
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
    const port = (proxy.address() as { port: number }).port
    savedPreferences = evalRaw(
      `JSON.stringify({directory:app.loadLocalStorage('abele-node-local-state-dir')??null,device:app.loadLocalStorage('abele-node-device-name')??null})`
    )
    await evalLong(
      `(async()=>{${prelude}if(nodes.nodes.value.length)throw Error('Use a clean node registry fixture');app.saveLocalStorage('abele-node-local-state-dir',${JSON.stringify(state)});app.saveLocalStorage('abele-node-device-name','Sample device');require('@electron/remote').getCurrentWindow().setContentSize(1200,850);app.commands.executeCommandById('abele:open-node');try{await until(()=>visible('.abele-node-panel_found'))}catch(error){const leaf=app.workspace.getLeavesOfType('abele-node-sidebar')[0];const view=leaf?.view;let diagnostic='no view';try{view.discovery.inspect(view.discovery.load(),${JSON.stringify(state)});diagnostic='inspection succeeded'}catch(failure){diagnostic=failure.message}throw Error(JSON.stringify({phase:view?.localPhase?.value,desktop:view?.discovery?.desktop,diagnostic,body:visible('.abele-node-panel')?.textContent}))}return 'opened node'})()`
    )
    await evalLong(
      `(async()=>{${prelude}const view=app.workspace.getLeavesOfType('abele-node-sidebar')[0].view;view.localPhase.value='not-found';await until(()=>visible('.abele-node-panel_not-found code'));if(!visible('.abele-node-panel_not-found code').textContent.includes('install.sh | sh'))throw Error('Unsupported installer command');return 'installer'})()`
    )
    await capture('desktop-installer')
    await evalLong(
      `(async()=>{${prelude}app.workspace.getLeavesOfType('abele-node-sidebar')[0].view.localPhase.value='found';await until(()=>visible('.abele-node-panel_found'));return 'local discovery restored'})()`
    )
    await capture('desktop-found')
    localRegistration = await evalLong(
      `(async()=>{${prelude}button(visible('.abele-node-panel'),'Connect').click();await until(()=>nodes.nodes.value.length===1&&visible('.abele-node-panel_ready'));return nodes.nodes.value[0].id})()`
    )
    await capture('desktop-empty')
    const invitation = await command('pair', '--node-name', 'Sample node')
    await evalLong(
      `(async()=>{${prelude}api.pairedLoopbackTransport(nodes,'ws://127.0.0.1:${port}/channel');visible('.abele-node-panel__node-menu').click();await until(()=>[...document.querySelectorAll('.menu-item')].some(i=>i.textContent.includes('Connect another node')));[...document.querySelectorAll('.menu-item')].find(i=>i.textContent.includes('Connect another node')).click();await until(()=>visible('.abele-pair'));return 'pair open'})()`
    )
    await capture('desktop-pair-empty')
    await evalLong(
      `(async()=>{${prelude}const field=visible('.abele-pair textarea');field.value=${JSON.stringify(invitation.code)};field.dispatchEvent(new Event('input',{bubbles:true}));await until(()=>visible('.abele-pair__card'));return 'decoded locally'})()`
    )
    await capture('desktop-pair-decoded')
    await evalLong(
      `(async()=>{${prelude}const address=visible('.abele-pair input[aria-label="Address"]');address.value='invalid host name';address.dispatchEvent(new Event('input',{bubbles:true}));await wait(50);button(visible('.abele-pair'),'Connect').click();await until(()=>visible('.abele-pair .setting-item.is-invalid'));if(!visible('.abele-pair .setting-item.is-invalid').textContent.includes('Address'))throw Error('Pairing error was not on Address');return 'address error'})()`
    )
    await capture('desktop-pair-address-error')
    await evalLong(
      `(async()=>{${prelude}const address=visible('.abele-pair input[aria-label="Address"]');address.value='sample.example.ts.net';address.dispatchEvent(new Event('input',{bubbles:true}));return 'address restored'})()`
    )
    await evalLong(
      `(async()=>{${prelude}const field=visible('.abele-pair input[aria-label="Port"]');field.value='1e2';field.dispatchEvent(new Event('input',{bubbles:true}));await wait(100);if(!button(visible('.abele-pair'),'Connect').disabled)throw Error('Invalid port admitted');return 'invalid port'})()`
    )
    await capture('desktop-pair-error')
    await evalLong(
      `(async()=>{${prelude}const field=visible('.abele-pair input[aria-label="Port"]');field.value='8443';field.dispatchEvent(new Event('input',{bubbles:true}));await wait(50);button(visible('.abele-pair'),'Connect').click();await until(()=>visible('.abele-pair_waiting'));if(nodes.nodes.value.length!==1)throw Error('Pending claim became a registration');return 'waiting'})()`
    )
    await capture('desktop-pair-waiting')
    const pending = await command('approve-pair', '--list')
    expect(pending).toHaveLength(1)
    expect(pending[0].device_name).toBe('Sample device')
    await command('approve-pair', 'Sample device')
    registration = await evalLong(
      `(async()=>{${prelude}await until(()=>!visible('.abele-pair')&&nodes.nodes.value.some(n=>n.profile==='paired-wss-v1'));const node=nodes.nodes.value.find(n=>n.profile==='paired-wss-v1');await until(()=>nodes.connection(node.id).state.value==='connected');return node.id})()`
    )
    const ids = JSON.parse(
      await evalLong(
        `(async()=>{${prelude}const client=nodes.connection(${JSON.stringify(registration)}).client;const project=await client.nodePath.register({path:${JSON.stringify(repo)},trust:'untrusted',exact_root:true});await client.setRepositorySettings({project_id:project.project_id,external_read:true,default_branch:'trunk'});const plain=await client.nodePath.register({path:${JSON.stringify(plain)},trust:'untrusted',exact_root:true});const rows=await client.repository.worktrees({project_id:project.project_id,include_selection:true});const root=rows.entries.find(w=>w.kind==='root'),external=rows.entries.find(w=>w.kind==='external');await client.nodePath.worktreeSelection({project_id:project.project_id,worktree_id:external.worktree_id,listed:true});const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await api.NodePathService.getInstance().ready(${JSON.stringify(registration)});await model.refresh();await model.select(root.worktree_id);return JSON.stringify({project:project.project_id,root:root.worktree_id,external:external.worktree_id,plain:plain.project_id})})()`
      )
    )
    const rootTarget = {
      nodeId: invitation.invite.node_id,
      registrationId: registration,
      projectId: ids.project,
      kind: 'worktree',
      id: ids.root,
    }
    const open = async (kind: string, extra = {}, target = rootTarget) =>
      evalLong(
        `(async()=>{const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:${JSON.stringify('abele-node-' + kind)},active:true,state:${JSON.stringify({ kind, target, ...extra })}});await app.workspace.revealLeaf(leaf);return 'opened'})()`
      )
    const timings = await evalLong(
      `(async()=>{${prelude}const connection=nodes.connection(${JSON.stringify(registration)}),client=connection.client,records=[];const methods=['observe','status','blob','content','compare','patch','tree','history'];const originals=methods.map(name=>[name,client.repository[name]]);for(const [name,original] of originals)client.repository[name]=async function(...args){const start=performance.now();try{return await original.apply(this,args)}finally{records.push({name,ms:Math.round(performance.now()-start)})}};try{const start=performance.now(),leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-node-file',active:true,state:${JSON.stringify({ kind: 'file', target: rootTarget, path: 'sample.md' })}});const shellMs=Math.round(performance.now()-start);await until(()=>leaf.view.file?.document.value);await until(()=>leaf.containerEl.querySelector('.cm-line'));const totalMs=Math.round(performance.now()-start);leaf.detach();return JSON.stringify({shellMs,totalMs,records})}finally{for(const [name,original] of originals)client.repository[name]=original}})()`
    )
    console.info('Node file open timing', timings)
    const measurement = JSON.parse(timings)
    // The selected target already has a fresh working observation and change metadata.
    // An unchanged file needs only its blob and retained content, not another repository scan.
    expect(measurement.records.map((record: { name: string }) => record.name)).toEqual([
      'blob',
      'content',
    ])
    expect(measurement.shellMs).toBeLessThan(500)
    await reopenNodePane('desktop-reopened-node')
    await evalLong(
      `(async()=>{const view=app.workspace.getLeavesOfType('abele-node-sidebar')[0].view;await view.setState({registrationId:${JSON.stringify(registration)}},{});return 'selected paired fixture'})()`
    )
    await capture('desktop-changes')
    await checkFileLookup('desktop')
    await evalLong(
      `(async()=>{${prelude}const chats=api.ChatService.getInstance();const id=chats.newTab();const chat=chats.getAllSessions().find(s=>s.id===id);if(!chat)throw Error('Chat was not created');chat.chatTitle.value='Sample Obsidian chat '+id;window.__nodePathScopeChat=id;const row=[...visible('.abele-folder-tree').querySelectorAll('.abele-folder-tree__copy > .tree-item-self')].find(r=>r.textContent.includes('trunk'));row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:row.getBoundingClientRect().left,clientY:row.getBoundingClientRect().bottom}));await until(()=>[...document.querySelectorAll('.menu-item')].some(i=>i.textContent.includes('Give the Obsidian chat access')));[...document.querySelectorAll('.menu-item')].find(i=>i.textContent.includes('Give the Obsidian chat access')).click();await until(()=>[...document.querySelectorAll('.suggestion-item')].some(i=>i.textContent.includes(id)));[...document.querySelectorAll('.suggestion-item')].find(i=>i.textContent.includes(id)).click();await until(()=>[...document.querySelectorAll('.modal button')].some(b=>b.textContent.trim()==='Give access'));[...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='Give access').click();await until(()=>chat.overrides.value.nodeScope?.length===1&&!visible('.modal'));await chats.revealSidebar({focus:false});await until(()=>visible('[aria-label="Chat node access"]'));return 'scope granted by row menu'})()`
    )
    await capture('desktop-chat-scope-header')
    await evalLong(
      `(async()=>{${prelude}const panel=visible('.abele-node-panel');const file=[...panel.querySelectorAll('.tree-item-self')].find(r=>r.textContent.includes('sample.ts'));file.click();await until(()=>visible('.abele-file-view')?.textContent.includes('value = 3'));const view=app.workspace.getLeavesOfType('abele-node-file')[0].view;if(view.file.mode.value!=='diff')throw Error('Changed file did not default to diff');if(JSON.stringify(view.getState()).includes('wss://'))throw Error('Transport URL leaked into layout');return 'diff'})()`
    )
    await capture('desktop-diff')
    await selectText('.abele-file-view .abele-diff__line_added .abele-diff__text')
    await capture('desktop-diff-selection')
    await clearSelection()
    await evalLong(
      `(async()=>{${prelude}const view=app.workspace.getLeavesOfType('abele-node-file')[0].view;const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await model.select(${JSON.stringify(ids.external)});await view.file.step(1);if(view.file.target.id!==${JSON.stringify(ids.root)})throw Error('File arrows followed the sidebar');await view.file.open('src/sample.ts');view.file.mode.value='file';return 'bound navigation'})()`
    )
    await capture('desktop-whole')
    await checkCodeGeometry()
    await selectText('.abele-file-view .cm-line')
    await capture('desktop-file-selection')
    await evalLong(
      `(async()=>{${prelude}button(visible('.abele-file-view__selection'),'Add to chat').click();const id=window.__nodePathScopeChat;await until(()=>[...document.querySelectorAll('.suggestion-item')].some(i=>i.textContent.includes(id)));[...document.querySelectorAll('.suggestion-item')].find(i=>i.textContent.includes(id)).click();const chat=api.ChatService.getInstance().getAllSessions().find(s=>s.id===id);await until(()=>chat.draft.value.text.includes('src/sample.ts:1')&&chat.draft.value.text.includes('> export const value = 3'));if(/"(?:node_context|node_id|content_id)"/.test(chat.draft.value.text))throw Error('Routing payload appeared in the composer');return 'quoted to Obsidian draft'})()`
    )
    await clearSelection()
    await selectText('.abele-file-view .cm-line')
    await evalLong(
      `(async()=>{${prelude}button(visible('.abele-file-view__selection'),'Ask here').click();await until(()=>[...document.querySelectorAll('.suggestion-item')].some(i=>i.textContent.includes('Fake')));[...document.querySelectorAll('.suggestion-item')].find(i=>i.textContent.includes('Fake')).click();await until(()=>[...document.querySelectorAll('.modal button')].some(b=>b.textContent.trim()==='Allow execution'));[...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='Allow execution').click();await until(()=>app.workspace.getLeavesOfType('abele-node-chat').some(l=>l.view.presenter?.draft.value.text.includes('src/sample.ts:1')));const leaf=app.workspace.getLeavesOfType('abele-node-chat').find(l=>l.view.presenter?.draft.value.text.includes('src/sample.ts:1'));if(leaf.view.getState().target.id!==${JSON.stringify(ids.root)}||leaf.view.presenter.isStreaming.value)throw Error('Selected quote was sent or followed the drawer target');if(!leaf.view.presenter.draft.value.text.includes('> export const value = 3')||/"(?:node_context|node_id|content_id)"/.test(leaf.view.presenter.draft.value.text))throw Error('Node draft is not a readable excerpt');return 'quoted to target-bound node draft'})()`
    )
    await clearSelection()
    await capture('desktop-node-selection-context')
    await open('file', {
      path: 'src/sample.ts',
      debug: {
        conversationId: 'sample-debug-chat',
        sourceId: 'sample-source',
        debugSessionId: 'sample-debug',
        incarnation: 'sample-incarnation',
      },
    })
    await evalLong(
      `(async()=>{${prelude}await until(()=>visible('.abele-debug-source__margin'));return 'debug margin'})()`
    )
    await capture('desktop-file-debug-margin')
    await open('history')
    await evalLong(
      `(async()=>{${prelude}await until(()=>visible('.abele-history__row'));return 'history'})()`
    )
    await capture('desktop-history')
    await evalLong(
      `(async()=>{${prelude}visible('.abele-history__row').click();try{await until(()=>visible('.abele-history__commit-head'))}catch(error){throw Error(JSON.stringify(app.workspace.getLeavesOfType('abele-node-history').map(l=>({error:l.view.history?.error.value,busy:l.view.history?.busy.value,open:l.view.history?.openCommit.value}))))}return 'commit'})()`
    )
    await checkMixedCommit()
    await capture('desktop-commit')
    await open('file', { path: 'sample-image.png' })
    await evalLong(
      `(async()=>{${prelude}await until(()=>visible('.abele-file-view img.abele-image')?.naturalWidth===1);return 'image rendered'})()`
    )
    await capture('desktop-image')
    await evalLong(
      `(async()=>{${prelude}const leaf=app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.getState().path==='src/sample.ts'&&!l.view.getState().debug);await app.workspace.revealLeaf(leaf);const action=leaf.containerEl.querySelector('[aria-label="Open in code editor"]');if(!action)throw Error('Code editor action missing');action.click();await until(()=>visible('.abele-node-main .cm-content')?.contentEditable==='true');return 'editor action'})()`
    )
    await evalLong(
      `(async()=>{${prelude}await until(()=>visible('.abele-node-main .cm-content')?.contentEditable==='true');const editor=api.codeView(visible('.abele-node-main .cm-content'));editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:${JSON.stringify('export const value = 4\n')}}});await until(()=>button(visible('.abele-node-save'),'Save file')&&!button(visible('.abele-node-save'),'Save file').disabled);button(visible('.abele-node-save'),'Save file').click();await until(()=>visible('.abele-node-save')?.textContent.includes('Saved ·'));return 'saved'})()`
    )
    await checkCodeGeometry()
    await capture('desktop-editor')
    await evalLong(
      `(async()=>{${prelude}const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await model.select(${JSON.stringify(ids.root)});visible('.abele-node-panel [aria-label="Open folder"]').click();await until(()=>visible('.abele-folder-picker'));return 'picker'})()`
    )
    await capture('desktop-folder-picker')
    await evalLong(
      `(async()=>{${prelude}const input=visible('.abele-folder-picker input');input.value=${JSON.stringify(resolve(home, 'created-folder'))};input.dispatchEvent(new Event('input',{bubbles:true}));await until(()=>button(visible('.abele-folder-picker'),'Create'));return 'new folder'})()`
    )
    await capture('desktop-new-folder')
    await evalLong(
      `(async()=>{${prelude}button(visible('.abele-folder-picker'),'Create').click();await until(()=>!visible('.abele-folder-picker'));const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});if(!model.folders.value.some(f=>f.name==='created-folder'))throw Error('Created folder was not registered');await model.select(${JSON.stringify(ids.root)});const row=[...visible('.abele-folder-tree').querySelectorAll('.abele-folder-tree__copy > .tree-item-self')].find(r=>r.textContent.includes('trunk'));row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:row.getBoundingClientRect().left,clientY:row.getBoundingClientRect().bottom}));await until(()=>[...document.querySelectorAll('.menu-item')].some(i=>i.textContent.includes('New worktree')));[...document.querySelectorAll('.menu-item')].find(i=>i.textContent.includes('New worktree')).click();await until(()=>visible('.abele-worktree-dialog'));const branch=visible('.abele-worktree-dialog input');branch.value='created-topic';branch.dispatchEvent(new Event('input',{bubbles:true}));await wait(100);return 'named worktree'})()`
    )
    await capture('desktop-new-worktree')
    await evalLong(
      `(async()=>{${prelude}button(visible('.abele-worktree-dialog'),'Create').click();await until(()=>!visible('.abele-worktree-dialog'));const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});for(let i=0;i<100&&!model.folders.value.flatMap(f=>f.copies).some(c=>c.branch==='created-topic');i++){await model.refresh();await wait(50)}if(!model.folders.value.flatMap(f=>f.copies).some(c=>c.branch==='created-topic'))throw Error('Named worktree never became ready');return 'created named worktree'})()`
    )
    const sessionId = await evalLong(
      `(async()=>{${prelude}const client=nodes.connection(${JSON.stringify(registration)}).client;await client.nodePath.trust({project_id:${JSON.stringify(ids.project)},trust:'trusted'});await client.nodePath.execution({project_id:${JSON.stringify(ids.project)},target:{kind:'worktree',worktree_id:${JSON.stringify(ids.root)}},enabled:true});await client.nodePath.execution({project_id:${JSON.stringify(ids.project)},target:{kind:'worktree',worktree_id:${JSON.stringify(ids.external)}},enabled:true});const session=await client.nodePath.createSession({title:'Sample fake chat',provider:'fake',target:{kind:'worktree',worktree_id:${JSON.stringify(ids.root)}}});await api.NodePathService.getInstance().model(${JSON.stringify(registration)}).refresh();return session.session_id})()`
    )
    await open('chat', { sessionId, title: 'Sample fake chat' })
    await evalLong(
      `(async()=>{${prelude}const view=app.workspace.getLeavesOfType('abele-node-chat').find(l=>l.view.getState().sessionId===${JSON.stringify(sessionId)}).view;await view.presenter.send('Sample task',[{kind:'hang'}]);await until(()=>view.presenter.isStreaming.value);const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await model.refresh();if(!model.folders.value.flatMap(f=>f.copies).find(c=>c.id===${JSON.stringify(ids.root)}).running)throw Error('No running marker');return 'running'})()`
    )
    await capture('desktop-chat-running')
    await evalLong(
      `(async()=>{${prelude}const view=app.workspace.getLeavesOfType('abele-node-chat').find(l=>l.view.getState().sessionId===${JSON.stringify(sessionId)}).view;await view.presenter.interrupt(view.presenter.projection.value.activeRuns[0]);await until(()=>!view.presenter.isStreaming.value);const client=nodes.connection(${JSON.stringify(registration)}).client;await client.nodePath.sessionWorktreeSet({session_id:${JSON.stringify(sessionId)},expected_target:{kind:'worktree',worktree_id:${JSON.stringify(ids.root)}},target:{kind:'worktree',worktree_id:${JSON.stringify(ids.external)}}});await until(()=>visible('.abele-worktree-switch'));await api.NodePathService.getInstance().model(${JSON.stringify(registration)}).refresh();return 'journal switch'})()`
    )
    await capture('desktop-chat-switch')
    await evalLong(
      `(async()=>{${prelude}const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});model.selectedChat.value=${JSON.stringify(sessionId)};await model.select(${JSON.stringify(ids.external)});await until(()=>visible('.abele-chat-row'));visible('.abele-chat-row').scrollIntoView({block:'nearest'});return 'nested rows'})()`
    )
    await checkPanelColumns()
    await capture('desktop-nested-panel')
    await evalLong(
      `(async()=>{${prelude}const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await model.select(${JSON.stringify(ids.plain)});return 'plain'})()`
    )
    await capture('desktop-plain')
    // A phone registry contains paired nodes, not a desktop-only loopback registration.
    await evalLong(
      `(()=>{window.__abeleTest.NodeService.getInstance().remove(${JSON.stringify(localRegistration)});return 'desktop registration removed'})()`
    )
    localRegistration = ''
    const scopeBeforeReload = JSON.parse(
      await evalLong(
        `(async()=>{${prelude}const chats=api.ChatService.getInstance();const chat=chats.getAllSessions().find(s=>s.overrides.value.nodeScope?.some(scope=>scope.node_id===${JSON.stringify(rootTarget.nodeId)}));if(!chat)throw Error('Scoped chat missing before reload');const file=chat.currentChatFile.value;return JSON.stringify({path:file?.path??null,scope:chat.overrides.value.nodeScope,tabs:app.loadLocalStorage('abele-agent-tabs'),stored:file?(await api.ChatStorage.getInstance().loadChat(file)).metadata?.overrides?.nodeScope:null})})()`
      )
    )
    console.info('Node scoped chat before reload', JSON.stringify(scopeBeforeReload))
    // Reload into the real phone shell, then restore only this fixture's paired transport.
    await reloadApp('app.emulateMobile(true)')
    mobile = true
    await evalLong(
      `(async()=>{${prelude}require('@electron/remote').getCurrentWindow().setContentSize(390,844);api.pairedLoopbackTransport(nodes,'ws://127.0.0.1:${port}/channel');await nodes.connection(${JSON.stringify(registration)}).refreshAuthorization();nodes.connection(${JSON.stringify(registration)}).start();await nodes.connection(${JSON.stringify(registration)}).connect();const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await api.NodePathService.getInstance().ready(${JSON.stringify(registration)});await model.refresh();await model.select(${JSON.stringify(ids.root)});const sidebar=app.workspace.getLeavesOfType('abele-node-sidebar')[0]??app.workspace.getLeftLeaf(false);if(!sidebar)throw Error('No native left drawer leaf');await sidebar.setViewState({type:'abele-node-sidebar',active:true,state:{registrationId:${JSON.stringify(registration)}}});await app.workspace.revealLeaf(sidebar);app.workspace.leftSplit.expand();await until(()=>visible('.abele-node-panel'));return 'phone drawer'})()`,
      60000
    )
    await reopenNodePane('phone-reopened-node')
    await evalLong(
      `(async()=>{${prelude}const sidebar=app.workspace.getLeavesOfType('abele-node-sidebar')[0];await sidebar.view.setState({registrationId:${JSON.stringify(registration)}},{});await app.workspace.revealLeaf(sidebar);app.workspace.leftSplit.expand();await until(()=>visible('.abele-node-panel_ready'));return 'paired drawer'})()`
    )
    await capture('phone-changes')
    await checkFileLookup('phone')
    await evalLong(
      `(async()=>{${prelude}const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});model.selectedChat.value=${JSON.stringify(sessionId)};await model.select(${JSON.stringify(ids.external)});await until(()=>visible('.abele-chat-row'));visible('.abele-chat-row').scrollIntoView({block:'nearest'});return 'nested phone rows'})()`
    )
    await checkPanelColumns()
    await capture('phone-nested-panel')
    await evalLong(
      `(async()=>{${prelude}await api.NodePathService.getInstance().model(${JSON.stringify(registration)}).select(${JSON.stringify(ids.root)});return 'root'})()`
    )
    await evalLong(
      `(async()=>{${prelude}visible('.abele-node-panel__node-menu').click();await until(()=>[...document.querySelectorAll('.menu-item')].some(i=>i.textContent.includes('Connect another node')));[...document.querySelectorAll('.menu-item')].find(i=>i.textContent.includes('Connect another node')).click();await until(()=>visible('.abele-pair'));return 'phone pair'})()`
    )
    await capture('phone-pair-empty')
    await evalLong(
      `(async()=>{${prelude}const field=visible('.abele-pair textarea');field.value=${JSON.stringify(invitation.code)};field.dispatchEvent(new Event('input',{bubbles:true}));await until(()=>visible('.abele-pair__card'));return 'phone code fields'})()`
    )
    await capture('phone-pair-decoded')
    await evalLong(
      `(async()=>{${prelude}const address=visible('.abele-pair input[aria-label="Address"]');address.value='invalid host name';address.dispatchEvent(new Event('input',{bubbles:true}));await wait(50);button(visible('.abele-pair'),'Connect').click();await until(()=>visible('.abele-pair .setting-item.is-invalid'));return 'phone address error'})()`
    )
    await capture('phone-pair-address-error')
    await evalLong(
      `(async()=>{${prelude}const port=visible('.abele-pair input[aria-label="Port"]');port.value='0';port.dispatchEvent(new Event('input',{bubbles:true}));await wait(50);return 'phone error'})()`
    )
    await capture('phone-pair-error')
    await evalLong(
      `(async()=>{${prelude}const modal=visible('.abele-pair').closest('.modal');const close=modal.closest('.modal-container').querySelector('.modal-close-button, .modal-close, .modal-header-button, [aria-label="Close"]');if(!close)throw Error('Native modal dismiss control missing: '+[...modal.closest('.modal-container').querySelectorAll('button,.clickable-icon')].map(el=>el.className+' '+el.getAttribute('aria-label')).join('|'));close.click();await until(()=>!visible('.abele-pair'));visible('.abele-node-panel [aria-label="Open folder"]').click();await until(()=>visible('.abele-folder-picker'));return 'phone folder picker'})()`
    )
    await capture('phone-folder-picker')
    await evalLong(
      `(async()=>{${prelude}button(visible('.abele-folder-picker'),'Cancel').click();await until(()=>!visible('.abele-folder-picker'));return 'picker closed'})()`
    )
    await evalLong(
      `(async()=>{${prelude}const panel=visible('.abele-node-panel');[...panel.querySelectorAll('.tree-item-self')].find(r=>r.textContent.includes('sample.ts')).click();await until(()=>visible('.abele-file-view'));if(app.workspace.leftSplit.collapsed===false)throw Error('File did not close the drawer');return JSON.stringify({width:innerWidth,height:innerHeight})})()`
    )
    await capture('phone-diff')
    await selectText('.abele-file-view .abele-diff__line_added .abele-diff__text')
    await capture('phone-diff-selection')
    await clearSelection()
    await evalLong(
      `(async()=>{${prelude}const view=app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.contentEl.contains(visible('.abele-file-view'))).view;view.file.mode.value='file';await until(()=>visible('.abele-file-view .cm-line'));return 'whole file'})()`
    )
    await checkCodeGeometry()
    await selectText('.abele-file-view .cm-line')
    await capture('phone-file-selection')
    await clearSelection()
    await open('file', {
      path: 'src/sample.ts',
      debug: {
        conversationId: 'sample-debug-chat',
        sourceId: 'sample-source',
        debugSessionId: 'sample-debug',
        incarnation: 'sample-incarnation',
      },
    })
    await evalLong(
      `(async()=>{${prelude}app.workspace.leftSplit.collapse();try{await until(()=>visible('.abele-debug-source__margin'))}catch(error){throw Error(JSON.stringify(app.workspace.getLeavesOfType('abele-node-file').map(l=>({state:l.view.getState(),mode:l.view.file?.mode.value,error:l.view.file?.error.value,document:l.view.file?.document.value,html:l.view.contentEl.innerHTML.slice(0,1800)}))))};return 'phone debug margin'})()`
    )
    await capture('phone-file-debug-margin')
    await evalLong(
      `(async()=>{${prelude}const chats=api.ChatService.getInstance();const chat=chats.getAllSessions().find(s=>s.overrides.value.nodeScope?.some(scope=>scope.node_id===${JSON.stringify(rootTarget.nodeId)}));if(!chat){const expectedPath=${JSON.stringify(scopeBeforeReload.path)},file=expectedPath?app.vault.getAbstractFileByPath(expectedPath):null;throw Error('Scoped chat was not restored '+JSON.stringify({before:${JSON.stringify(scopeBeforeReload)},tabs:app.loadLocalStorage('abele-agent-tabs'),restoring:chats.restoringTabs,sessions:chats.getAllSessions().map(s=>({path:s.currentChatFile.value?.path,scope:s.overrides.value.nodeScope})),stored:file?(await api.ChatStorage.getInstance().loadChat(file)).metadata?.overrides?.nodeScope:null}))}chats.switchTab(chat.id);await chats.revealSidebar({focus:false});await until(()=>visible('[aria-label="Chat node access"]'));return 'phone scoped chat'})()`
    )
    await capture('phone-chat-scope-header')
    await open('history')
    await evalLong(
      `(async()=>{${prelude}app.workspace.leftSplit.collapse();await until(()=>visible('.abele-history__row'));return 'phone history'})()`
    )
    await capture('phone-history')
    await evalLong(
      `(async()=>{${prelude}visible('.abele-history__row').click();await until(()=>visible('.abele-history__commit-head'));return 'phone commit'})()`
    )
    await checkMixedCommit()
    await capture('phone-commit')
    await open('file', { path: 'sample-image.png' })
    await evalLong(
      `(async()=>{${prelude}app.workspace.leftSplit.collapse();await until(()=>visible('.abele-file-view img.abele-image')?.naturalWidth===1);return 'phone image rendered'})()`
    )
    await capture('phone-image')
    await open(
      'chat',
      { sessionId, title: 'Sample fake chat' },
      { ...rootTarget, id: ids.external }
    )
    await evalLong(
      `(async()=>{${prelude}app.workspace.leftSplit.collapse();await until(()=>visible('.abele-worktree-chip')?.textContent.includes('topic'));const toolbar=visible('.abele-node-chat .abele-chat-input__toolbar'),navbar=visible('.mobile-navbar');if(navbar&&toolbar.getBoundingClientRect().bottom>navbar.getBoundingClientRect().top+1)throw Error('Node composer actions are covered by the native mobile navbar');return 'phone chat'})()`
    )
    await capture('phone-chat')
    await open('editor', { path: 'src/sample.ts' })
    await evalLong(
      `(async()=>{${prelude}app.workspace.leftSplit.collapse();await until(()=>visible('.abele-node-main .cm-content'));return 'phone editor'})()`
    )
    await checkCodeGeometry()
    await capture('phone-editor')
    await evalLong(
      `(async()=>{${prelude}app.workspace.leftSplit.expand();const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await model.select(${JSON.stringify(ids.plain)});return 'phone plain'})()`
    )
    await capture('phone-plain')
    child.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      if (child!.exitCode !== null) resolve()
      else child!.once('exit', () => resolve())
    })
    child = undefined
    await evalLong(
      `(async()=>{${prelude}await until(()=>nodes.connection(${JSON.stringify(registration)}).state.value!=='connected');if(!visible('.abele-folder-tree_stale'))throw Error('Offline rows lost their retained state');return 'offline'})()`
    )
    await capture('phone-offline')
  } finally {
    try {
      await evalLong(
        `(async()=>{${prelude}for(const type of ['abele-node-sidebar','abele-node-file','abele-node-history','abele-node-chat','abele-node-editor'])for(const leaf of app.workspace.getLeavesOfType(type))leaf.detach();for(const id of ${JSON.stringify([registration, localRegistration].filter(Boolean))})nodes.remove(id);const old=${savedPreferences || '{}'};app.saveLocalStorage('abele-node-local-state-dir',old.directory);app.saveLocalStorage('abele-node-device-name',old.device);app.workspace.requestSaveLayout();await wait(1000);return 'cleaned'})()`
      )
    } catch {
      /* The daemon and proxy must still stop after a failed shell probe. */
    }
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => proxy.close(() => resolve()))
    if (child && child.exitCode === null) {
      child.kill('SIGTERM')
      await new Promise<void>((resolve) => child!.once('exit', () => resolve()))
    }
    if (mobile) await reloadApp('app.emulateMobile(false)')
    await evalLong(
      `(async()=>{for(const type of ['abele-node-sidebar','abele-node-file','abele-node-history','abele-node-chat','abele-node-editor'])for(const leaf of app.workspace.getLeavesOfType(type))leaf.detach();app.workspace.requestSaveLayout();await new Promise(r=>setTimeout(r,1000));return 'desktop roots cleared'})()`
    )
    evalRaw(
      `require('@electron/remote').getCurrentWindow().setContentSize(${oldSize[0]},${oldSize[1]});'restored'`
    )
    rmSync(dir, { recursive: true, force: true })
  }
}, 240000)
