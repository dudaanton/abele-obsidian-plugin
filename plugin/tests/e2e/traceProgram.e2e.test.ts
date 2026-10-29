// A real program run under the node's JavaScript debugger from a node chat: the chat menu starts
// it, a record point goes in through the margin while it waits on its first line, the program runs
// to its end and its run opens by itself, one step per hit with the values the point took. Then
// the same through TypeScript and the source map its build left. Needs the node to install its
// pinned JavaScript debugger, which it downloads once into this test's own state.
import { afterAll, beforeAll, expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { evalAsync } from './helpers/githubLive'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { evalRaw } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
targets('desktop')

const SHOTS = shotDir('abele-trace')
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** What the app answered, or why not, with what the node said on its way out. */
function inApp<T>(script: string): T {
  try {
    return evalAsync<T>(script)
  } catch (e) {
    throw new Error(
      `node: ${daemonExit || 'running'}\n${daemonErrors.slice(-1200)}\n${e instanceof Error ? e.message : String(e)}`
    )
  }
}
const prelude = `const wait=ms=>new Promise(r=>setTimeout(r,ms)),until=async(fn,what,tries=300)=>{for(let i=0;i<tries;i++){const v=fn();if(v)return v;await wait(50)}throw Error('Did not converge: '+what+'; '+(document.querySelector('.workspace-leaf.mod-active')?.textContent??'').slice(0,400))};
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
const debugState=()=>JSON.stringify({log:window.__dbgLog.slice(-10),notices:[...document.querySelectorAll('.notice')].map(n=>n.textContent)})+' '+debugState0();
const debugState0=()=>{const b=api.DebuggerService.instance.active.value,c=b?.controller,n=c?.snapshot;return JSON.stringify({status:c?.session.status,error:c?.error,lifecycle:n?.lifecycle,execution:n?.execution,threads:n?.threads?.map(t=>[t.status,t.stop?.reason,t.stop?.description,t.stop?.hit_breakpoint_ids?.length]),identity:n?.target.build_identity,bps:n?.breakpoints?.map(x=>[x.source_id,x.line,x.status]),known:c?.knownBreakpoints?.().map(x=>[x.sourceId,x.line,x.state,x.file]),points:b?.trace?.points?.map(p=>p.breakpoint_id.slice(0,6)),actions:c?.actions?.slice(-3).map(a=>[a.kind,a.status,a.result])})};
const goOn=async()=>{
  const go=await until(()=>[...document.querySelectorAll('[aria-label="Continue (F5)"]')].find(b=>!b.classList.contains('is-disabled')&&!b.hasAttribute('disabled')),'Continue offered');
  press(go);
};`

let child: ChildProcess | undefined
let dir = ''
let port = 0
let token = ''
let repo = ''
let registration = ''
let daemonErrors = ''
let daemonExit = ''
let folder: Record<string, string> = {}

const JS = [
  'function total(items) {',
  '  let sum = 0',
  '  for (const item of items) {',
  '    sum += item.price',
  '  }',
  '  return sum',
  '}',
  'console.log(total([{ price: 2 }, { price: 3 }, { price: 5 }]))',
  '',
].join('\n')
const TS = [
  'type Item = { price: number; label: string }',
  '',
  'function total(items: Item[]): number {',
  '  let sum: number = 0',
  '  for (const item of items) {',
  '    sum += item.price',
  '  }',
  '  return sum',
  '}',
  "console.log(total([{ price: 7, label: 'first' }, { price: 11, label: 'second' }]))",
  '',
].join('\n')

/** Registers the node, its folder and a chat in the app; a phone run starts after a reload, so again. */
function openChat() {
  const r = evalAsync<{
    registration: string
    target: Record<string, string>
  }>(`(async()=>{${prelude}
    const existing=nodes.nodes.value.find(n=>n.label==='Program fixture');if(existing)nodes.remove(existing.id);
    const node=await nodes.add('Program fixture','http://127.0.0.1:${port}',${JSON.stringify(token)}),client=nodes.connection(node.id).client;
    const project=await client.registerProject(${JSON.stringify(repo)},'trusted');
    const workspaces=await client.listWorkspaces(project.project_id),workspace=(workspaces.items??workspaces)[0];
    await client.nodePath.execution({project_id:project.project_id,target:{kind:'workspace',workspace_id:workspace.workspace_id},enabled:true},crypto.randomUUID());
    const s=await client.nodePath.createSession({title:'Program fixture',provider:'fake',target:{kind:'workspace',workspace_id:workspace.workspace_id}},crypto.randomUUID());
    await chats.openNodeSession({kind:'node-session',registrationId:node.id,nodeId:node.expectedNodeId,sessionId:s.session_id,title:s.title});
    await chats.revealSidebar({focus:false});
    await until(()=>document.querySelector('.abele-node-chat')?.dataset.sessionTitle==='Program fixture','chat open');
    return {registration:node.id,target:{nodeId:node.expectedNodeId,registrationId:node.id,projectId:project.project_id,kind:'workspace',id:workspace.workspace_id}}
  })()`)
  registration = r.registration
  folder = r.target
}

beforeAll(async () => {
  const cli = process.env.ABELE_NODE_CLI
  if (!cli) throw new Error('Set ABELE_NODE_CLI to the built daemon CLI')
  mkdirSync('../.scratch', { recursive: true })
  dir = realpathSync(mkdtempSync(resolve('../.scratch/trace-program-')))
  repo = resolve(dir, 'repo')
  const state = resolve(dir, 'state')
  const built = ts.transpileModule(TS, {
    fileName: 'total.ts',
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      sourceMap: true,
    },
  })
  const map = JSON.parse(built.sourceMapText!)
  map.file = 'total.js'
  map.sources = ['../src/total.ts']
  for (const [path, text] of Object.entries({
    'src/total.js': JS,
    'src/total.ts': TS,
    'packages/orders/src/index.js':
      'const value = 1\nglobalThis.sample = value\nsetInterval(() => {}, 1000)\n',
    'packages/rates/src/index.js':
      'const rate = 2\nconst amounts = [{price: 1}].map((entry) => {\n  const lineTotal = entry.price * rate\n  return lineTotal\n})\nconst surge = rate + 1\nglobalThis.sample = amounts.length + surge\nsetInterval(() => {}, 1000)\n',
    'dist/total.js':
      built.outputText.replace(/\/\/# sourceMappingURL=.*$/m, '') +
      '\n//# sourceMappingURL=total.js.map\n',
    'dist/total.js.map': JSON.stringify(map),
  })) {
    mkdirSync(join(repo, path, '..'), { recursive: true })
    writeFileSync(join(repo, path), text)
  }
  // A plain folder, not a repository: the chat runs in the folder itself.
  const fake = resolve('tests/fixtures/nodeClaude.mjs')
  const created = spawnSync(
    process.execPath,
    [cli, 'token', 'create', 'fixture', '--state-dir', state, '--claude-path', fake, '--json'],
    { encoding: 'utf8' }
  )
  expect(created.status, created.stderr).toBe(0)
  token = (JSON.parse(created.stdout) as { token: string }).token
  console.info('[trace program] setup: installing debugger adapter')
  const installed = spawnSync(
    process.execPath,
    [cli, 'debugger', 'install', 'js', '--state-dir', state, '--json'],
    { encoding: 'utf8', timeout: 60000 }
  )
  console.info(
    '[trace program] setup: adapter install exit',
    installed.status,
    installed.stderr.trim()
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
    daemonErrors = (daemonErrors + b).slice(-2000)
  })
  child.stderr!.on('data', (b) => {
    errors += b
    daemonErrors = (daemonErrors + b).slice(-2000)
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
  evalRaw(
    `(()=>{const api=window.__abeleTest,chats=api.ChatService.getInstance();for(const t of ['abele-trace-run','abele-trace-value','abele-node-file'])for(const l of app.workspace.getLeavesOfType(t))l.detach();for(const id of chats.tabOrder.value.filter(id=>id.startsWith('node:'+${JSON.stringify(registration)}+':')))chats.closeTab(id);if(${JSON.stringify(registration)})api.NodeService.getInstance().remove(${JSON.stringify(registration)});return true})()`
  )
  if (child && child.exitCode === null && child.signalCode === null) {
    const stopped = new Promise<void>((r) => child!.once('exit', () => r()))
    child.kill('SIGTERM')
    await stopped
  }
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/**
 * Runs `program` from the chat menu, picked in the program picker; the files open before it take
 * record points too. `via` is the menu item: Debug asks for a program while the chat has no session.
 */
const RUN = (program: string, shots = '', via = 'Run a program') => `
  const previousProgramSession=api.DebuggerService.instance.active.value?.sessionId;
  document.querySelector('.abele-node-chat [aria-label="More chat actions"]').click();
  await until(()=>item(${JSON.stringify(via)}),${JSON.stringify(via + ' in the menu')});
  ${shots ? `await shot(${JSON.stringify(shots + '-menu')});` : ''}
  press(item(${JSON.stringify(via)}));
  const field=await until(()=>document.querySelector('.modal-container .prompt input.prompt-input'),'program asked');
  field.value=${JSON.stringify(program)};field.dispatchEvent(new Event('input',{bubbles:true}));
  ${shots ? `await shot(${JSON.stringify(shots + '-picker')});` : ''}
  press(await until(()=>[...document.querySelectorAll('.modal-container .prompt .suggestion-item')].find(r=>r.querySelector('.suggestion-title')?.textContent.trim()===${JSON.stringify(program)}),'the program offered'));
  await until(()=>document.querySelector('.modal.abele-modal'),'launch options');
  const stopAtStart=document.querySelector('.modal.abele-modal [role="checkbox"][aria-label="Stop at start"]');
  if(stopAtStart?.getAttribute('aria-checked')==='false') press(stopAtStart);
  press(await until(()=>[...document.querySelectorAll('.modal.abele-modal button')].find(el=>el.textContent.trim()==='Run a program'),'launch options confirmation'));
  await until(()=>{const binding=api.DebuggerService.instance.active.value;return binding?.sessionId&&binding.sessionId!==previousProgramSession},'new debug session',600);
  await until(()=>document.querySelector('[aria-label="Continue (F5)"]'),'debug panel',600);`

/** The call stack as the panel lists it, Node's own frames folded into one row. */
const STACK = `
  const stackRows=()=>{const stack=[...document.querySelectorAll('.abele-debug-panel .tree-item')].find(t=>t.querySelector(':scope > .tree-item-self')?.textContent.trim().startsWith('Call stack'));return stack?[...stack.querySelectorAll(':scope > .tree-item-children > .abele-debug-stack > .tree-item')].map(r=>({text:r.querySelector(':scope > .tree-item-self .abele-tree-item__text')?.textContent.trim()??'',note:r.querySelector(':scope > .tree-item-self .abele-debug-stack__location')?.textContent.trim()??'',flair:r.querySelector(':scope > .tree-item-self .tree-item-flair')?.textContent.trim()??'',internals:r.classList.contains('abele-debug-panel__internals'),active:!!r.querySelector(':scope > .tree-item-self.is-active')})):[]};`

/** Restart in the panel, and whether it can be pressed. */
const RESTART = `const restartButton=()=>document.querySelector('.abele-debug-panel [aria-label^="Restart"]'),restartOn=()=>{const b=restartButton();return !!b&&!b.classList.contains('is-disabled')&&!b.hasAttribute('disabled')};`

/** The run that opened by itself: its steps, and the values of each, read from the step pane. */
const READ_RUN = `
  await until(()=>document.querySelectorAll('.abele-trace-run__steps > .abele-trace-run__step').length>0,'run opened by itself',600).catch(async()=>{const b=api.DebuggerService.instance.active.value,client=nodes.connection(b.registrationId).client,id=b.controller.snapshot?.debug_session_id;let fresh;try{fresh={node:(await client.request('trace.v1.status',{debug_session_id:id})).recording,session:(await client.request('debugger.v1.status',{debug_session_id:id})).snapshot.lifecycle,sessions:(await client.request('debugger.v1.sessions',{conversation_id:b.conversationId})).map(x=>[x.debug_session_id.slice(0,6),x.lifecycle])}}catch(e){fresh=String(e)}throw Error('run did not open: '+debugState0()+' '+JSON.stringify({fresh,runs:b?.trace?.runs?.map(r=>[r.id,r.state,r.steps]),tabs:app.workspace.getLeavesOfType('abele-trace-run').length})+' '+debugState())});
  const rows=[...document.querySelectorAll('.abele-trace-run__steps > .abele-trace-run__step')];
  const steps=[];
  for(const row of rows){
    (row.querySelector('.abele-tree-item__self, .tree-item-self')??row).click();
    await until(()=>document.querySelector('.abele-trace-step'),'step detail');
    await wait(400);
    const values={};for(const v of document.querySelectorAll('.abele-trace-step .abele-trace-value')){const name=v.querySelector('.abele-tree-item__text')?.textContent.trim();if(name&&!(name in values))values[name]=v.querySelector('.abele-tree-item__note')?.textContent.trim()??''}
    steps.push({label:row.querySelector('.abele-tree-item__text')?.textContent.trim()??'',place:document.querySelector('.abele-trace-step__place')?.textContent.trim()??'',values});
  }`

/**
 * The panel's stack while the program is held: its own frames one by one, every run of Node's
 * frames folded into one row that counts them. js-debug holds a program either on its first line or
 * on a statement of its own just before it, so the program's frame need not be on top.
 */
function expectFolded(
  held: { text: string; note: string; flair: string; internals: boolean; active: boolean }[],
  said: string
) {
  const why = JSON.stringify(held) + said
  expect(
    held.some((r) => !r.internals && /^total\.js:\d+$/.test(r.note)),
    why
  ).toBe(true)
  const internals = held.filter((r) => r.internals)
  expect(internals.length, why).toBeGreaterThan(0)
  for (const r of internals) {
    expect(r.text, why).toBe('Node internals')
    expect(Number(r.flair), why).toBeGreaterThan(0)
  }
  // Whichever way it is held, the selected row is the program's own frame, never Node's.
  const selected = held.filter((r) => r.active)
  expect(selected.length, why).toBe(1)
  expect(selected[0].internals, why).toBe(false)
  expect(selected[0].note, why).toMatch(/^total\.js:\d+$/)
  // Two folded rows never stand together: they would be one.
  expect(
    held.some((r, i) => r.internals && held[i + 1]?.internals),
    why
  ).toBe(false)
}

it('runs a JavaScript program picked from Debug, records at a point set in its margin, opens the run by itself, and runs it again on Restart', () => {
  const seen = inApp<{
    steps: { label: string; place: string; values: Record<string, string> }[]
    notes: number
    held: { text: string; note: string; flair: string; internals: boolean; active: boolean }[]
    stop: string
    restartWhileHeld: boolean
    restartAfter: boolean
    again: { session: boolean; steps: number }
  }>(`(async()=>{${prelude}${STACK}${RESTART}
    const notesBefore=app.vault.getMarkdownFiles().length;
    // No session in the chat yet: Debug asks for a program to run.
    ${RUN('src/total.js', '2026-10-14-trace4-debug', 'Debug')}
    await until(()=>stackRows().some(r=>!r.internals),'a frame of the program listed');
    const held=stackRows(),stop=debugState0(),restartWhileHeld=restartOn();
    await shot('2026-10-14-trace4-frames-desktop');
    await recordPoint(4,['sum','item']);
    const trace=api.DebuggerService.instance.active.value.trace;
    const original=trace.points[0].breakpoint_id;
    const editPoint=async()=>{
      const mark=document.querySelector('button.abele-debug-source__point.abele-breakpoint-mark_record')??document.querySelector('button.abele-debug-source__point .abele-breakpoint-mark_record')?.closest('button')??[...document.querySelectorAll('button.abele-debug-source__point')].find(b=>b.getAttribute('aria-label')?.startsWith('Record point'));
      mark.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:40,clientY:200}));
      press(await until(()=>item('Edit'),'Edit record point'));
      return await until(()=>document.querySelector('.abele-trace-point .multi-select-input'),'edit form');
    };
    const custom='globalThis.process.pid';
    const input=await editPoint();
    if(document.querySelector('.abele-trace-point [aria-label="Take '+custom+'"]'))throw Error('custom expression unexpectedly offered');
    input.value=custom;input.dispatchEvent(new Event('input',{bubbles:true}));await wait(100);
    press(document.querySelector('.abele-trace-point [aria-label="Keep (Enter)"]'));
    await until(()=>!document.querySelector('.abele-trace-point')&&trace.points[0]?.take.includes(custom),'custom expression persisted');
    await editPoint();
    await until(()=>[...document.querySelectorAll('.abele-trace-point .multi-select-pill-content')].some(p=>p.textContent===custom),'custom expression prefilled');
    await shot('trace-point-custom-prefilled-desktop');
    press(document.querySelector('.abele-trace-point [aria-label="Leave as it was (Escape)"]'));
    await until(()=>!document.querySelector('.abele-trace-point'),'edit cancelled');
    if(trace.points.length!==1||trace.points[0].breakpoint_id!==original||!trace.points[0].take.includes(custom))throw Error('edit duplicated or cancelled point changed');
    await shot('2026-10-14-trace-margin-live-desktop');
    await goOn();
    ${READ_RUN}
    await shot('2026-10-14-trace-run-real-desktop');
    const out={steps,notes:app.vault.getMarkdownFiles().length-notesBefore,held,stop,restartWhileHeld};
    // Restart starts the same program again from its first line, as a new session that records too.
    const first=api.DebuggerService.instance.active.value.controller.snapshot?.debug_session_id;
    await until(()=>restartOn(),'Restart offered after the run');
    out.restartAfter=restartOn();
    await shot('2026-10-14-trace4-restart-desktop');
    for(const l of app.workspace.getLeavesOfType('abele-trace-run'))l.detach();
    // Closing the run changes layout and can refresh the panel; use its settled, enabled control.
    press(await until(()=>restartOn()&&restartButton(),'Restart enabled after closing the run'));
    await until(()=>{const id=api.DebuggerService.instance.active.value.controller.snapshot?.debug_session_id;return id&&id!==first},'a new session',600).catch(async()=>{await shot('trace-restart-failed-desktop');throw Error('Restart did not select a new session: '+debugState0())});
    await goOn();
    await until(()=>document.querySelectorAll('.abele-trace-run__steps > .abele-trace-run__step').length===3,'the second run opened by itself',600).catch(()=>{const b=api.DebuggerService.instance.active.value;throw Error('second run did not open: '+JSON.stringify({session:b?.sessionId,status:b?.controller.session.status,error:b?.controller.error,points:b?.trace?.points.length,runs:b?.trace?.runs.map(r=>[r.state,r.steps]),tabs:app.workspace.getLeavesOfType('abele-trace-run').length})+' '+debugState())});
    out.again={session:true,steps:document.querySelectorAll('.abele-trace-run__steps > .abele-trace-run__step').length};
    return out
  })()`)
  expect(seen.steps).toHaveLength(3)
  for (const s of seen.steps) expect(s.place).toContain('total.js:4')
  // What the point took at each hit: the sum before the line adds the item's price.
  expect(seen.steps.map((s) => s.values.sum)).toEqual(['0', '2', '5'])
  expect(seen.steps[2]!.values.item).toContain('price')
  // A run never writes a note by itself.
  expect(seen.notes).toBe(0)
  expectFolded(seen.held, seen.stop)
  expect(seen.restartWhileHeld).toBe(true)
  expect(seen.restartAfter).toBe(true)
  expect(seen.again.steps).toBe(3)
})

it('records at a line of TypeScript open beside its build, through the source map', () => {
  const seen = inApp<{
    steps: { label: string; place: string; values: Record<string, string> }[]
  }>(`(async()=>{${prelude}
    for(const t of ['abele-trace-run','abele-trace-value','abele-node-file'])for(const l of app.workspace.getLeavesOfType(t))l.detach();
    const opened=app.workspace.createLeafInParent(app.workspace.rootSplit,0);
    await opened.setViewState({type:'abele-node-file',active:true,state:{kind:'file',target:${JSON.stringify(folder)},path:'src/total.ts'}});
    await until(()=>opened.containerEl.textContent.includes('type Item'),'TypeScript open');
    ${RUN('dist/total.js')}
    // The program's file took the one file tab; going back to the TypeScript there keeps its margin.
    const leaf=app.workspace.getLeavesOfType('abele-node-file')[0];
    await leaf.setViewState({type:'abele-node-file',active:true,state:{kind:'file',target:${JSON.stringify(folder)},path:'src/total.ts'}});
    await until(()=>leaf.containerEl.textContent.includes('type Item'),'TypeScript shown again');
    app.workspace.setActiveLeaf(leaf,{focus:true});
    await wait(300);
    await recordPoint(6,['sum','item'],leaf.containerEl);
    await shot('2026-10-14-trace-margin-ts-desktop');
    const before=debugState0()+' tabs '+JSON.stringify(app.workspace.getLeavesOfType('abele-node-file').map(l=>{const st=l.view.getState();return [st.path,st.debug?.sourceId]}));
    await goOn();
    ${READ_RUN}
    return {steps,before}
  })()`)
  expect(seen.steps, seen.before).toHaveLength(2)
  for (const s of seen.steps) expect(s.place).toContain('total.ts:6')
  expect(seen.steps.map((s) => s.values.sum)).toEqual(['0', '7'])
  expect(seen.steps[1]!.values.item).toContain('label')
})

it('keeps sibling service points pending, routes agent edits by file, and offers only names in scope', async () => {
  const check = (layout: 'desktop' | 'phone') => {
    const seen = inApp<{
      pending: boolean
      applied: boolean
      offers: string[]
      orders: string
      rates: string
      listed: string
    }>(`(async()=>{${prelude}
    const service=api.DebuggerService.instance,target=${JSON.stringify(folder)};
    let orders,rates;
    const agent={nodeScopeIdentity:'sample-multi-process-'+crypto.randomUUID(),overrides:{value:{nodeScope:[{kind:'project',node_id:target.nodeId,project_id:target.projectId,access:'edit'}]}},conversationVersion:{value:0},permissionMode:{value:'allow-edit'}};
    try {
      { ${RUN('packages/orders/src/index.js')} }
      orders=service.active.value;
      const leaf=app.workspace.createLeafInParent(app.workspace.rootSplit,0);
      await leaf.setViewState({type:'abele-node-file',active:true,state:{kind:'file',target,path:'packages/rates/src/index.js'}});
      app.workspace.setActiveLeaf(leaf,{focus:true});
      const mark=await until(()=>marginAt(7,leaf.containerEl),'pending sibling margin');
      mark.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:40,clientY:200}));
      press(await until(()=>item('Add record point'),'pending record menu'));
      await until(()=>document.querySelector('.abele-trace-point'),'pending point editor');
      const offers=[...document.querySelectorAll('.abele-trace-point__offer')].map(el=>el.textContent.trim());
      await shot('trace-multiple-processes-scope-${layout}');
      const take=document.querySelector('.abele-trace-point [aria-label="Take surge"]');
      if(!take)throw Error('surge not offered: '+JSON.stringify(offers));
      press(take);
      press(document.querySelector('.abele-trace-point [aria-label="Keep (Enter)"]'));
      await until(()=>!document.querySelector('.abele-trace-point'),'pending point kept');
      const pending=service.pendingBreakpoints(target,'packages/rates/src/index.js').includes(7)&&!orders.trace.points.length;
      { ${RUN('packages/rates/src/index.js')} }
      rates=service.active.value;
      if(rates===orders||rates.sessionId===orders.sessionId)throw Error('chat launches reused one debug session binding');
      await until(()=>rates.trace?.points.length===1&&!service.pendingBreakpoints(target,'packages/rates/src/index.js').length,'point applied to matching service');
      const applied=service.fileBinding(target,'packages/rates/src/index.js')===rates;
      const call=async(name,p)=>{
        const result=await api.createAgentTools().find(t=>t.name===name).execute('sample-multi',p,undefined,{session:agent});
        if(result.isError)throw Error(name+': '+JSON.stringify(result));
        return result.content[0].text;
      };
      // The person views rates while the agent edits orders, then views orders while it removes rates.
      await call('trace_point_add',{file:'packages/orders/src/index.js',line:2,take:['value']});
      const listed=await call('trace_point_list',{file:'packages/orders/src/index.js'});
      if(!orders.trace.points.length)throw Error('agent point went to the viewed process');
      service.select(orders);
      const beforeRemoval=(await rates.trace.rpc.points(rates.sessionId)).map(p=>p.breakpoint_id);
      if(beforeRemoval.length!==1)throw Error('pending point registered more than once: '+JSON.stringify({trace:beforeRemoval,breakpoints:rates.controller.knownBreakpoints().map(p=>[p.id,p.sourceId,p.requestedLine])}));
      const removed=await call('trace_point_remove',{file:'packages/rates/src/index.js',line:7,session:rates.sessionId});
      const remaining={local:rates.trace.points.map(p=>p.breakpoint_id),node:(await rates.trace.rpc.points(rates.sessionId)).map(p=>p.breakpoint_id)};
      if(remaining.local.length||remaining.node.length)throw Error('agent removal not reflected: '+JSON.stringify({before:beforeRemoval,...remaining})+' '+removed);
      if(orders.trace.points.length!==1)throw Error('removing rates changed orders');
      await call('trace_point_add',{file:'packages/rates/src/index.js',line:7,take:['surge']});
      await call('trace_point_list',{file:'packages/orders/src/index.js'});
      await orders.controller.command('continue');
      await rates.controller.command('continue');
      await until(()=>orders.trace.runs.some(r=>r.steps>0)&&rates.trace.runs.some(r=>r.steps>0),'both processes recorded');
      service.select(rates);
      const ownRun=orders.trace.runs.find(r=>r.debug_session_id===orders.sessionId&&r.steps>0);
      if(!ownRun)throw Error('orders run missing');
      const timeline=await call('trace_timeline',{});
      if(!timeline.includes('run '+ownRun.id))throw Error('implicit timeline read the viewed process: '+timeline);
      const page=await orders.trace.rpc.run(target.projectId,ownRun.id,0,80);
      const fromId=await call('trace_timeline',{run:ownRun.id,from:page.steps[0].id});
      for(const step of page.steps)if(!fromId.includes(step.id+' ·'))throw Error('named-step paging skipped '+step.id);
      await shot('trace-multiple-processes-${layout}');
      return {pending,applied,offers,orders:service.sessionName(orders.controller.snapshot),rates:service.sessionName(rates.controller.snapshot),listed};
    } finally {
      agent.overrides.value={nodeScope:[]};
      for(const binding of [orders,rates])if(binding?.controller.current)await binding.controller.command('stop');
      if(${layout === 'phone'}){
        for(const type of ['abele-debug-view','abele-node-file','abele-trace-run','abele-trace-value'])for(const leaf of app.workspace.getLeavesOfType(type))leaf.detach();
        await app.workspace.requestSaveLayout.run();
      }
    }
  })()`)
    expect(seen.pending).toBe(true)
    expect(seen.applied).toBe(true)
    expect(seen.offers).not.toContain('entry')
    expect(seen.offers).not.toContain('lineTotal')
    expect(seen.orders).toBe('orders/index.js')
    expect(seen.rates).toBe('rates/index.js')
    expect(seen.listed).toContain('packages/orders/src/index.js:2')
  }
  check('desktop')
  await withEmulatedPhone(async () => {
    openChat()
    check('phone')
  })
})

it('on a phone: the picker offers the file open in a tab, the stack folds Node, Restart is offered', async () => {
  await withEmulatedPhone(async () => {
    openChat()
    const seen = inApp<{
      offered: { title: string; note: string }[]
      held: { text: string; note: string; flair: string; internals: boolean; active: boolean }[]
      stop: string
      restart: boolean
      overflow: number
    }>(`(async()=>{${prelude}${STACK}${RESTART}
      try{
      const opened=app.workspace.getLeaf('tab');
      await opened.setViewState({type:'abele-node-file',active:true,state:{kind:'file',target:${JSON.stringify(folder)},path:'src/total.js'}});
      await until(()=>opened.containerEl.textContent.includes('function total'),'program open');
      document.querySelector('.abele-node-chat [aria-label="More chat actions"]').click();
      press(await until(()=>item('Run a program'),'Run a program in the menu'));
      await until(()=>document.querySelector('.modal-container .prompt .suggestion-item'),'program offered');
      const offered=[...document.querySelectorAll('.modal-container .prompt .suggestion-item')].map(r=>({title:r.querySelector('.suggestion-title')?.textContent.trim()??'',note:r.querySelector('.suggestion-note')?.textContent.trim()??''}));
      await shot('2026-10-14-trace4-picker-phone');
      press([...document.querySelectorAll('.modal-container .prompt .suggestion-item')].find(r=>r.querySelector('.suggestion-title')?.textContent.trim()==='src/total.js'));
      await until(()=>document.querySelector('.modal.abele-modal'),'launch options');
      const stopAtStart=document.querySelector('.modal.abele-modal [role="checkbox"][aria-label="Stop at start"]');
      if(stopAtStart?.getAttribute('aria-checked')==='false') press(stopAtStart);
      press(await until(()=>[...document.querySelectorAll('.modal.abele-modal button')].find(el=>el.textContent.trim()==='Run a program'),'launch options confirmation'));
      await until(()=>document.querySelector('[aria-label="Continue (F5)"]'),'debug panel',600);
      await until(()=>stackRows().some(r=>!r.internals),'a frame of the program listed');
      const leaf=app.workspace.getLeavesOfType('abele-debug-view')[0];await app.workspace.revealLeaf(leaf);
      // The drawer slides in: wait until the panel stands still inside the screen.
      let last='';await until(()=>{const r=document.querySelector('.abele-debug-panel').getBoundingClientRect(),now=r.left+','+r.width;const still=now===last&&r.left>=0&&r.right<=innerWidth+1&&r.width>200;last=now;return still},'debug drawer open').catch(()=>console.debug('[debugger] the drawer did not settle before the picture'));
      const held=stackRows(),stop=debugState0();
      const panelGeometry=()=>JSON.stringify([...document.querySelectorAll('.abele-debug-panel, .abele-debug-panel > .nav-header, .abele-debug-panel .nav-buttons-container, .abele-debug-panel .nav-action-button')].map(el=>{const r=el.getBoundingClientRect();return {cls:el.className,label:el.getAttribute('aria-label'),x:r.x,y:r.y,w:r.width,h:r.height,css:{height:getComputedStyle(el).height,position:getComputedStyle(el).position,flex:getComputedStyle(el).flex}}}));
      const controls=[...document.querySelectorAll('.abele-debug-panel .nav-action-button')];
      if(!controls.length||controls.some(el=>{const r=el.getBoundingClientRect();return r.width<=0||r.height<=0||r.left<0||r.right>innerWidth+1||r.top<0||r.bottom>innerHeight}))throw Error('Debugger actions outside phone viewport: '+panelGeometry());
      await shot('2026-10-14-trace4-frames-phone');
      const panel=document.querySelector('.abele-debug-panel'),overflow=panel.scrollWidth-panel.clientWidth;
      press(document.querySelector('.abele-debug-panel [aria-label^="Stop"]'));
      await until(()=>api.DebuggerService.instance.active.value.controller.session.status==='exited','program stopped',600).catch(()=>{throw Error('program not stopped: '+debugState())});
      // Stopped, it can be run again from its first line.
      await until(()=>restartOn(),'Restart offered once stopped');
      const restart=restartOn();
      await shot('2026-10-14-trace4-restart-phone');
      return {offered,held,stop,restart,overflow}
      }finally{
        // The phone's layout is saved apart from the desktop's: leave no tab of this file in it.
        for(const t of ['abele-trace-run','abele-trace-value','abele-node-file','abele-debug-view'])for(const l of app.workspace.getLeavesOfType(t))l.detach();
        await app.workspace.requestSaveLayout.run();
      }
    })()`)
    expect(seen.offered[0]).toMatchObject({ title: 'src/total.js' })
    expectFolded(seen.held, seen.stop)
    expect(seen.restart).toBe(true)
    expect(seen.overflow).toBeLessThanOrEqual(1)
  })
}, 240000)
