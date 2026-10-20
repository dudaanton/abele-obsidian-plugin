// A disposable program, the visible debugger controls, and the actual recorded-data agent tool.
// Needs the node's pinned JavaScript debugger; never starts a live agent provider.
import { afterAll, beforeAll, expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { evalAsync } from './helpers/githubLive'
import { evalLong, evalRaw } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import type { AgentToolResult } from '@/ai/client'
targets('desktop')

const SHOTS = shotDir('abele-debug-journey')
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function inAppLong<T>(script: string): Promise<T> {
  try {
    return JSON.parse(await evalLong(script, 150_000)) as T
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nnode: ${daemonExit || 'running'}\n${daemonErrors.slice(-1200)}`
    )
  }
}
/** What the app answered, or why not, with what the node said on its way out. */
function inApp<T>(script: string): T {
  try {
    const raw = evalRaw(script, 120_000)
    try {
      return JSON.parse(raw) as T
    } catch {
      throw new Error(`Not JSON from the app: ${raw.slice(0, 12000)}`)
    }
  } catch (e) {
    throw new Error(
      `node: ${daemonExit || 'running'}\n${daemonErrors.slice(-1200)}\n${e instanceof Error ? e.message : String(e)}`
    )
  }
}
const prelude = `const wait=ms=>new Promise(r=>setTimeout(r,ms)),until=async(fn,what,tries=300)=>{for(let i=0;i<tries;i++){const v=fn();if(v)return v;await wait(50)}await shot('journey-failure-'+what.replace(/[^a-z0-9]+/gi,'-'));throw Error('Did not converge: '+what+'; '+debugState0()+'; '+debugState()+'; events: '+await debugEvents())};
const api=window.__abeleTest,nodes=api.NodeService.getInstance(),chats=api.ChatService.getInstance();
const shot=async name=>{await wait(300);const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(SHOTS)}+'/'+name+'.png',image.toPNG())};
const item=title=>[...document.querySelectorAll('.menu-item')].find(i=>i.querySelector('.menu-item-title')?.textContent.trim()===title);
const press=el=>{el.click()};
const marginAt=(line,root)=>{const sel='button.abele-debug-source__point[aria-label^="Stop at line '+line+' "]';if(root)return root.querySelector(sel);return document.querySelector('.workspace-leaf.mod-active '+sel)??[...document.querySelectorAll(sel)].find(b=>b.offsetParent)};
const recordPoint=async (line,takes,root)=>{
  const mark=await until(()=>marginAt(line,root),'margin of line '+line).catch(()=>{throw Error('no margin on line '+line+': '+JSON.stringify(app.workspace.getLeavesOfType('abele-node-file').map(l=>{const st=l.view.getState();return [st.path,!!st.debug,st.debug?.sourceId,l.containerEl.querySelectorAll('button.abele-debug-source__point').length]}))+' '+debugState())});
  mark.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:40,clientY:200}));
  press(await until(()=>item('Add record point'),'Add record point'));
  const input=await until(()=>document.querySelector('.abele-trace-point .multi-select-input'),'point editor');
  for(const t of takes){
    const offered=document.querySelector('.abele-trace-point [aria-label="Take '+t+'"]');
    if(offered){press(offered);await wait(100);continue}
    input.focus();input.value=t;input.dispatchEvent(new Event('input',{bubbles:true}));await wait(100);
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));await wait(100);
  }
  const pills=()=>[...document.querySelectorAll('.abele-trace-point .multi-select-pill-content')].map(p=>p.textContent.trim());
  // Says whether the editor was rebuilt under the typing (its input no longer in the page) or kept.
  await until(()=>takes.every(t=>pills().includes(t)),'takes listed').catch(()=>{throw Error('takes not listed: '+JSON.stringify({pills:pills(),editors:document.querySelectorAll('.abele-trace-point').length,inputKept:input.isConnected,typed:input.value,offered:[...document.querySelectorAll('.abele-trace-point__offer')].map(b=>b.textContent.trim())})+' '+debugState())});
  press(document.querySelector('.abele-trace-point [aria-label="Keep (Enter)"]'));
  // The first record point of a project asks once where its runs go: the offered folder.
  for(let i=0;i<40;i++){const keep=[...document.querySelectorAll('.modal-container .modal button')].find(b=>b.textContent.trim()==='Keep them here');if(keep){press(keep);break}if(document.querySelector('.abele-breakpoint-mark_record'))break;await wait(50)}
  await until(()=>!document.querySelector('.abele-trace-point'),'point saved');
  const said=()=>[...document.querySelectorAll('button.abele-debug-source__point')].map(b=>b.getAttribute('aria-label')).filter(l=>l&&!l.startsWith('Stop at line')).join(' | ');
  await until(()=>said().startsWith('Record point ·'),'record point confirmed: '+said(),400).catch(()=>{throw Error('record point not confirmed: '+debugState())});
};
window.__dbgLog=[];if(!console.__wrapped){const d=console.debug.bind(console);console.debug=(...a)=>{if(/^\\[(debugger|trace|Abele node)\\]/.test(String(a[0])))window.__dbgLog.push(a.map(x=>x instanceof Error?x.message+' '+(x.code??''):typeof x==='string'?x:JSON.stringify(x)?.slice(0,300)).join(' '));d(...a)};console.__wrapped=true}
const debugEvents=async()=>{const b=api.DebuggerService.instance.active.value,s=b?.controller.snapshot;if(!s)return null;try{return JSON.stringify(await b.connection.client.request('debugger.v1.replay',{cursor:{debug_session_id:s.debug_session_id,incarnation:s.incarnation,event_seq:0}}))}catch(e){return String(e)}};
const debugState=()=>JSON.stringify({log:window.__dbgLog.slice(-10),notices:[...document.querySelectorAll('.notice')].map(n=>n.textContent)})+' '+debugState0();
const debugState0=()=>{const b=api.DebuggerService.instance.active.value,c=b?.controller,n=c?.snapshot,sdk=b?.sessionId?b.connection.client.debugger.current(b.sessionId):null;return JSON.stringify({sdk:sdk&&{observation:sdk.observation,reason:sdk.reason,lifecycle:sdk.snapshot?.lifecycle,execution:sdk.snapshot?.execution},recent:window.__dbgLog.slice(-5),highlight:[...document.querySelectorAll(".abele-debug-source__line_here")].filter(e=>e.offsetParent).map(e=>e.textContent),status:c?.session.status,error:c?.error,lifecycle:n?.lifecycle,execution:n?.execution,threads:n?.threads?.map(t=>[t.status,t.stop?.reason,t.stop?.description,t.stop?.hit_breakpoint_ids?.length]),identity:n?.target.build_identity,bps:n?.breakpoints?.map(x=>[x.source_id,x.line,x.status]),known:c?.knownBreakpoints?.().map(x=>[x.sourceId,x.line,x.state,x.file]),points:b?.trace?.points?.map(p=>p.breakpoint_id.slice(0,6)),actions:c?.actions?.slice(-3).map(a=>[a.kind,a.status,a.result])})};
const goOn=async()=>{
  const go=await until(()=>[...document.querySelectorAll('[aria-label="Continue (F5)"]')].find(b=>!b.classList.contains('is-disabled')&&!b.hasAttribute('disabled')),'Continue offered');
  press(go);
};`

let child: ChildProcess | undefined
let inspected: ChildProcess | undefined
let dir = ''
let port = 0
let token = ''
let repo = ''
let registration = ''
let daemonErrors = ''
let daemonExit = ''
let folder: Record<string, string> = {}

const JS = [
  'function inspectItem(n) {',
  '  const item = { count: n, nested: { label: "sample-" + n } }',
  '  return item',
  '}',
  'function calculate(n) {',
  '  const item = inspectItem(n)',
  '  if (n === 60) throw new Error("Synthetic calculation failure")',
  '  return item.count * 2',
  '}',
  'let next = 0',
  'setInterval(() => console.log(calculate(next++)), 200)',
  '',
].join('\n')

/** Registers the node, its folder and a chat in the app; a phone run starts after a reload, so again. */
function openChat() {
  const r = inApp<{
    registration: string
    target: Record<string, string>
  }>(`(async()=>{${prelude}
    const existing=nodes.nodes.value.find(n=>n.label==='Program fixture');if(existing){
      for(const id of [...chats.tabOrder.value].filter(id=>id.startsWith('node:'+existing.id+':')))chats.closeTab(id);
      for(const type of ['abele-node-file','abele-debug-view','abele-trace-run','abele-trace-value'])for(const leaf of app.workspace.getLeavesOfType(type))leaf.detach();
      api.DebuggerService.instance.destroy();
      nodes.remove(existing.id);
    }
    const node=await nodes.add('Program fixture','http://127.0.0.1:${port}',${JSON.stringify(token)}),client=nodes.connection(node.id).client;
    const project=await client.registerProject(${JSON.stringify(repo)},'trusted');
    const workspaces=await client.listWorkspaces(project.project_id),workspace=(workspaces.items??workspaces)[0];
    await client.nodePath.execution({project_id:project.project_id,target:{kind:'workspace',workspace_id:workspace.workspace_id},enabled:true},crypto.randomUUID());
    const s=await client.nodePath.createSession({title:'Program fixture',provider:'fake',target:{kind:'workspace',workspace_id:workspace.workspace_id}},crypto.randomUUID());
    await chats.openNodeSession({kind:'node-session',registrationId:node.id,nodeId:node.expectedNodeId,sessionId:s.session_id,title:s.title});
    await chats.revealSidebar({focus:false});
    await until(()=>[...document.querySelectorAll('.abele-node-chat[data-session-title="Program fixture"] [aria-label="More chat actions"]')].some(e=>e.offsetParent),'chat open');
    return {registration:node.id,target:{nodeId:node.expectedNodeId,registrationId:node.id,projectId:project.project_id,kind:'workspace',id:workspace.workspace_id}}
  })()`)
  registration = r.registration
  folder = r.target
}

beforeAll(async () => {
  const cli = process.env.ABELE_NODE_CLI
  if (!cli) throw new Error('Set ABELE_NODE_CLI to the built daemon CLI')
  mkdirSync('../.scratch', { recursive: true })
  dir = realpathSync(mkdtempSync(resolve('../.scratch/debug-journey-')))
  repo = resolve(dir, 'repo')
  const state = resolve(dir, 'state')
  mkdirSync(join(repo, 'src'), { recursive: true })
  writeFileSync(join(repo, 'src/journey.cjs'), JS)
  writeFileSync(join(repo, 'src/later.cjs'), 'module.exports = function sample() { return 7 }\n')
  writeFileSync(join(repo, 'src/unmapped.ts'), 'export const sample: number = 7\n')
  writeFileSync(
    join(repo, 'src/attached.cjs'),
    'setInterval(() => console.log("sample tick"), 200)\n'
  )
  inspected = spawn(
    process.execPath,
    ['--inspect-brk=127.0.0.1:0', join(repo, 'src/attached.cjs')],
    {
      cwd: repo,
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  )
  inspected.stderr!.resume()
  // A plain folder, not a repository: the chat runs in the folder itself.
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
  child = spawn(
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
  child.stdout!.on('data', (b) => {
    output += b
    daemonErrors = (daemonErrors + new Date().toISOString() + ' ' + b).slice(-16000)
  })
  child.stderr!.on('data', (b) => {
    errors += b
    daemonErrors = (daemonErrors + new Date().toISOString() + ' ' + b).slice(-16000)
  })
  child.on('exit', (code, signal) => (daemonExit = `daemon exited ${code ?? signal}`))
  for (let i = 0; !output.includes('"listening"'); i++) {
    if (i > 500 || child.exitCode !== null) throw Error(errors || 'Daemon startup deadline')
    await wait(20)
  }
  port = (
    JSON.parse(output.split('\n').find((l) => l.includes('"listening"'))!) as { port: number }
  ).port
  openChat()
}, 120000)

afterAll(async () => {
  try {
    evalRaw(
      `(()=>{const api=window.__abeleTest,chats=api.ChatService.getInstance();for(const t of ['abele-trace-run','abele-trace-value','abele-node-file'])for(const l of app.workspace.getLeavesOfType(t))l.detach();for(const id of chats.tabOrder.value.filter(id=>id.startsWith('node:'+${JSON.stringify(registration)}+':')))chats.closeTab(id);if(${JSON.stringify(registration)})api.NodeService.getInstance().remove(${JSON.stringify(registration)});return true})()`
    )
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise<void>((r) => child!.once('exit', () => r()))
      child.kill('SIGTERM')
      await stopped
    }
    if (inspected && inspected.exitCode === null && inspected.signalCode === null) {
      const stopped = new Promise<void>((r) => inspected!.once('exit', () => r()))
      inspected.kill('SIGTERM')
      await stopped
    }
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Runs `program` from the chat menu, picked in the program picker; the files open before it take
 * record points too. `via` is the menu item: Debug asks for a program while the chat has no session.
 */
const RUN = (program: string, shots = '', via = 'Run a program') => `
  const previousSession=api.DebuggerService.instance.active.value?.sessionId;
  document.querySelector('.abele-node-chat [aria-label="More chat actions"]').click();
  await until(()=>item(${JSON.stringify(via)}),${JSON.stringify(via + ' in the menu')});
  ${shots ? `await shot(${JSON.stringify(shots + '-menu')});` : ''}
  press(item(${JSON.stringify(via)}));
  const field=await until(()=>document.querySelector('.modal-container .prompt input.prompt-input'),'program asked');
  field.value=${JSON.stringify(program)};field.dispatchEvent(new Event('input',{bubbles:true}));
  ${shots ? `await shot(${JSON.stringify(shots + '-picker')});` : ''}
  press(await until(()=>[...document.querySelectorAll('.modal-container .prompt .suggestion-item')].find(r=>r.querySelector('.suggestion-title')?.textContent.trim()===${JSON.stringify(program)}),'the program offered'));
  press(await until(()=>[...document.querySelectorAll('.modal.abele-modal button')].find(el=>el.textContent.trim()==='Run a program'),'launch options confirmation'));
  await until(()=>{const b=api.DebuggerService.instance.active.value;return b?.sessionId&&b.sessionId!==previousSession},'new debug session',600);
  await until(()=>{const c=api.DebuggerService.instance.active.value?.controller;return c?.session.status==='paused'&&c.session.frames.some(f=>f.file)},'paused program stack ready',600);
  await until(()=>app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.getState().path===${JSON.stringify(program)}&&l.containerEl.querySelector('.abele-debug-source__point')),'debug source loaded',600);
  await until(()=>{const b=document.querySelector('[aria-label="Continue (F5)"]');return b&&b.offsetParent&&!b.disabled},'visible Continue offered',600);`

it('restarts an ended folder program through node RPC without a debugger presenter', async () => {
  const result = await inAppLong<{
    differentSession: boolean
    conversation: unknown
  }>(`(async()=>{${prelude}
    const client=nodes.connection(${JSON.stringify(registration)}).client;
    let id;
    const state=async()=> (await client.request('debugger.v1.status',{debug_session_id:id})).snapshot;
    const stopped=async label=>{
      for(let i=0;i<100;i++){
        const s=await state();
        if(s.execution==='stopped')return s;
        if(['terminated','detached','failed','connection-lost'].includes(s.lifecycle))throw Error(label+' ended before its first stop: '+JSON.stringify(s));
        await client.request('debugger.v1.wait',{debug_session_id:id,incarnation:s.incarnation,after_event_seq:s.event_seq,wait_id:crypto.randomUUID(),kinds:['stopped','lifecycle'],timeout_ms:200});
      }
      throw Error(label+' did not stop: '+JSON.stringify(await state()));
    };
    const stop=async()=>{
      const s=await state();
      if(['terminated','detached','failed','connection-lost'].includes(s.lifecycle))return;
      const r=await client.request(s.target.process_ownership==='owned'?'debugger.v1.terminate':'debugger.v1.detach',{operation_id:crypto.randomUUID(),debug_session_id:id,incarnation:s.incarnation,expected_state_revision:s.state_revision});
      if(r.outcome!=='completed')throw Error('Native stop did not complete: '+JSON.stringify(r));
    };
    try{
      const started=await client.request('debugger.v1.start',{operation_id:crypto.randomUUID(),folder:{kind:'workspace',workspace_id:${JSON.stringify(folder.id)}},program:'src/journey.cjs',argv:[],sources:[]});
      id=started.debug_session_id;
      await stopped('Initial native launch');
      await stop();
      const previous=id;
      const restarted=await client.request('debugger.v1.restart',{operation_id:crypto.randomUUID(),debug_session_id:previous});
      id=restarted.debug_session_id;
      const s=await stopped('Native restart');
      return {differentSession:id!==previous,conversation:s.target.conversation_id};
    }finally{if(id)await stop()}
  })()`)
  expect(result).toEqual({ differentSession: true, conversation: null })
}, 120000)

it.each(['desktop', 'phone'])(
  'opens folder debugging from the node menu without any chat on %s',
  async (device) => {
    const probe = async (name: string) => {
      const result = await inAppLong<{
        conversation: unknown
        chats: number
        sessions: number
      }>(`(async()=>{${prelude}
      const visible=selector=>[...document.querySelectorAll(selector)].find(e=>e.offsetParent);
      const registration=${JSON.stringify(registration)},connection=nodes.connection(registration),client=connection.client;
      for(const id of [...chats.tabOrder.value].filter(id=>id.startsWith('node:')))chats.closeTab(id);
      for(const session of await client.listSessions())await client.deleteSession(session.session_id);
      app.workspace.rightSplit.collapse();
      const model=api.NodePathService.getInstance().model(registration);
      await model.refresh();
      const target=model.targets.value.find(t=>t.projectId===${JSON.stringify(folder.projectId)});
      if(!target)throw Error('No registered folder target');
      await model.selectTarget(target);
      const leaf=app.workspace.getLeavesOfType('abele-node-sidebar')[0]??app.workspace.getLeftLeaf(false);
      await leaf.setViewState({type:'abele-node-sidebar',active:true,state:{registrationId:registration}});
      await app.workspace.revealLeaf(leaf);app.workspace.leftSplit.expand();
      press(await until(()=>visible('.abele-node-place [aria-label^="What can be done"]'),'node main menu'));
      await until(()=>item('Run a program')&&!item('Run a program').classList.contains('is-disabled'),'folder run enabled');
      if(!item('Attach to a running program'))throw Error('No folder attach action');
      await shot(${JSON.stringify(name + '-node-menu')});
      const dismiss=async()=>{document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));await wait(250);await app.workspace.revealLeaf(leaf);app.workspace.leftSplit.expand();await wait(250)};
      await dismiss();
      press(await until(()=>visible('.abele-node-place [aria-label^="What can be done"]'),'folder menu'));
      await until(()=>item('Run a program')&&!item('Run a program').classList.contains('is-disabled'),'folder menu ready');
      await shot(${JSON.stringify(name + '-folder-menu')});await dismiss();
      model.panelMode.value='files';
      if(!visible('.abele-node-panel [data-path="src/journey.cjs"]'))press(await until(()=>visible('.abele-node-panel [data-path="src"]'),'source folder'));
      const file=await until(()=>visible('.abele-node-panel [data-path="src/journey.cjs"]'),'source file row'),r=file.getBoundingClientRect();
      file.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+20,clientY:r.top+10}));
      await until(()=>item('Run a program')&&!item('Run a program').classList.contains('is-disabled'),'file menu ready');
      await shot(${JSON.stringify(name + '-file-menu')});await dismiss();
      if(!app.commands.commands['abele:node-folder-debug-run'])throw Error('Folder debug command missing');
      press(await until(()=>visible('.abele-node-place [aria-label^="What can be done"]'),'node menu again'));
      await until(()=>item('Run a program')&&!item('Run a program').classList.contains('is-disabled'),'node menu ready');
      press(item('Run a program'));
      // The fixture project is already trusted: opening another program must not ask again.
      const input=await until(()=>document.querySelector('.prompt input'),'trusted-folder program picker');
      if([...document.querySelectorAll('.modal button')].some(b=>b.textContent.trim()==='Allow execution'))throw Error('Trusted folder asked for execution confirmation');
      input.value='src/journey.cjs';input.dispatchEvent(new Event('input',{bubbles:true}));
      press(await until(()=>[...document.querySelectorAll('.prompt .suggestion-item')].find(el=>el.textContent.includes('src/journey.cjs')),'program suggestion'));
      press(await until(()=>[...document.querySelectorAll('.modal.abele-modal button')].find(el=>el.textContent.trim()==='Run a program'),'launch options confirmation'));
      await until(()=>api.DebuggerService.instance.active.value?.controller.session.status==='paused','folder debugger paused',500);
      const binding=api.DebuggerService.instance.active.value;
      await shot(${JSON.stringify(name + '-debugger-no-chat')});
      await until(()=>visible('.abele-debug-panel'),'visible folder debugger');
      await until(()=>binding.controller.session.variables.length,'automatic frame scopes');
      const approve=async (what,label=what)=>{
        const card=await until(()=>[...document.querySelectorAll('.abele-debug-view .abele-debug-action_asked')].find(c=>c.textContent.toLowerCase().includes(what.toLowerCase())),'inline approval '+what);
        await shot(${JSON.stringify(name)}+'-approval-'+label.replace(/[^a-z0-9]+/gi,'-'));
        press([...card.querySelectorAll('button')].find(b=>b.textContent.trim()==='Allow'));
        await until(()=>!binding.controller.actions.some(a=>a.status==='asked'&&!a.awaitingResult),'approval completed');
      };
      const scope=await until(()=>visible('.abele-debug-value_row .tree-item-self'),'scope row');
      press(scope);
      await approve('variables');
      await until(()=>binding.controller.session.variables.some(v=>v.children),'scope values loaded');
      await shot(${JSON.stringify(name)}+'-variables');
      if(!binding.connection.client.channel.channel.welcome.methods.includes('debugger.v1.exceptionBreakpoints.set'))throw Error('Exception filters not exposed');
      for(const label of ['Caught exceptions','Uncaught exceptions']){
        press(visible('[aria-label="'+label+'"]'));
        await until(()=>binding.controller.exceptionFilters.length===(label==='Caught exceptions'?1:2),'exception filter saved');
      }
      await shot(${JSON.stringify(name)}+'-exceptions');
      const frame=binding.controller.session.frames[binding.controller.session.frame],sourceId=api.DebuggerService.instance.debugFor(target,'src/journey.cjs').sourceId;
      await binding.controller.setBreakpoint('sample-controls',sourceId,frame.line);
      const bpMenu=async()=>{
        const row=await until(()=>[...document.querySelectorAll('.abele-debug-panel .tree-item-self')].find(r=>r.querySelector('.abele-tree-item__text')?.textContent===frame.file.split('/').pop()+':'+frame.line),'breakpoint row');
        press(row.querySelector('[aria-label="Breakpoint options"]'));
        await until(()=>item('Edit condition'),'breakpoint menu');
      };
      await bpMenu();await shot(${JSON.stringify(name)}+'-breakpoint-menu');
      press(item('Edit condition'));
      const condition=await until(()=>document.querySelector('.modal input'),'condition editor');
      condition.value='1 < 2 && "a" < "b"';condition.dispatchEvent(new Event('input',{bubbles:true}));
      await shot(${JSON.stringify(name)}+'-condition');
      condition.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      await approve('breakpoint');
      await until(()=>binding.controller.snapshot.breakpoints.some(b=>b.condition==='1 < 2 && "a" < "b"'),'condition saved verbatim');
      await bpMenu();press(item('Log message'));
      const logMessage=await until(()=>document.querySelector('.modal input'),'log message editor');
      logMessage.value='sample {1 < 2 && "a" < "b"}';logMessage.dispatchEvent(new Event('input',{bubbles:true}));
      await shot(${JSON.stringify(name)}+'-log-message');
      logMessage.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      await approve('breakpoint','log-point');
      await until(()=>binding.controller.snapshot.breakpoints.some(b=>b.log_message==='sample {1 < 2 && "a" < "b"}'),'log message saved verbatim');
      await bpMenu();press(item('Disable breakpoint'));
      await until(()=>binding.controller.knownBreakpoints().some(b=>b.id==='sample-controls'&&!b.enabled),'disabled breakpoint');
      await shot(${JSON.stringify(name)}+'-disabled');
      press(visible('[aria-label="Remove all breakpoints"]'));
      await until(()=>!binding.controller.knownBreakpoints().length,'all breakpoints removed');
      await shot(${JSON.stringify(name)}+'-breakpoints-empty');
      await binding.trace.savePoint(sourceId,frame.line,{take:['1'],when:'1 < 2 && "a" < "b"'});
      await approve('breakpoint','record-point');
      await until(()=>binding.trace.breakpoints().some(b=>b.kind==='record'&&b.when==='1 < 2 && "a" < "b"'),'conditional record point saved');
      await shot(${JSON.stringify(name)}+'-record-point');
      const watch=visible('.abele-debug-panel__add input');
      watch.value='sampleValue_'+'value'.repeat(45);watch.dispatchEvent(new Event('input',{bubbles:true}));
      watch.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      const refused=await until(()=>[...document.querySelectorAll('.abele-debug-view .abele-debug-action_asked')].find(c=>c.textContent.includes('sampleValue_')),'long watch approval');
      await shot(${JSON.stringify(name)}+'-approval-long');
      press([...refused.querySelectorAll('button')].find(b=>b.textContent.trim()==='Deny'));
      await until(()=>binding.controller.actions.some(a=>a.status==='denied'),'request denied');
      await shot(${JSON.stringify(name)}+'-approval-denied');
      watch.value='1 < 2 && "a" < "b"';watch.dispatchEvent(new Event('input',{bubbles:true}));
      watch.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      await approve('1 < 2');
      await until(()=>binding.controller.session.watches.some(w=>w.value==='true'),'approved watch value');
      await shot(${JSON.stringify(name)}+'-watch');
      const snapshot=binding.controller.snapshot;
      const result={conversation:snapshot.target.conversation_id,chats:chats.tabOrder.value.filter(id=>id.startsWith('node:')).length,sessions:(await client.listSessions()).length};
      await binding.controller.command('stop');
      await binding.rerun();
      await until(()=>api.DebuggerService.instance.active.value!==binding&&api.DebuggerService.instance.active.value?.controller.session.status==='paused','folder restart after exit',500);
      const restarted=api.DebuggerService.instance.active.value;
      if(binding.controller.session.status!=='exited')throw Error('Restart replaced the ended session observation');
      if(restarted.controller.snapshot.target.conversation_id!==null)throw Error('Restart acquired a chat owner');
      await restarted.controller.command('stop');
      return result;
    })()`)
      expect(result).toEqual({ conversation: null, chats: 0, sessions: 0 })
    }
    try {
      if (device === 'desktop') await probe('folder-desktop')
      else
        await withEmulatedPhone(async () => {
          openChat()
          await probe('folder-phone')
        })
    } finally {
      openChat()
    }
  },
  300000
)

it('persists an automatically generated node title in the tab and node session list', async () => {
  const probe = async (name: string) => {
    const result = await inAppLong<{ title: string; reopened: string }>(`(async()=>{${prelude}
      const registration=${JSON.stringify(registration)},client=nodes.connection(registration).client;
      const model=api.NodePathService.getInstance().model(registration);await model.refresh();
      const target=model.targets.value.find(t=>t.projectId===${JSON.stringify(folder.projectId)});
      const wire=target.kind==='worktree'?{kind:'worktree',worktree_id:target.id}:{kind:'workspace',workspace_id:target.id};
      await client.nodePath.execution({project_id:target.projectId,target:wire,enabled:true},crypto.randomUUID());
      const helper=chats.getAuxiliaryModelConfig,fetch=window.fetch;
      const fake='http://sample-title-helper.invalid/v1';
      const nl=String.fromCharCode(10);
      window.fetch=async(url,init)=>String(url).startsWith(fake)
        ?new Response('data: '+JSON.stringify({choices:[{delta:{content:'Sample refactoring'},finish_reason:null}]})+nl+nl+'data: [DONE]'+nl+nl,{headers:{'Content-Type':'text/event-stream'}})
        :fetch(url,init);
      chats.getAuxiliaryModelConfig=()=>({id:'sample-helper',name:'Sample',baseUrl:fake,apiKey:'',contextWindow:1000,maxTokens:100,supportsReasoning:false});
      let session,tab;
      try {
        session=await client.nodePath.createSession({title:'New chat',provider:'fake',target:wire},crypto.randomUUID());
        const reference={kind:'node-session',registrationId:registration,nodeId:nodes.nodes.value.find(n=>n.id===registration).expectedNodeId,sessionId:session.session_id,title:'New chat'};
        tab='node:'+registration+':'+session.session_id;
        await chats.openNodeSession(reference);await chats.revealSidebar({focus:false});
        const presenter=chats.getNodeSession(tab);
        await presenter.send('Refactor the sample',[{kind:'chunk',text:'The sample is refactored.'}]);
        await until(()=>presenter.label.value==='Sample refactoring','automatic node title',500);
        await shot(${JSON.stringify('node-automatic-title-' + name + '-tab')});
        chats.closeTab(tab);await chats.openNodeSession(reference);
        const reopened=chats.getNodeSession(tab).label.value;
        await model.refresh();await model.selectTarget(target);model.panelMode.value='sessions';
        const leaf=app.workspace.getLeavesOfType('abele-node-sidebar')[0]??app.workspace.getLeftLeaf(false);
        await leaf.setViewState({type:'abele-node-sidebar',active:true,state:{registrationId:registration}});
        await app.workspace.revealLeaf(leaf);app.workspace.leftSplit.expand();
        await until(()=>document.querySelector('.abele-node-panel')?.textContent.includes('Sample refactoring'),'named node list');
        await shot(${JSON.stringify('node-automatic-title-' + name + '-list')});
        return {title:(await client.getSession(session.session_id)).title,reopened};
      } finally {
        window.fetch=fetch;chats.getAuxiliaryModelConfig=helper;
        if(tab)chats.closeTab(tab);if(session)await client.deleteSession(session.session_id);
      }
    })()`)
    expect(result).toEqual({ title: 'Sample refactoring', reopened: 'Sample refactoring' })
  }
  try {
    await probe('desktop')
    await withEmulatedPhone(async () => {
      openChat()
      await probe('phone')
    })
  } finally {
    openChat()
  }
}, 240000)

it('walks from source through stepping, recording, analysis, a crash, restart and reattach', async () => {
  const seen = await inAppLong<{
    values: number[]
    runId: string
    projectId: string
    stopped: boolean
    reattached: boolean
    failures: string[]
  }>(`(async()=>{${prelude}
    const failures=[];
    const visible=selector=>[...document.querySelectorAll(selector)].find(e=>e.offsetParent);
    const enabled=(label,scope='')=>{const e=visible(scope+' [aria-label="'+label+'"]');return e&&!e.disabled?e:null};
    const control=async (label,scope)=>press(await until(()=>enabled(label,scope),label+' available'));
    const paused=()=>visible('.abele-debug-panel_paused');
    const rowNamed=name=>[...document.querySelectorAll('.abele-debug-value_row')].find(r=>{const text=r.querySelector(':scope > .tree-item-self .abele-tree-item__text')?.textContent.trim();return text===name||(name==='Local'&&text?.startsWith('Local: '))});
    const expand=async name=>{
      await until(()=>enabled('Step over (F10)'),'variable controls ready');
      const row=await until(()=>rowNamed(name),'variable '+name);
      press(row.querySelector(':scope > .tree-item-self'));
      // Inspection follows the same explicit approval path as other debugger requests.
      await until(()=>row.querySelector('.abele-debug-value_row')||row.textContent.includes('Waiting for approval in Debug'),'inspection result or approval request');
      if(!row.querySelector('.abele-debug-value_row')){
        if(name==='Local')await shot('journey-waiting-approval');
        await chats.revealSidebar({focus:false});
        const allow=await until(()=>[...document.querySelectorAll('.abele-debug-action_asked button')].find(b=>b.closest('.abele-debug-action')?.querySelector('.abele-debug-action__what')?.textContent.trim()==='variables'&&b.textContent.trim()==='Allow'&&!b.disabled&&b.offsetParent),'variables approval in chat');
        if(name==='Local')await shot('journey-chat-approval');
        press(allow);
        await app.workspace.revealLeaf(app.workspace.getLeavesOfType('abele-debug-view')[0]);
      }
      await until(()=>rowNamed(name)?.querySelector('.abele-debug-value_row'),'approved children of '+name);
    };
    let source=app.workspace.getLeaf('tab');
    const sourceAt=async(line,name)=>{
      const expected=${JSON.stringify(JS.split('\n'))}[line-1].trim();
      await until(()=>[...document.querySelectorAll('.abele-node-debug-file .abele-debug-source__line_here')].some(e=>e.offsetParent&&(()=>{const line=e.cloneNode(true);line.querySelectorAll('.abele-debug-source__tail').forEach(t=>t.remove());return line.textContent.trim()===expected})()),'visible highlighted source at line '+line);
      source=app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.getState().path==='src/journey.cjs');
      if(!source)throw Error('Source file not opened');
      await shot(name);
    };
    await source.setViewState({type:'abele-node-file',active:true,state:{kind:'file',target:${JSON.stringify(folder)},path:'src/journey.cjs'}});
    await until(()=>source.containerEl.textContent.includes('function calculate'),'source open');
    await shot('journey-source');
    ${RUN('src/journey.cjs', 'journey-start', 'Debug')}
    await until(()=>paused(),'initial stop');
    press(await until(()=>marginAt(6),'gutter of function call'));
    await until(()=>document.querySelectorAll('.abele-debug-panel .abele-breakpoint-mark').length,'breakpoint shown');
    await goOn();
    await until(()=>paused()&&document.querySelector('.abele-debug-panel__where')?.textContent.includes(':6'),'breakpoint hit');
    await shot('journey-breakpoint');
    const breakpointRow=()=>[...document.querySelectorAll('.abele-debug-panel .tree-item-self')].find(r=>r.querySelector('.abele-tree-item__text')?.textContent.trim()==='journey.cjs:6');
    // The breakpoint-list diamond opens a closed file; the row and stopped-location link reuse it.
    source.detach();
    press((await until(breakpointRow,'breakpoint row')).querySelector('.abele-breakpoint-mark'));
    await sourceAt(6,'journey-breakpoint-diamond-source');
    press(breakpointRow().querySelector('.abele-tree-item__text'));
    await sourceAt(6,'journey-breakpoint-row-source');
    press(document.querySelector('.abele-debug-panel__where'));
    await sourceAt(6,'journey-paused-location-source');
    await control('Step into (F11)');
    await until(()=>paused()&&document.querySelector('.abele-debug-panel__where')?.textContent.includes(':2'),'stepped into function');
    await control('Step over (F10)');
    await until(()=>paused()&&document.querySelector('.abele-debug-panel__where')?.textContent.includes(':3'),'stepped over object creation');
    await until(()=>enabled('Step over (F10)'),'frame controls ready');
    press(await until(()=>[...document.querySelectorAll('.abele-debug-panel .tree-item-self')].find(r=>r.querySelector('.abele-tree-item__text')?.textContent.includes('inspectItem')),'function frame'));
    // Keep exercising the rest of the journey when the neighbouring variables area fails;
    // the final assertion still fails the test with every retained error.
    try {
      await expand('Local');
      await expand('item');
      await expand('nested');
      await until(()=>document.querySelector('.abele-debug-panel')?.textContent.includes('sample-0'),'expanded object value');
    } catch(error) { failures.push('Variables: '+String(error)); }
    if(!document.querySelector('.abele-debug-panel')?.textContent.includes('inspectItem'))throw Error('Readable function name missing');
    await shot('journey-variables-stack');
    await control('Step out (Shift+F11)');
    await until(()=>paused()&&document.querySelector('.abele-debug-panel__where')?.textContent.includes(':7'),'stepped out');
    // Toggle the ordinary breakpoint off, then take the changing argument without stopping.
    const breakpoint=await until(()=>source.containerEl.querySelector('button.abele-debug-source__point[aria-label^="Stops here"]'),'existing breakpoint');
    press(breakpoint);
    await until(()=>marginAt(6,source.containerEl),'breakpoint removed');
    await app.workspace.revealLeaf(source);
    await recordPoint(6,['n'],source.containerEl);
    press((await until(breakpointRow,'record point listed')).querySelector('.abele-breakpoint-mark_record'));
    await sourceAt(6,'journey-record-list-diamond-source');
    await goOn();
    try {
      await until(()=>[...source.containerEl.querySelectorAll('.abele-debug-source__tail')].some(e=>/n\\s+\\d/.test(e.textContent)),'inline argument value',100);
    } catch(error) {
      const trace=api.DebuggerService.instance.active.value.trace;
      const runs=await trace.rpc.runs(trace.projectId);
      const recorded=await trace.rpc.run(trace.projectId,runs.runs[0].id,0,1);
      throw Error('Node recorded values: '+JSON.stringify(recorded.steps[0]?.values)+'; '+String(error));
    }
    await shot('journey-inline-values');
    const b=api.DebuggerService.instance.active.value;
    await until(()=>b.trace?.status?.recording?.steps>=3,'several recorded steps',100);
    const runId=b.trace.status.recording.run_id,projectId=b.trace.projectId;
    await api.openTraceRun({registrationId:${JSON.stringify(registration)},projectId,runId});
    const runLeaf=app.workspace.getLeavesOfType('abele-trace-run').find(l=>l.view.getState().runId===runId);
    const returnToRun=async()=>{await app.workspace.revealLeaf(runLeaf);app.workspace.setActiveLeaf(runLeaf,{focus:true});await until(()=>visible('.abele-trace-run'),'run visible');};
    const steps=()=>[...document.querySelectorAll('.abele-trace-run__steps > .abele-trace-run__step')];
    await until(()=>steps().length>=3,'recorded steps');
    const values=[];
    for(const row of steps().slice(0,3)){
      press(row.querySelector('.tree-item-self'));
      // Picking a row inspects it in place; only the detail's source link leaves the run.
      await until(()=>row.querySelector('.tree-item-self.is-active')&&visible('.abele-trace-run')&&visible('.abele-trace-step'),'recorded detail in run');
      const value=await until(()=>[...document.querySelectorAll('.abele-trace-step .abele-trace-value')].find(e=>e.querySelector('.abele-tree-item__text')?.textContent.trim()==='n'),'recorded n');
      if(value.querySelector('.abele-trace-value__failed'))throw Error('Record capture failed: '+value.textContent);
      values.push(Number(value.querySelector('.abele-tree-item__note')?.textContent.trim()));
      press(await until(()=>visible('.abele-trace-step__source'),'step source link'));
      await sourceAt(6,'journey-step-row-source-'+(values.length-1));
      await returnToRun();
    }
    press(steps()[0].querySelector('.abele-trace-glyph'));
    await until(()=>steps()[0].querySelector('.tree-item-self.is-active')&&visible('.abele-trace-run')&&visible('.abele-trace-step'),'glyph inspects step in run');
    press(await until(()=>visible('.abele-trace-step__source'),'selected step source link'));
    await sourceAt(6,'journey-step-diamond-source');
    await returnToRun();
    press(document.querySelector('.abele-trace-step__head .abele-trace-glyph'));
    await sourceAt(6,'journey-detail-diamond-source');
    await returnToRun();
    press(document.querySelector('.abele-trace-step__title'));
    await sourceAt(6,'journey-detail-title-source');
    await returnToRun();
    press(document.querySelector('.abele-trace-step__place'));
    await sourceAt(6,'journey-step-location-source');
    await returnToRun();
    const search=document.querySelector('input[aria-label="Find in the steps"]');
    search.value='no-such-sample';search.dispatchEvent(new Event('input',{bubbles:true}));
    await until(()=>document.querySelector('.abele-trace-run')?.textContent.includes('No step matches.'),'search empty state');
    search.value='n';search.dispatchEvent(new Event('input',{bubbles:true}));
    await until(()=>steps().length>=3,'find by captured name');
    press(document.querySelector('[aria-label="Only what the record points took"]'));
    await until(()=>steps().length>=3,'record point filter');
    await shot('journey-run-values');
    await control('Back to debugger');
    await until(()=>visible('.abele-debug-panel'),'returned debugger');
    await shot('journey-back-debugger');
    await until(()=>document.querySelector('.abele-debug-panel')?.textContent.includes('Synthetic calculation failure'),'exception visible',900);
    await until(()=>document.querySelector('.abele-debug-panel')?.textContent.includes('journey.cjs:7'),'exception source location');
    await shot('journey-exception');
    const restart=()=>enabled('Restart: the same program from its first line');
    if(paused())await control('Stop (Shift+F5)');
    await until(()=>visible('.abele-debug-panel_exited'),'program stopped');
    await shot('journey-stopped');
    press(await until(restart,'Restart after stop'));
    await until(()=>paused(),'restarted program held');
    await until(restart,'restart finished carrying points');
    await app.workspace.revealLeaf(source);
    // The record point travelled with Restart; replace it with an ordinary breakpoint.
    const record=source.containerEl.querySelector('button.abele-debug-source__point[aria-label^="Record point"]');
    if(!record)throw Error('Restart did not carry the record point');
    // The gutter-toggle branch removes a record point with a click; editing stays in its menu.
    press(record);
    await until(()=>marginAt(6),'record point removed');
    if(document.querySelector('.abele-trace-point'))throw Error('Gutter click opened the point editor');
    await shot('journey-record-point-click-removed');
    press(marginAt(6));
    await goOn();
    await until(()=>paused()&&document.querySelector('.abele-debug-panel__where')?.textContent.includes(':6'),'breakpoint hit after restart');
    await shot('journey-restarted-breakpoint');
    // Drop only this disposable node connection; recover through the visible retry action.
    await nodes.connection(${JSON.stringify(registration)}).refreshAuthorization();
    await until(()=>visible('.abele-debug-panel_lost'),'connection loss shown');
    await shot('journey-disconnected');
    await control('Try to reconnect','.abele-debug-panel');
    await until(()=>paused(),'reconnected to the held program');
    await shot('journey-reconnected');
    await control('Stop (Shift+F5)');
    await until(()=>visible('.abele-debug-panel_exited'),'restarted program stopped');
    // Attach, detach, then choose the still-running process again from the debugger toolbar.
    await chats.revealSidebar({focus:false});
    await until(()=>visible('.abele-node-chat [aria-label="More chat actions"]'),'visible chat menu for attach');
    document.querySelector('.abele-node-chat [aria-label="More chat actions"]').click();
    press(await until(()=>item('Attach to a running program'),'attach menu'));
    const pickAttached=async()=>press(await until(()=>[...document.querySelectorAll('.prompt .suggestion-item')].find(e=>e.textContent.includes('attached.cjs')),'waiting synthetic program'));
    await pickAttached();
    await until(()=>enabled('Detach (Shift+F5): the program runs on'),'attached debugger');
    await control('Detach (Shift+F5): the program runs on');
    await until(()=>visible('.abele-debug-panel [role="status"][aria-label^="Detached"]'),'detached program');
    await shot('journey-detached');
    await control('Attach to a running program');
    await pickAttached();
    await until(()=>enabled('Detach (Shift+F5): the program runs on'),'reattached debugger');
    await shot('journey-reattached');
    await control('Detach (Shift+F5): the program runs on');
    return {values,runId,projectId,stopped:true,reattached:true,failures}
  })()`)
  expect(seen.values).toEqual([1, 2, 3])
  expect(seen.stopped).toBe(true)
  expect(seen.reattached).toBe(true)
  // Exercise the actual agent tool formatter over the same node data, with no live provider.
  const timeline = evalAsync<AgentToolResult>(
    `window.__abeleTest.readAgentTraceTimeline(${JSON.stringify(seen.runId)})`
  )
  const text = timeline.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
  for (const value of seen.values) expect(text).toContain(`n=${value} [`)
  expect(seen.failures).toEqual([])
}, 180000)

it('on a phone: breakpoint navigation uncovers the source and highlights its line', async () => {
  await withEmulatedPhone(async () => {
    openChat()
    const result = await inAppLong<{
      highlighted: boolean
      drawersClosed: boolean
    }>(`(async()=>{${prelude}
      try {
        ${RUN('src/journey.cjs', 'journey-phone', 'Debug')}
        await until(()=>document.querySelector('.abele-debug-panel_paused'),'program held');
        const source=app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.getState().path==='src/journey.cjs');
        await app.workspace.revealLeaf(source);
        app.workspace.rightSplit.collapse();
        press(await until(()=>marginAt(6),'source gutter'));
        const row=()=>[...document.querySelectorAll('.abele-debug-panel .tree-item-self')].find(r=>r.querySelector('.abele-tree-item__text')?.textContent.trim()==='journey.cjs:6');
        await until(row,'breakpoint listed');
        await wait(500);
        const debug=app.workspace.getLeavesOfType('abele-debug-view')[0];
        await app.workspace.revealLeaf(debug);
        app.workspace.rightSplit.expand();
        await shot('journey-phone-breakpoint-list');
        press(row().querySelector('.abele-breakpoint-mark'));
        const highlighted=await until(()=>[...document.querySelectorAll('.abele-debug-source__line_here')].some(e=>e.offsetParent&&e.textContent.trim()==='const item = inspectItem(n)'),'source line visible');
        // Highlighting precedes the asynchronous leaf reveal. Collapsed drawers alone can
        // describe the old layout while that reveal is still activating the source.
        await until(()=>app.workspace.activeLeaf===source&&app.workspace.leftSplit.collapsed&&app.workspace.rightSplit.collapsed,'source active and drawers closed');
        await shot('journey-phone-breakpoint-source');
        const persisted=!!highlighted&&[...document.querySelectorAll('.abele-debug-source__line_here')].some(e=>e.offsetParent&&e.textContent.trim()==='const item = inspectItem(n)');if(!persisted)throw Error('Source highlight did not persist; '+debugState());return {highlighted:persisted,drawersClosed:app.workspace.leftSplit.collapsed&&app.workspace.rightSplit.collapsed};
      } finally {
        const stop=document.querySelector('.abele-debug-panel [aria-label="Stop (Shift+F5)"]');
        if(stop&&!stop.disabled){press(stop);await until(()=>document.querySelector('.abele-debug-panel_exited'),'program stopped');}
        for(const type of ['abele-node-file','abele-debug-view','abele-trace-run','abele-trace-value'])for(const leaf of app.workspace.getLeavesOfType(type))leaf.detach();
        await app.workspace.requestSaveLayout.run();
      }
    })()`)
    expect(result).toEqual({ highlighted: true, drawersClosed: true })
  })
}, 180000)

it.each(['desktop', 'phone'])(
  'admits a later-opened source and explains an unmapped file on %s',
  async (device) => {
    const probe = async () => {
      openChat()
      const result = await inAppLong<{
        supported: boolean
        margin: boolean
        refusal: string
      }>(`(async()=>{${prelude}
      try {
        ${RUN('src/journey.cjs')}
        const binding=api.DebuggerService.instance.active.value;
        const supported=binding.connection.client.channel?.channel?.welcome?.methods?.includes('debugger.v1.addSources')===true;
        const open=async path=>{
          const leaf=app.workspace.getLeaf('tab');
          await leaf.setViewState({type:'abele-node-file',active:true,state:{kind:'file',target:${JSON.stringify(folder)},path}});
          await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});
          app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse();
          return leaf;
        };
        const later=await open('src/later.cjs');
        if(!supported){
          await until(()=>later.containerEl.textContent.includes('Update the node to set breakpoints'),'old node explanation');
          await shot('admission-${device}-update-node');
          return {supported:false,margin:false,refusal:'update node'};
        }
        await until(()=>later.containerEl.querySelector('.abele-debug-source__point'),'later source margin');
        await shot('admission-${device}-later-source');
        const refused=await open('src/unmapped.ts');
        await until(()=>refused.containerEl.textContent.includes('Build with source maps'),'unmapped TypeScript explanation');
        await shot('admission-${device}-unmapped-source');
        return {supported:true,margin:!!later.containerEl.querySelector('.abele-debug-source__point'),refusal:refused.containerEl.textContent};
      } finally {
        const binding=api.DebuggerService.instance.active.value;
        if(binding?.controller.current&&binding.controller.session.status!=='exited')await binding.controller.command('stop');
        for(const type of ['abele-node-file','abele-debug-view','abele-trace-run','abele-trace-value'])for(const leaf of app.workspace.getLeavesOfType(type))leaf.detach();
      }
    })()`)
      if (result.supported) {
        expect(result.margin).toBe(true)
        expect(result.refusal).toContain('Build with source maps')
      } else {
        expect(result.refusal).toBe('update node')
        console.log(
          'Source admission unavailable on installed node; verified update-node fallback only'
        )
      }
    }
    if (device === 'phone') await withEmulatedPhone(probe)
    else await probe()
  },
  180000
)

it('shows disabled debugger actions with the debugger off on desktop and phone', async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const stopped = new Promise<void>((resolve) => child!.once('exit', () => resolve()))
    child.kill('SIGTERM')
    await stopped
  }
  child = spawn(
    process.execPath,
    [
      process.env.ABELE_NODE_CLI!,
      'start',
      '--state-dir',
      resolve(dir, 'state'),
      '--port',
      String(port),
      '--claude-path',
      resolve('tests/fixtures/nodeClaude.mjs'),
      '--json',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let output = '',
    errors = ''
  child.stdout!.on('data', (chunk) => {
    output += chunk
  })
  child.stderr!.on('data', (chunk) => {
    errors += chunk
  })
  for (let attempt = 0; !output.includes('"listening"'); attempt++) {
    if (attempt > 500 || child.exitCode !== null) throw Error(errors || 'Daemon startup deadline')
    await wait(20)
  }
  const capture = async (name: string) => {
    const result = await inAppLong<{ actions: number; disabled: boolean }>(`(async()=>{${prelude}
      const registration=${JSON.stringify(registration)};
      for(const id of [...chats.tabOrder.value].filter(id=>id.startsWith('node:')))await chats.closeTab(id);
      app.workspace.rightSplit.collapse();
      await nodes.connection(registration).connect();
      const model=api.NodePathService.getInstance().model(registration);await model.refresh();
      if(!model.current.value)await model.selectTarget(model.targets.value[0]);
      const leaf=app.workspace.getLeavesOfType('abele-node-sidebar')[0]??app.workspace.getLeftLeaf(false);
      await leaf.setViewState({type:'abele-node-sidebar',active:true,state:{registrationId:registration}});
      await app.workspace.revealLeaf(leaf);app.workspace.leftSplit.expand();
      press(await until(()=>[...document.querySelectorAll('.abele-node-place [aria-label^="What can be done"]')].find(el=>el.offsetParent),'node menu'));
      await until(()=>[...document.querySelectorAll('.menu-item-title')].some(el=>el.textContent.includes('The debugger is off on this node')),'disabled reason');
      const rows=[...document.querySelectorAll('.menu-item')].filter(el=>el.querySelector('.menu-item-title')?.textContent.includes('The debugger is off on this node'));
      await shot(${JSON.stringify(name)});
      const result={actions:rows.length,disabled:rows.every(el=>el.classList.contains('is-disabled'))};
      document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));
      return result;
    })()`)
    expect(result).toEqual({ actions: 3, disabled: true })
  }
  await capture('folder-desktop-disabled')
  await withEmulatedPhone(() => capture('folder-phone-disabled'))
}, 120000)
