import { expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { evalLong, evalRaw, reloadApp } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
import { supportsExpectedTarget } from '@/node/expectedTarget'

targets('desktop')
const cli = process.env.ABELE_NODE_CLI
const shots = shotDir('abele-node-target')
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))
const prelude = `const api=window.__abeleTest,nodes=api.NodeService.getInstance();const wait=ms=>new Promise(r=>setTimeout(r,ms));const until=async f=>{for(let i=0;i<300;i++){if(f())return;await wait(50)}throw Error('Guarded chat did not settle: '+f.toString())};`

it('retains a raced target-refused draft, shows the real target and sends only on a new request in desktop and phone shells', async () => {
  if (!cli) throw new Error('Set ABELE_NODE_CLI to a built node CLI')
  await reloadApp()
  const dir = mkdtempSync(resolve(tmpdir(), 'sample-node-target-'))
  const repository = resolve(dir, 'sample-repository')
  const external = resolve(dir, 'sample-topic')
  const state = resolve(dir, 'state')
  mkdirSync(repository)
  const git = (...args: string[]) => {
    const result = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: repository,
      encoding: 'utf8',
    })
    if (result.status) throw Error(result.stderr)
  }
  git('init', '--initial-branch=main')
  writeFileSync(resolve(repository, 'sample.txt'), 'Sample content\n')
  git('add', '.')
  git(
    '-c',
    'user.name=Sample',
    '-c',
    'user.email=sample@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Sample content'
  )
  git('worktree', 'add', '-b', 'sample-topic', external)
  const env = {
    ...process.env,
    HOME: dir,
    ABELE_CLAUDE_PATH: resolve('tests/fixtures/nodeClaude.mjs'),
    ABELE_CODEX_PATH: '',
  }
  const command = (...args: string[]) => {
    const result = spawnSync(process.execPath, [cli, ...args, '--state-dir', state, '--json'], {
      env,
      encoding: 'utf8',
    })
    if (result.status) throw Error(result.stderr)
    return JSON.parse(result.stdout)
  }
  let child: ChildProcess | undefined
  let registration = ''
  let mobile = false
  const oldSize = JSON.parse(
    evalRaw(`JSON.stringify(require('@electron/remote').getCurrentWindow().getContentSize())`)
  ) as number[]
  try {
    const credential = command('token', 'create', 'sample-device')
    child = spawn(
      process.execPath,
      [cli, 'start', '--state-dir', state, '--port', '0', '--no-codex', '--json'],
      { env, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let output = '',
      errors = ''
    child.stdout!.on('data', (bytes) => {
      output += bytes
    })
    child.stderr!.on('data', (bytes) => {
      errors += bytes
    })
    for (let i = 0; i < 400 && !output.includes('"listening"'); i++) {
      if (child.exitCode !== null) throw Error(errors)
      await wait(20)
    }
    const line = output.split('\n').find((value) => value.includes('"listening"'))
    if (!line) throw Error('Node readiness was missing: ' + errors)
    const { port } = JSON.parse(line)
    const version = command('status').runtime.version
    expect(supportsExpectedTarget({ version })).toBe(true)
    registration = await evalLong(
      `(async()=>{${prelude}const node=await nodes.add('Sample guarded node','http://127.0.0.1:${port}',${JSON.stringify(credential.token)});return node.id})()`
    )
    // The fake description supplies the node release field. Real admission and refusal use the daemon.
    const describe = `const client=nodes.connection(${JSON.stringify(registration)}).client;const describe=client.describe.bind(client);client.describe=async()=>({...await describe(),version:${JSON.stringify(version)}});`
    const ids = JSON.parse(
      await evalLong(
        `(async()=>{${prelude}${describe}const project=await client.nodePath.register({path:${JSON.stringify(repository)},trust:'trusted',exact_root:true});await client.setRepositorySettings({project_id:project.project_id,external_read:true});const rows=await client.repository.worktrees({project_id:project.project_id});const root=rows.entries.find(w=>w.kind==='root'),other=rows.entries.find(w=>w.kind==='external');await client.nodePath.worktreeSelection({project_id:project.project_id,worktree_id:other.worktree_id,listed:true});for(const row of [root,other])await client.nodePath.execution({project_id:project.project_id,target:{kind:'worktree',worktree_id:row.worktree_id},enabled:true});const session=await client.nodePath.createSession({title:'Sample guarded chat',provider:'fake',target:{kind:'worktree',worktree_id:root.worktree_id}});const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await api.NodePathService.getInstance().ready(${JSON.stringify(registration)});await model.refresh();return JSON.stringify({project:project.project_id,root:root.worktree_id,other:other.worktree_id,session:session.session_id,node:await client.store.transaction(s=>s.node_id)})})()`
      )
    )
    const reference = {
      kind: 'node-session',
      nodeId: ids.node,
      registrationId: registration,
      sessionId: ids.session,
      title: 'Sample guarded chat',
    }
    const open = () =>
      evalLong(
        `(async()=>{${prelude}const chats=api.ChatService.getInstance();await chats.openNodeSession(${JSON.stringify(reference)});await chats.revealSidebar({focus:false});const presenter=chats.getNodeSession(chats.activeTabId.value);await presenter.load();await until(()=>presenter.nodeDescription.value?.version);await until(()=>document.querySelector('.abele-node-chat[data-session-id="${ids.session}"] textarea'));return 'opened'})()`
      )
    const chatPrelude = `${prelude}const client=nodes.connection(${JSON.stringify(registration)}).client;const chats=api.ChatService.getInstance();const presenter=chats.getNodeSession(chats.activeTabId.value);const root=document.querySelector('.abele-node-chat[data-session-id="${ids.session}"]');`
    for (const shell of ['desktop', 'phone'] as const) {
      const draft =
        shell === 'phone'
          ? 'Sample phone follow-up\nwith a second line'
          : 'Sample retained request\nwith a second line'
      if (shell === 'phone') {
        await reloadApp('app.emulateMobile(true)')
        mobile = true
        await evalLong(
          `(async()=>{${prelude}require('@electron/remote').getCurrentWindow().setContentSize(390,844);${describe}await nodes.connection(${JSON.stringify(registration)}).connect();return 'phone ready'})()`
        )
      }
      await open()
      const report = JSON.parse(
        await evalLong(
          `(async()=>{${chatPrelude}await until(()=>presenter.binding.value?.incarnation);const shown={target:{...presenter.binding.value.target},incarnation:presenter.binding.value.incarnation};const before=presenter.messages.value.filter(m=>m.role==='user').length;const cursor=client.cursor.bind(client);client.cursor=async session=>{client.cursor=cursor;await client.nodePath.sessionWorktreeSet({session_id:session,expected_target:shown.target,target:{kind:'worktree',worktree_id:${JSON.stringify(ids.other)}}});return cursor(session)};const field=root.querySelector('textarea');field.value=${JSON.stringify(draft)};field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true}));await until(()=>root.querySelector('.abele-node-chat__draft-note')?.textContent.includes('Nothing was sent'));await until(()=>root.querySelector('.abele-worktree-chip')?.textContent.includes('sample-topic'));await wait(300);const retained=await client.store.transaction(s=>({pending:s.outbox.length,refusals:Object.values(s.results).filter(r=>r.result?.code==='target_changed').length}));return JSON.stringify({draft:field.value,note:root.querySelector('.abele-node-chat__draft-note').textContent.trim(),users:presenter.messages.value.filter(m=>m.role==='user').length-before,again:!!root.querySelector('[aria-label="Send again"]'),target:presenter.binding.value.target,retained,width:innerWidth,height:innerHeight})})()`
        )
      )
      expect(report.draft).toBe(draft)
      expect(report.note).toBe(
        'The chat moved. Nothing was sent. Review the current target before sending again.'
      )
      expect(report.users).toBe(0)
      expect(report.again).toBe(true)
      expect(report.retained.pending).toBe(0)
      expect(report.retained.refusals).toBeGreaterThan(0)
      expect(report.target).toEqual({ kind: 'worktree', worktree_id: ids.other })
      if (shell === 'phone') expect([report.width, report.height]).toEqual([390, 844])
      await evalLong(
        `(async()=>{${chatPrelude}const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(resolve(shots, shell + '-refusal.png'))},image.resize({width:innerWidth,height:innerHeight}).toPNG());return 'captured'})()`
      )
      await evalLong(
        `(async()=>{${chatPrelude}root.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true}));await until(()=>presenter.draft.value.text==='');await until(()=>presenter.messages.value.some(m=>m.role==='assistant'&&m.content===${JSON.stringify(draft)}));await until(()=>!presenter.isStreaming.value);if(root.querySelector('.abele-node-chat__draft-note'))throw Error('Accepted draft still has a refusal note');const actual=await client.nodePath.sessionWorktreeGet({session_id:${JSON.stringify(ids.session)}});await client.nodePath.sessionWorktreeSet({session_id:${JSON.stringify(ids.session)},expected_target:actual.target,target:{kind:'worktree',worktree_id:${JSON.stringify(ids.root)}}});await presenter.refreshBinding();return 'explicit follow-up accepted'})()`
      )
    }
  } finally {
    try {
      await evalLong(
        `(async()=>{${prelude}const chats=api.ChatService.getInstance();for(const id of [...chats.tabOrder.value])if(chats.getNodeSession(id)?.reference.registrationId===${JSON.stringify(registration)})await chats.closeTab(id);if(${JSON.stringify(registration)})nodes.remove(${JSON.stringify(registration)});app.workspace.requestSaveLayout();await wait(1000);return 'cleaned'})()`
      )
    } finally {
      if (child && child.exitCode === null) {
        child.kill('SIGTERM')
        await new Promise<void>((done) => child!.once('exit', () => done()))
      }
      if (mobile) await reloadApp('app.emulateMobile(false)')
      await evalLong(
        `(async()=>{${prelude}const chats=api.ChatService.getInstance();for(const id of [...chats.tabOrder.value])if(chats.getNodeSession(id)?.reference.registrationId===${JSON.stringify(registration)})await chats.closeTab(id);app.workspace.requestSaveLayout();await wait(1000);return 'desktop fixture roots cleared'})()`
      )
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${oldSize[0]},${oldSize[1]});'restored'`
      )
      rmSync(dir, { recursive: true, force: true })
    }
  }
}, 180000)
