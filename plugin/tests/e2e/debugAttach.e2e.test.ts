// Attaching the debugger to a Node.js program already running with --inspect, from a node chat:
// the chat menu lists what waits for a debugger, the program's file opens with its margin, a
// breakpoint set there stops it, and Detach lets it run on. A program outside the chat's folder
// asks first; with nothing waiting, the list says how to start one. Needs the node to install its
// pinned JavaScript debugger, which it downloads once into this test's own state.
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { evalAsync } from './helpers/githubLive'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { evalRaw } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
targets('desktop')

const SHOTS = shotDir('abele-debug-attach')
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
function inApp<T>(script: string): T {
  try {
    return evalAsync<T>(script)
  } catch (e) {
    throw new Error(
      `node: ${daemonExit || 'running'}\n${daemonErrors.slice(-1200)}\n${e instanceof Error ? e.message : String(e)}`
    )
  }
}
const prelude = `const wait=ms=>new Promise(r=>setTimeout(r,ms)),until=async(fn,what,tries=300)=>{for(let i=0;i<tries;i++){const v=fn();if(v)return v;await wait(50)}throw Error('Did not converge: '+what+'; '+debugState())};
const api=window.__abeleTest,nodes=api.NodeService.getInstance(),chats=api.ChatService.getInstance();
const shot=async name=>{await wait(300);const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(SHOTS)}+'/'+name+'.png',image.toPNG())};
const item=title=>[...document.querySelectorAll('.menu-item')].find(i=>i.querySelector('.menu-item-title')?.textContent.trim()===title);
const press=el=>{el.click()};
const rows=()=>[...document.querySelectorAll('.modal-container .prompt .suggestion-item')].map(r=>({el:r,title:r.querySelector('.suggestion-title')?.textContent.trim()??'',note:r.querySelector('.suggestion-note')?.textContent.trim()??'',kind:r.querySelector('.abele-node-suggestion__kind')?.getAttribute('aria-label')??''}));
const marginAt=line=>{const sel='button.abele-debug-source__point[aria-label^="Stop at line '+line+' "]';return document.querySelector('.workspace-leaf.mod-active '+sel)??[...document.querySelectorAll(sel)].find(b=>b.offsetParent)};
const debugState=()=>{const b=api.DebuggerService.instance.active.value,c=b?.controller,n=c?.snapshot;return JSON.stringify({notices:[...document.querySelectorAll('.notice')].map(n=>n.textContent),status:c?.session.status,error:c?.error,lifecycle:n?.lifecycle,execution:n?.execution,owner:n?.target.process_ownership,identity:n?.target.build_identity,bps:n?.breakpoints?.map(x=>[x.source_id,x.line,x.status])})};
const statusLabel=()=>document.querySelector('.abele-debug-panel__program [role="status"]')?.getAttribute('aria-label')??'';
const openPicker=async()=>{
  document.querySelector('.abele-node-chat [aria-label="Node session menu"]').click();
  press(await until(()=>item('Attach to a running program'),'Attach in the menu'));
  await until(()=>document.querySelector('.modal-container .prompt'),'picker open');
};
const closePicker=()=>{const m=document.querySelector('.modal-container .prompt');if(m)document.querySelector('.modal-container .modal-bg')?.click()};`

let daemon: ChildProcess | undefined
let dir = ''
let repo = ''
let other = ''
let port = 0
let token = ''
let registration = ''
let chatSession = ''
let daemonErrors = ''
let daemonExit = ''
const programs: { child: ChildProcess; output: string }[] = []

const SERVE = [
  'let ticks = 0',
  'function tick() {',
  '  ticks += 1',
  "  if (ticks % 10 === 0) console.log('tick ' + ticks)",
  '}',
  'setInterval(tick, 50)',
  '',
].join('\n')

