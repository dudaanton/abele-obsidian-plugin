import { expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { evalAsync } from './helpers/githubLive'
import { reloadPlugin, evalRaw } from './helpers/obsidianCli'
import { targets } from './helpers/target'
targets('desktop')
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const prelude = `const wait=ms=>new Promise(r=>setTimeout(r,ms)),until=async fn=>{for(let i=0;i<200;i++){if(fn())return;await wait(50)}throw Error('File editor did not converge: '+fn.toString()+'; '+document.querySelector('.abele-node-files')?.textContent.slice(0,1000))};
const nodes=window.__abeleTest.NodeService.getInstance(),chats=window.__abeleTest.ChatService.getInstance();
const press=text=>[...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()===text).click();
const enter=async text=>{const editor=document.querySelector('.abele-node-files [contenteditable="true"]');editor.focus();document.execCommand('selectAll');document.execCommand('insertText',false,text);await wait(300)};
const close=async()=>{const button=[...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='Close');if(button)button.click();else document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));await until(()=>!document.querySelector('.modal'))};`
it('edits from the node code view, restores local drafts, and checks a lost save without overwriting an external edit', async () => {
  const cli = process.env.ABELE_NODE_CLI
  if (!cli) throw new Error('Set ABELE_NODE_CLI to the built daemon CLI')
  // The daemon reuses recovery directories only under a canonical state path; the
  // system temporary directory can itself be a symlink.
  const dir = realpathSync(mkdtempSync('/tmp/abele-edit-')),
    repo = resolve(dir, 'repo'),
    state = resolve(dir, 'state')
  mkdirSync(repo)
  writeFileSync(resolve(repo, 'sample.txt'), 'before')
  const git = (...args: string[]) => {
    const r = spawnSync('/usr/bin/git', args, { cwd: repo, encoding: 'utf8' })
    if (r.status) throw Error(r.stderr)
  }
  git('init', '-b', 'main')
  git('add', '.')
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'fixture'
  )
  const fake = resolve('tests/fixtures/nodeClaude.mjs')
  const token = spawnSync(
    process.execPath,
    [cli, 'token', 'create', 'fixture', '--state-dir', state, '--claude-path', fake],
    { encoding: 'utf8' }
  )
  expect(token.status, token.stderr).toBe(0)
  const credential = JSON.parse(token.stdout) as { token: string }
  let child: ChildProcess | undefined,
    registration = '',
    workspacePath = ''
  try {
    child = spawn(
      process.execPath,
      [cli, 'start', '--state-dir', state, '--port', '0', '--claude-path', fake],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let output = '',
      errors = ''
    child.stdout!.on('data', (b) => (output += b))
    child.stderr!.on('data', (b) => (errors += b))
    for (let i = 0; !output.includes('"listening"'); i++) {
      if (i > 500 || child.exitCode !== null) throw Error(errors || 'Daemon startup deadline')
      await wait(20)
    }
    const info = JSON.parse(output.split('\n').find((l) => l.includes('"listening"'))!) as {
      port: number
    }
    const setup = evalAsync<{ registration: string; path: string }>(`(async()=>{${prelude}
      await close();const node=await nodes.add('Editing fixture','http://127.0.0.1:${info.port}',${JSON.stringify(credential.token)}),client=nodes.connection(node.id).client;
      try {
      const project=await client.registerProject(${JSON.stringify(repo)},'untrusted'),job=await client.createWorkspace(project.project_id);
      for(let i=0;i<200;i++){const state=await client.getJob(job.job_id);if(state.state==='succeeded')break;if(state.state==='needs_attention')throw Error('Provisioning failed');await wait(50)}
      const workspace=await client.getWorkspace(job.workspace_id),session=await client.createSession('Editing fixture',workspace.workspace_id);
      await chats.openNodeSession({kind:'node-session',registrationId:node.id,nodeId:node.expectedNodeId,sessionId:session.session_id,title:session.title});await chats.revealSidebar({focus:false});await until(()=>document.querySelector('.abele-node-chat__title')?.textContent==='Editing fixture' && chats.getNodeSession(chats.activeTabId.value)?.workspaceId.value);
      chats.getNodeSession(chats.activeTabId.value).openResource('sample.txt');await until(()=>document.querySelector('.abele-node-files .cm-content'));press('Edit file');await until(()=>document.querySelector('.abele-node-files [contenteditable="true"]'));
      await enter('local draft');await until(()=>document.querySelector('.abele-node-files').textContent.includes('Unsent edit'));await close();return {registration:node.id,path:workspace.path}
      } catch(e) {for(const id of chats.tabOrder.value.filter(id=>id.startsWith('node:'+node.id+':')))chats.closeTab(id);nodes.remove(node.id);await close();throw e}
    })()`)
    registration = setup.registration
    workspacePath = setup.path
    reloadPlugin()
    evalAsync(`(async()=>{${prelude}
      await until(()=>chats.getNodeSession(chats.activeTabId.value)?.workspaceId.value && document.querySelector('.abele-node-chat__title')?.textContent==='Editing fixture');chats.getNodeSession(chats.activeTabId.value).openResource('sample.txt');await until(()=>document.querySelector('.abele-node-files [contenteditable="true"]'));
      await until(()=>document.querySelector('.abele-node-files .cm-content').textContent==='local draft');press('Save file');await until(()=>document.querySelector('.abele-node-files').textContent.includes('Saved ·'));await enter('competing draft');return true
    })()`)
    expect(readFileSync(resolve(workspacePath, 'sample.txt'), 'utf8')).toBe('local draft')
    writeFileSync(resolve(workspacePath, 'sample.txt'), 'external')
    evalAsync(`(async()=>{${prelude}press('Save file');await until(()=>document.querySelector('.abele-node-files').textContent.includes('Conflict ·'));press('Reload current version');await wait(50);await until(()=>[...document.querySelectorAll('.modal button')].some(b=>b.textContent==='Use loaded version as base for this draft'&&!b.disabled));press('Use loaded version as base for this draft');await until(()=>document.querySelector('.abele-node-files').textContent.includes('Unsent edit'));await enter('lost draft');
      const store=nodes.connection(${JSON.stringify(registration)}).store,original=store.transaction.bind(store);let dropped=false;
      store.transaction=work=>original(async state=>{const result=await work(state);if(!dropped&&Object.values(state.results).some(r=>r.result?.state==='saved'&&r.request?.params?.text==='lost draft')){dropped=true;throw Error('Dropped local receipt commit')}return result});
      press('Save file');await until(()=>document.querySelector('.abele-node-files').textContent.includes('outcome unknown'));await until(()=>dropped);await close();return true
    })()`)
    expect(readFileSync(resolve(workspacePath, 'sample.txt'), 'utf8')).toBe('lost draft')
    writeFileSync(resolve(workspacePath, 'sample.txt'), 'later external')
    reloadPlugin()
    evalAsync(`(async()=>{${prelude}
      await until(()=>chats.getNodeSession(chats.activeTabId.value)?.workspaceId.value && document.querySelector('.abele-node-chat__title')?.textContent==='Editing fixture');chats.getNodeSession(chats.activeTabId.value).openResource('sample.txt');await until(()=>[...document.querySelectorAll('.modal button')].some(b=>b.textContent==='Check save'));press('Check save');await until(()=>document.querySelector('.abele-node-files').textContent.includes('Saved ·'));await close();return true
    })()`)
    expect(readFileSync(resolve(workspacePath, 'sample.txt'), 'utf8')).toBe('later external')
  } finally {
    if (registration)
      evalRaw(
        `(()=>{[...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='Close')?.click();const chats=window.__abeleTest.ChatService.getInstance();for(const id of chats.tabOrder.value.filter(id=>id.startsWith('node:'+${JSON.stringify(registration)}+':')))chats.closeTab(id);window.__abeleTest.NodeService.getInstance().remove(${JSON.stringify(registration)});return true})()`
      )
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise<void>((r) => child!.once('exit', () => r()))
      child.kill('SIGTERM')
      await stopped
    }
    rmSync(dir, { recursive: true, force: true })
  }
}, 120000)
