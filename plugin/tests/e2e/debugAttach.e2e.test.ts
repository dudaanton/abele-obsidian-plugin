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
import {
  cleanupDebugAttachViews,
  nodeFailureMessage,
  parseDebugAttachResult,
} from './helpers/debugAttachLifecycle'
targets('desktop')

const SHOTS = shotDir('abele-debug-attach')
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
function inApp<T>(script: string): T {
  try {
    return parseDebugAttachResult<T>(evalRaw(script))
  } catch (e) {
    throw new Error(nodeFailureMessage(e, daemonExit || 'running', daemonErrors))
  }
}
function cleanupViews() {
  evalAsync(
    `(async()=>{await (${cleanupDebugAttachViews.toString()})(window.__abeleTest,app.workspace);return true})()`
  )
}
function onPhone<T>(probe: () => Promise<T>): Promise<T> {
  return withEmulatedPhone(async () => {
    try {
      return await probe()
    } finally {
      cleanupViews()
    }
  })
}
const prelude = `const checkpoints=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms)),until=async(fn,what,tries=300)=>{for(let i=0;i<tries;i++){const v=fn();if(v)return v;await wait(50)}const state=debugState();require('fs').writeFileSync(${JSON.stringify(SHOTS)}+'/convergence-'+Date.now()+'.json',JSON.stringify({what,state:JSON.parse(state),checkpoints},null,2));throw Error('Did not converge: '+what+'; '+state)};
const api=window.__abeleTest,nodes=api.NodeService.getInstance(),chats=api.ChatService.getInstance();
const checkpoint=(stage,binding=api.DebuggerService.instance.active.value)=>{
  const c=binding?.controller,s=c?.snapshot;
  const data={stage,id:binding?.sessionId,status:c?.session.status,error:c?.error,snapshot:s,known:c?.knownBreakpoints(),forgotten:[...(binding?.forgottenBreakpoints??[])],records:binding?.trace?.points};
  const serialized=JSON.stringify(data);if(checkpoints.at(-1)?.serialized===serialized)return;
  checkpoints.push({at:Date.now(),serialized,data:JSON.parse(serialized)});if(checkpoints.length>100)checkpoints.shift();
};
const shot=async name=>{await wait(300);const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(SHOTS)}+'/'+name+'.png',image.toPNG())};
const item=title=>[...document.querySelectorAll('.menu-item')].find(i=>i.querySelector('.menu-item-title')?.textContent.trim()===title);
const press=el=>{el.click()};
const rows=()=>[...document.querySelectorAll('.modal-container .prompt .suggestion-item')].map(r=>({el:r,title:r.querySelector('.suggestion-title')?.textContent.trim()??'',note:r.querySelector('.suggestion-note')?.textContent.trim()??'',kind:r.querySelector('.abele-node-suggestion__kind')?.getAttribute('aria-label')??''}));
const marginAt=line=>{const sel='button.abele-debug-source__point[aria-label^="Stop at line '+line+' "]';return document.querySelector('.workspace-leaf.mod-active '+sel)??[...document.querySelectorAll(sel)].find(b=>b.offsetParent)};
const debugState=()=>{const service=api.DebuggerService.instance,b=service.active.value,c=b?.controller,n=c?.snapshot,reg=nodes.nodes.value.find(n=>n.label==='Attach fixture')?.id,saved=app.loadLocalStorage('abele-debug-selection');return JSON.stringify({id:b?.sessionId,peers:b?service.peers(b).map(b=>[b.sessionId,b.controller.session.status]):[],options:[...document.querySelectorAll('select[aria-label="Select a debug session"]')].map(s=>[s.value,[...s.options].map(o=>o.value)]),saved:[saved?.sessionId,saved?.sessions],known:[...(service.bindings?.values()??[])].filter(b=>b.registrationId===reg).map(b=>({id:b.sessionId,wanted:b.observationId,state:b.controller.session.status,error:b.controller.error,program:b.controller.session.program})),notices:[...document.querySelectorAll('.notice')].map(n=>n.textContent),status:c?.session.status,error:c?.error,lifecycle:n?.lifecycle,execution:n?.execution,owner:n?.target.process_ownership,identity:n?.target.build_identity,bps:n?.breakpoints?.map(x=>[x.source_id,x.line,x.status])})};
const statusLabel=()=>document.querySelector('.abele-debug-panel__program [role="status"]')?.getAttribute('aria-label')??'';
const openPicker=async()=>{
  document.querySelector('.abele-node-chat [aria-label="More chat actions"]').click();
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
    await until(()=>document.querySelector('.abele-node-chat')?.dataset.sessionTitle==='Attach fixture','chat open');
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
  cleanupViews()
  await stopPrograms()
})

afterAll(async () => {
  cleanupViews()
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

it('retains independent folder sessions across switching and reload on desktop and phone', async () => {
  await program(repo, 'src/serve.js')
  await program(repo, 'src/serve.js')
  const ids = inApp<string[]>(`(async()=>{${prelude}
    const node=nodes.nodes.value.find(n=>n.id===${JSON.stringify(registration)}),connection=nodes.connection(node.id),client=connection.client;
    const chat=await client.nodePath.sessionWorktreeGet({session_id:${JSON.stringify(chatSession)},include_incarnation:true});
    const target={nodeId:node.expectedNodeId,registrationId:node.id,projectId:chat.project_id,kind:chat.target.kind,id:chat.target.workspace_id};
    const owner={kind:'folder-debug',target,connection},folder={kind:'workspace',workspace_id:target.id};
    const programs=(await client.request('debugger.v1.programs',{folder})).programs.filter(p=>p.in_chat_folder);
    if(programs.length!==2)throw Error('Expected two sample processes: '+JSON.stringify(programs));
    const service=api.DebuggerService.instance,ids=[];
    for(const p of programs){
      const started=await client.request('debugger.v1.attachProgram',{operation_id:crypto.randomUUID(),folder,pid:p.pid,port:p.port,sources:['src/serve.js'],outside_folder:false});
      const snapshot=(await client.debugger.status(started.debug_session_id)).snapshot;
      service.trackFolder(owner,started.debug_session_id,target);
      const binding=service.binding(owner,started.debug_session_id);
      for(const s of started.sources)service.registerSource(node.id,binding.conversationId,s.source_id,s.path,started.debug_session_id,snapshot.incarnation,target);
      service.select(binding);await binding.open(started.debug_session_id);ids.push(started.debug_session_id);
    }
    const leaf=app.workspace.getLeavesOfType('abele-debug-view')[0]??app.workspace.getLeftLeaf(false);
    await leaf.setViewState({type:'abele-debug-view',active:true});await app.workspace.revealLeaf(leaf);
    const switcher=await until(()=>document.querySelector('select[aria-label="Select a debug session"] option[value="'+ids[0]+'"]')?.parentElement,'first session in switcher');switcher.value=ids[0];switcher.dispatchEvent(new Event('change',{bubbles:true}));
    await until(()=>service.active.value?.sessionId===ids[0]&&service.active.value.controller.session.status==='running','selected running session');
    const pause=await until(()=>document.querySelector('.abele-debug-panel [aria-label^="Pause"]'),'Pause control');pause.click();
    await until(()=>service.active.value.controller.session.status==='paused','selected session paused');
    if(service.peers(service.active.value).length!==2)throw Error('Missing or duplicate session: '+JSON.stringify(service.peers(service.active.value).map(b=>b.controller.snapshot.target)));
    if(!document.querySelector('.abele-debug-panel__state')?.textContent.trim())throw Error('Pause reason hidden');
    if(leaf.view.getState().sessionId!==ids[0])throw Error('Selected session missing from saved view state');
    app.workspace.requestSaveLayout();await wait(1500);await shot('folder-sessions-paused-desktop');return ids;
  })()`)
  expect(ids).toHaveLength(2)
  const phone = await onPhone(async () =>
    inApp<{ restored: boolean; overflow: number }>(`(async()=>{${prelude}
    const service=api.DebuggerService.instance,ids=${JSON.stringify(ids)};
    await until(()=>service.active.value?.sessionId===ids[0]&&service.active.value.controller.current,'restored selected session; saved='+JSON.stringify(app.workspace.getLeavesOfType('abele-debug-view').map(l=>l.getViewState())),600);
    const leaf=app.workspace.getLeavesOfType('abele-debug-view')[0];await app.workspace.revealLeaf(leaf);
    const split=leaf.getRoot()===app.workspace.rightSplit?app.workspace.rightSplit:app.workspace.leftSplit;
    split.collapse();await wait(300);split.expand();await wait(700);
    await until(()=>ids.every(id=>document.querySelector('select[aria-label="Select a debug session"] option[value="'+id+'"]')),'restored session switcher',600);
    await shot('folder-sessions-paused-phone');
    const panel=document.querySelector('.abele-debug-panel');
    const result={restored:service.active.value.controller.session.status==='paused',overflow:panel.scrollWidth-panel.clientWidth};
    for(const leaf of app.workspace.getLeavesOfType('abele-node-file'))leaf.detach();
    app.commands.executeCommandById('abele:node-folder-debug-attach');
    await until(()=>document.querySelector('.modal-container .prompt'),'attach command before the Node view');
    await shot('folder-attach-command-phone');closePicker();
    return result;
  })()`)
  )
  expect(phone.restored).toBe(true)
  expect(phone.overflow).toBeLessThanOrEqual(1)
}, 180000)

it('attaches to a program of the chat’s folder, stops it at a breakpoint and lets it run on after Detach', async () => {
  openChat()
  const mine = await program(repo, 'src/serve.js')
  await program(other, 'tool.js')
  const seen = inApp<{
    offered: { title: string; note: string; kind: string }[]
    detach: string
    paused: string
    after: string
    state: string
  }>(`(async()=>{${prelude}
    document.querySelector('.abele-node-chat [aria-label="More chat actions"]').click();
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
    const active=api.DebuggerService.instance.active.value.controller;
    const sourceId=active.snapshot.breakpoints[0].source_id;
    const marked=document.querySelector('.workspace-leaf.mod-active button.abele-debug-source__point[aria-label^="Stops here"]');
    if(!marked)throw Error('Missing verified gutter mark');
    press(marked);
    await until(()=>active.snapshot.breakpoints.length===0&&marginAt(3),'breakpoint removed by second click');
    await active.command('continue');
    await until(()=>active.session.status==='running','continued without breakpoint');
    const epoch=active.snapshot.stop_epoch;
    await wait(1200);
    if(active.session.status!=='running'||active.snapshot.stop_epoch!==epoch)throw Error('Removed breakpoint stopped the program');
    if(active.snapshot.breakpoints.some(b=>b.source_id===sourceId))throw Error('Breakpoint reappeared');
    press(detachButton);
    await until(()=>api.DebuggerService.instance.active.value?.controller.session.status==='exited','detached',600);
    const after=statusLabel();
    await shot('2026-10-16-debug-attach-detached-desktop');
    return {offered,detach:detachButton.getAttribute('aria-label'),paused,after,state:debugState()}
  })()`)
  expect(seen.offered.find((r) => r.title.includes('src/serve.js'))).toMatchObject({
    note: expect.stringMatching(
      /^This chat's folder · …\/debug-attach-[A-Za-z0-9]+\/sample-app · pid \d+ · port \d+$/
    ),
    kind: "Runs from this chat's folder",
  })
  expect(seen.offered.find((r) => r.title.includes('src/serve.js'))!.note).toContain(
    ` · …/${dir.split('/').at(-1)}/sample-app · `
  )
  expect(seen.offered.find((r) => r.title.includes('tool.js'))!.kind).toContain('outside this chat')
  expect(seen.detach).toBe('Detach (Shift+F5): the program runs on')
  expect(seen.paused, seen.state).toMatch(/^Paused/)
  // Detach confirms separation; its snapshot does not observe the process's later liveness.
  expect(seen.after, seen.state).toBe('Detached')
  // The program goes on by itself, as it was before the debugger came.
  const held = ticks(mine)
  for (let i = 0; i < 100 && ticks(mine) < held + 20; i++) await wait(50)
  expect(ticks(mine)).toBeGreaterThanOrEqual(held + 20)
  expect(mine.child.exitCode).toBeNull()
}, 180000)

async function sessionLifecycle(phone: boolean) {
  openChat()
  await program(repo, 'src/serve.js')
  const name = phone ? 'session-lifecycle-phone' : 'session-lifecycle-desktop'
  const result = inApp<{ attaches: number; points: number }>(`(async()=>{${prelude}
    await openPicker();press((await until(()=>rows().find(r=>r.title.includes('src/serve.js')),'sample program')).el);
    const service=api.DebuggerService.instance;
    await until(()=>service.active.value?.controller.session.status==='running','attached running',600);
    let binding=service.active.value;
    const mark=await until(()=>marginAt(3),'source margin');mark.click();
    await until(()=>binding.controller.session.status==='paused','breakpoint stop',600);
    let source=binding.controller.knownBreakpoints()[0].sourceId;
    // Remove the plain breakpoint while the stop is still stable, before the failed evaluate.
    await binding.controller.removeAllBreakpoints();
    await until(()=>!binding.controller.knownBreakpoints().length,'watch breakpoint removed');
    await binding.controller.watch('missingSample.field');
    await until(()=>binding.controller.session.watches[0]?.error,'watch error');
    // Read the authoritative state again: evaluating a failing watch must not hide a real stop.
    const actual=(await binding.connection.client.debugger.status(binding.sessionId)).snapshot;
    binding.controller.observe({observation:'current',snapshot:actual});
    if(actual.execution==='stopped') {
      await until(()=>binding.controller.session.frames.length&&binding.controller.session.variables.length,'frames and scopes after failed watch');
      const go=document.querySelector('[aria-label="Continue (F5)"]');
      if(!go||go.hasAttribute('disabled'))throw Error('A real stop has no Continue');
    }
    const debugLeaf=app.workspace.getLeavesOfType('abele-debug-view')[0],debugSplit=debugLeaf.getRoot()===app.workspace.leftSplit?app.workspace.leftSplit:app.workspace.rightSplit;await app.workspace.revealLeaf(debugLeaf);
    if(${phone}){debugSplit.collapse();await wait(300);debugSplit.expand();await wait(700)}
    document.querySelector('.abele-debug-panel__value_error')?.scrollIntoView({block:'center'});
    await shot(${JSON.stringify(name + '-watch-error')});
    await binding.controller.unwatch('missingSample.field');
    // Older nodes can report Running while a failed evaluate left the adapter frozen. Detach
    // releases that stop; all point-removal assertions below start from a fresh observation.
    const watchedSession=binding.sessionId;
    await binding.controller.command('stop');
    document.querySelector('[aria-label="Attach to a running program"]').click();
    const freshProgram=await until(()=>rows().find(r=>r.title.includes('src/serve.js')),'clean attach picker');freshProgram.el.click();
    await until(()=>service.active.value?.sessionId!==watchedSession&&service.active.value?.trace&&service.active.value.controller.session.status==='running'&&(()=>{const pause=document.querySelector('.abele-debug-panel [aria-label^="Pause"]');return pause&&!pause.hasAttribute('disabled')})(),'clean session after failed watch',600);
    binding=service.active.value;
    source=await until(()=>binding.controller.mappedSource('src/serve.js')?.[0],'clean source mapping');
    if(document.querySelector('.abele-debug-source__line_here'))throw Error('Stop line survived Continue');
    if(${phone}){debugSplit.collapse();await wait(500)}
    await shot(${JSON.stringify(name + '-continued')});
    for(const line of [3,4])await binding.trace.savePoint(source,line,{take:['ticks']});
    await app.workspace.revealLeaf(debugLeaf);
    if(${phone}){debugSplit.collapse();await wait(300);debugSplit.expand();await wait(700)}
    checkpoint('before-recording-detach',binding);
    await binding.controller.command('stop');
    await until(()=>binding.controller.session.status==='exited','detached');
    checkpoint('recording-detached',binding);
    if(document.querySelector('.abele-debug-source__line_here'))throw Error('Stop line survived Detach');
    if(document.querySelector('.abele-debug-panel__group .abele-status-dot_red'))throw Error('Detached session still recording');
    for(const line of [3,4]){
      const row=await until(()=>[...document.querySelectorAll('.abele-debug-panel .tree-item-self')].find(r=>r.querySelector('.abele-tree-item__text')?.textContent.trim()==='serve.js:'+line),'ended point row');
      const remove=row.querySelector('[aria-label="Remove"]');if(remove.hasAttribute('disabled'))throw Error('Ended removal disabled');remove.click();
      await until(()=>!binding.trace.breakpoints().some(p=>p.line===line&&!binding.forgottenBreakpoints.has(binding.controller.knownBreakpoints().find(k=>k.line===line)?.id)),'point removed');
    }
    await shot(${JSON.stringify(name + '-detached')});
    checkpoint('ended-points-removed',binding);
    let attaches=1;
    for(let i=0;i<4;i++){
      const old=binding.sessionId;
      const reattach=await until(()=>document.querySelector('[aria-label="Attach to a running program"]'),'reattach control');reattach.click();
      // A chat-owned session uses the picker; a folder-owned session can use its retained recipe.
      await until(()=>service.active.value?.sessionId!==old||rows().some(r=>r.title.includes('src/serve.js')),'reattach started',600);
      const offered=rows().find(r=>r.title.includes('src/serve.js'));if(offered)offered.el.click();
      await until(()=>{checkpoint('reattach-'+i);return service.active.value?.sessionId!==old&&service.active.value?.controller.session.status==='running'&&!service.active.value.controller.knownBreakpoints().length&&(()=>{const pause=document.querySelector('.abele-debug-panel [aria-label^="Pause"]');return pause&&!pause.hasAttribute('disabled')})()},'new session prepared with removed points',600);
      binding=service.active.value;attaches++;
      await wait(700);
      if(binding.controller.session.status!=='running'||binding.controller.knownBreakpoints().length){require('fs').writeFileSync(${JSON.stringify(SHOTS)}+'/'+${JSON.stringify(name)}+'-reattach-failure.json',debugState());throw Error('Removed point stopped the next attach: '+debugState())}
      const texts=[...document.querySelectorAll('.abele-debug-panel .abele-tree-item__text')].map(e=>e.textContent);
      if(texts.some(t=>/^s[0-9]+:[0-9]+$/.test(t)))throw Error('Raw source id in point row');
      await shot(${JSON.stringify(name + '-reattached')}+'-'+i);
      if(i<3)await binding.controller.command('stop');
    }
    const points=binding.controller.knownBreakpoints().length;
    await binding.controller.command('stop');return {attaches,points};
  })()`)
  expect(result).toEqual({ attaches: 5, points: 0 })
}

it('keeps watch errors, ended point removal and five reattaches consistent on desktop', async () => {
  await sessionLifecycle(false)
}, 240000)
it('keeps watch errors, ended point removal and five reattaches consistent on phone', async () => {
  await onPhone(() => sessionLifecycle(true))
}, 240000)

it('asks before attaching to a program outside the chat’s folder, and attaches nothing on Cancel', async () => {
  openChat()
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
  openChat()
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
  await onPhone(async () => {
    openChat()
    await program(repo, 'src/serve.js')
    const seen = inApp<{ offered: string[]; detach: string; overflow: number }>(
      `(async()=>{${prelude}
      try{
      document.querySelector('.abele-node-chat [aria-label="More chat actions"]').click();
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
      // As the plugin's own sidebar reveal does: a phone's drawer can count as open with nothing of
      // it on screen, and is closed and opened again then.
      const rs=app.workspace.rightSplit;await wait(500);if(!rs.containerEl.offsetWidth){rs.collapse();await wait(500);rs.expand()}
      // The drawer slides in: the picture waits until the panel has stood still inside the screen
      // for several looks in a row.
      let last='',still=0;await until(()=>{const r=document.querySelector('.abele-debug-panel').getBoundingClientRect(),now=r.left+','+r.width;still=now===last&&r.left>=0&&r.right<=innerWidth+1&&r.width>200?still+1:0;last=now;return still>=6},'debug drawer open',200).catch(()=>{throw Error('drawer: '+JSON.stringify({inner:innerWidth,leaves:app.workspace.getLeavesOfType('abele-debug-view').map(l=>({root:l.getRoot()===app.workspace.rightSplit?'right':l.getRoot()===app.workspace.leftSplit?'left':'main',shown:!!l.containerEl.offsetParent})),panels:[...document.querySelectorAll('.abele-debug-panel')].map(p=>{const r=p.getBoundingClientRect();return [Math.round(r.left),Math.round(r.width)]}),right:document.querySelector('.workspace-drawer.mod-right')?.className,rightRect:(()=>{const r=document.querySelector('.workspace-drawer.mod-right')?.getBoundingClientRect();return r&&[Math.round(r.left),Math.round(r.width)]})(),collapsed:app.workspace.rightSplit.collapsed}))});
      await wait(500);
      await shot('2026-10-16-debug-attach-attached-phone');
      const panel=document.querySelector('.abele-debug-panel'),overflow=panel.scrollWidth-panel.clientWidth;
      press(document.querySelector('.abele-debug-panel [aria-label^="Detach"]'));
      await until(()=>api.DebuggerService.instance.active.value?.controller.session.status==='exited','detached',600);
      const detach=detachButton.getAttribute('aria-label');
      return {offered,detach,overflow}
      }finally{
        api.DebuggerService.instance.destroy();
        for(const t of ['abele-node-file','abele-debug-view','abele-trace-run','abele-trace-value'])for(const l of app.workspace.getLeavesOfType(t))l.detach();
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