/** Starts `script` in `cwd` with its inspector on loopback and resolves once it waits for one. */
async function program(cwd: string, script: string) {
  const child = spawn(process.execPath, ['--inspect=127.0.0.1:0', script], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const entry = { child, output: '' }
  programs.push(entry)
  child.stdout!.on('data', (b) => (entry.output += b))
  child.stderr!.on('data', (b) => (entry.output += b))
  for (let i = 0; !/Debugger listening on/.test(entry.output); i++) {
    if (i > 250 || child.exitCode !== null) throw Error('program did not start: ' + entry.output)
    await wait(20)
  }
  return entry
}
const ticks = (entry: { output: string }) =>
  Number([...entry.output.matchAll(/tick (\d+)/g)].at(-1)?.[1] ?? 0)
async function stopPrograms() {
  for (const p of programs.splice(0))
    if (p.child.exitCode === null && p.child.signalCode === null) {
      const gone = new Promise<void>((r) => p.child.once('exit', () => r()))
      p.child.kill('SIGKILL')
      await gone
    }
}

/** Registers the node, its folder and a chat in the app; a phone run starts after a reload, so again. */
function openChat() {
  const opened = evalAsync<{ registration: string; session: string }>(`(async()=>{${prelude}
    const existing=nodes.nodes.value.find(n=>n.label==='Attach fixture');if(existing)nodes.remove(existing.id);
    const node=await nodes.add('Attach fixture','http://127.0.0.1:${port}',${JSON.stringify(token)}),client=nodes.connection(node.id).client;
    const project=await client.registerProject(${JSON.stringify(repo)},'trusted');
    const workspaces=await client.listWorkspaces(project.project_id),workspace=(workspaces.items??workspaces)[0];
    await client.nodePath.execution({project_id:project.project_id,target:{kind:'workspace',workspace_id:workspace.workspace_id},enabled:true},crypto.randomUUID());
    const s=await client.nodePath.createSession({title:'Attach fixture',provider:'fake',target:{kind:'workspace',workspace_id:workspace.workspace_id}},crypto.randomUUID());
    await chats.openNodeSession({kind:'node-session',registrationId:node.id,nodeId:node.expectedNodeId,sessionId:s.session_id,title:s.title});
    await chats.revealSidebar({focus:false});
    await until(()=>document.querySelector('.abele-node-chat__title')?.textContent==='Attach fixture','chat open');
    return {registration:node.id,session:s.session_id}
  })()`)
  registration = opened.registration
  chatSession = opened.session
}

beforeAll(async () => {
  const cli = process.env.ABELE_NODE_CLI
  if (!cli) throw new Error('Set ABELE_NODE_CLI to the built daemon CLI')
  mkdirSync('../.scratch', { recursive: true })
  dir = realpathSync(mkdtempSync(resolve('../.scratch/debug-attach-')))
  repo = resolve(dir, 'sample-app')
  other = resolve(dir, 'other-tool')
  const state = resolve(dir, 'state')
  // Written well before the programs start, as a program's files are: their lines are trusted.
  const before = new Date(Date.now() - 60000)
  for (const [path, text] of Object.entries({
    [join(repo, 'src/serve.js')]: SERVE,
    [join(other, 'tool.js')]: SERVE,
  })) {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, text)
    utimesSync(path, before, before)
  }
  const fake = resolve('tests/fixtures/nodeClaude.mjs')
  const created = spawnSync(
    process.execPath,
    [cli, 'token', 'create', 'fixture', '--state-dir', state, '--claude-path', fake, '--json'],
    { encoding: 'utf8' }
  )
  expect(created.status, created.stderr).toBe(0)
  token = (JSON.parse(created.stdout) as { token: string }).token
  const installed = spawnSync(
    process.execPath,
    [cli, 'debugger', 'install', 'js', '--state-dir', state, '--json'],
    { encoding: 'utf8', timeout: 60000 }
  )
  expect(installed.status, installed.stderr).toBe(0)
  daemon = spawn(
    process.execPath,
    [
      cli,
      'start',
      '--state-dir',
      state,
      '--port',
      '0',
      '--claude-path',
      fake,
      '--debugger',
      '--json',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let output = ''
  let errors = ''
  daemon.stdout!.on('data', (b) => {
    output += b
    daemonErrors = (daemonErrors + b).slice(-2000)
  })
  daemon.stderr!.on('data', (b) => {
    errors += b
    daemonErrors = (daemonErrors + b).slice(-2000)
  })
  daemon.on('exit', (code, signal) => (daemonExit = `daemon exited ${code ?? signal}`))
  for (let i = 0; !output.includes('"listening"'); i++) {
    if (i > 500 || daemon.exitCode !== null) throw Error(errors || 'Daemon startup deadline')
    await wait(20)
  }
  port = (
    JSON.parse(output.split('\n').find((l) => l.includes('"listening"'))!) as { port: number }
  ).port
  openChat()
}, 120000)

afterEach(async () => {
  evalRaw(
    `(()=>{const m=document.querySelector('.modal-container .modal-bg');if(m)m.click();return true})()`
  )
  await stopPrograms()
})

afterAll(async () => {
  evalRaw(
    `(()=>{const api=window.__abeleTest,chats=api.ChatService.getInstance();for(const t of ['abele-node-file','abele-debug-view'])for(const l of app.workspace.getLeavesOfType(t))l.detach();for(const id of chats.tabOrder.value.filter(id=>id.startsWith('node:'+${JSON.stringify(registration)}+':')))chats.closeTab(id);if(${JSON.stringify(registration)})api.NodeService.getInstance().remove(${JSON.stringify(registration)});return true})()`
  )
  await stopPrograms()
  if (daemon && daemon.exitCode === null && daemon.signalCode === null) {
    const stopped = new Promise<void>((r) => daemon!.once('exit', () => r()))
    daemon.kill('SIGTERM')
    await stopped
  }
  if (dir) rmSync(dir, { recursive: true, force: true })
})

it('attaches to a program of the chat’s folder, stops it at a breakpoint and lets it run on after Detach', async () => {
  const mine = await program(repo, 'src/serve.js')
  await program(other, 'tool.js')
  const seen = inApp<{
    offered: { title: string; note: string; kind: string }[]
    detach: string
    paused: string
    after: string
    state: string
  }>(`(async()=>{${prelude}
    document.querySelector('.abele-node-chat [aria-label="Node session menu"]').click();
    await until(()=>item('Attach to a running program'),'Attach in the menu');
    await shot('2026-10-16-debug-attach-menu-desktop');
    press(item('Attach to a running program'));
    await until(()=>rows().some(r=>r.title.includes('src/serve.js'))&&rows().some(r=>r.title.includes('tool.js')),'both programs listed');
    const offered=rows().filter(r=>/serve\\.js|tool\\.js/.test(r.title)).map(({el,...r})=>r);
    await shot('2026-10-16-debug-attach-picker-desktop');
    press(rows().find(r=>r.title.includes('src/serve.js')).el);
    const detachButton=await until(()=>document.querySelector('.abele-debug-panel [aria-label^="Detach"]'),'Detach in the panel',600);
    const mark=await until(()=>marginAt(3),'margin of line 3',600);
    press(mark);
    await until(()=>api.DebuggerService.instance.active.value?.controller.session.status==='paused','stopped at the breakpoint',600);
    const paused=statusLabel();
    await shot('2026-10-16-debug-attach-attached-desktop');
    press(detachButton);
    await until(()=>api.DebuggerService.instance.active.value?.controller.session.status==='exited','detached',600);
    const after=statusLabel();
    await shot('2026-10-16-debug-attach-detached-desktop');
    return {offered,detach:detachButton.getAttribute('aria-label'),paused,after,state:debugState()}
  })()`)
  expect(seen.offered.find((r) => r.title.includes('src/serve.js'))).toMatchObject({
    note: expect.stringMatching(/^This chat's folder · pid \d+ · port \d+$/),
    kind: "Runs from this chat's folder",
  })
  expect(seen.offered.find((r) => r.title.includes('tool.js'))!.kind).toContain('outside this chat')
  expect(seen.detach).toBe('Detach (Shift+F5): the program runs on')
  expect(seen.paused, seen.state).toMatch(/^Paused/)
  expect(seen.after, seen.state).toBe('Detached · The program runs on')
  // The program goes on by itself, as it was before the debugger came.
  const held = ticks(mine)
  for (let i = 0; i < 100 && ticks(mine) < held + 20; i++) await wait(50)
  expect(ticks(mine)).toBeGreaterThanOrEqual(held + 20)
  expect(mine.child.exitCode).toBeNull()
}, 180000)

it('asks before attaching to a program outside the chat’s folder, and attaches nothing on Cancel', async () => {
  await program(other, 'tool.js')
  const seen = inApp<{ title: string; message: string; sessions: number; after: number }>(
    `(async()=>{${prelude}
    const sessions=async()=>(await nodes.connection(${JSON.stringify(registration)}).client.request('debugger.v1.sessions',{conversation_id:${JSON.stringify(chatSession)}})).length;
    const before=await sessions();
    await openPicker();
    await until(()=>rows().some(r=>r.title.includes('tool.js')),'program listed');
    press(rows().find(r=>r.title.includes('tool.js')).el);
    const modal=await until(()=>[...document.querySelectorAll('.modal-container .modal')].find(m=>m.textContent.includes('outside this folder')),'confirmation');
    await shot('2026-10-16-debug-attach-confirm-desktop');
    const title=modal.querySelector('.modal-title')?.textContent.trim()??'',message=modal.querySelector('.abele-confirm__message')?.textContent.trim()??'';
    press([...modal.querySelectorAll('button')].find(b=>b.textContent.trim()==='Cancel'));
    await wait(1000);
    return {title,message,sessions:before,after:await sessions()}
  })()`
  )
  expect(seen.title).toBe('Attach to a program outside this folder?')
  expect(seen.message).toContain('Detaching later leaves it running')
  expect(seen.after).toBe(seen.sessions)
}, 120000)

it('says how to start a program that waits for a debugger when none does', () => {
  const seen = inApp<{ empty: string; rows: string[] }>(`(async()=>{${prelude}
    await openPicker();
    await wait(500);
    const empty=document.querySelector('.modal-container .prompt .suggestion-empty')?.textContent.trim()??'';
    await shot('2026-10-16-debug-attach-empty-desktop');
    return {empty,rows:rows().map(r=>r.title)}
  })()`)
  // Other programs of this machine may wait too; none of this test's does.
  expect(seen.rows.filter((t) => /serve\.js|tool\.js/.test(t))).toEqual([])
  if (!seen.rows.length) expect(seen.empty).toContain('node --inspect app.js')
})

it('on a phone: the menu, the picker, the attached panel and the empty list fit the screen', async () => {
  await withEmulatedPhone(async () => {
    openChat()
    await program(repo, 'src/serve.js')
    const seen = inApp<{ offered: string[]; detach: string; overflow: number }>(
      `(async()=>{${prelude}
      try{
      document.querySelector('.abele-node-chat [aria-label="Node session menu"]').click();
      await until(()=>item('Attach to a running program'),'Attach in the menu');
      await shot('2026-10-16-debug-attach-menu-phone');
      press(item('Attach to a running program'));
      await until(()=>rows().some(r=>r.title.includes('src/serve.js')),'program listed');
      const offered=rows().map(r=>r.title);
      await shot('2026-10-16-debug-attach-picker-phone');
      press(rows().find(r=>r.title.includes('src/serve.js')).el);
      const detachButton=await until(()=>document.querySelector('.abele-debug-panel [aria-label^="Detach"]'),'Detach in the panel',600);
      const mark=await until(()=>marginAt(3),'margin of line 3',600);
      press(mark);
      await until(()=>api.DebuggerService.instance.active.value?.controller.session.status==='paused','stopped at the breakpoint',600);
      const leaf=app.workspace.getLeavesOfType('abele-debug-view')[0];await app.workspace.revealLeaf(leaf);
      let last='';await until(()=>{const r=document.querySelector('.abele-debug-panel').getBoundingClientRect(),now=r.left+','+r.width;const still=now===last&&r.left>=0&&r.right<=innerWidth+1&&r.width>200;last=now;return still},'debug drawer open').catch(()=>console.debug('[debugger] the drawer did not settle before the picture'));
      await shot('2026-10-16-debug-attach-attached-phone');
      const panel=document.querySelector('.abele-debug-panel'),overflow=panel.scrollWidth-panel.clientWidth;
      press(document.querySelector('.abele-debug-panel [aria-label^="Detach"]'));
      await until(()=>api.DebuggerService.instance.active.value?.controller.session.status==='exited','detached',600);
      const detach=detachButton.getAttribute('aria-label');
      return {offered,detach,overflow}
      }finally{
        for(const t of ['abele-node-file','abele-debug-view'])for(const l of app.workspace.getLeavesOfType(t))l.detach();
        await app.workspace.requestSaveLayout.run();
      }
    })()`
    )
    await stopPrograms()
    const empty = inApp<{ text: string; rows: string[] }>(`(async()=>{${prelude}
      await openPicker();
      await wait(500);
      await shot('2026-10-16-debug-attach-empty-phone');
      const text=document.querySelector('.modal-container .prompt .suggestion-empty')?.textContent.trim()??'';
      const listed=rows().map(r=>r.title);
      closePicker();
      return {text,rows:listed}
    })()`)
    expect(seen.offered.some((t) => t.includes('src/serve.js'))).toBe(true)
    expect(seen.detach).toBe('Detach (Shift+F5): the program runs on')
    expect(seen.overflow).toBeLessThanOrEqual(1)
    // Other programs of this machine may wait too; none of this test's does.
    expect(empty.rows.filter((t) => /serve\.js|tool\.js/.test(t))).toEqual([])
    if (!empty.rows.length) expect(empty.text).toContain('node --inspect app.js')
  })
}, 240000)
