// A saved request sent into a recording: a small service runs under the node's JavaScript
// debugger from a node chat with a record point in its request handler. While it is recorded the
// Requests view says so, a request's tab offers to send into the recording, and the answer says
// how many steps the code took meanwhile; its run opens with the request heading those steps.
// Desktop and the emulated phone. Needs the node to install its pinned JavaScript debugger.
import { afterAll, beforeAll, expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { evalAsync } from './helpers/githubLive'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { evalRaw } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
targets('desktop')

const SHOTS = shotDir('abele-requests')
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
const api=window.__abeleTest,nodes=api.NodeService.getInstance(),chats=api.ChatService.getInstance(),requests=api.requests.service.instance();
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
  await until(()=>takes.every(t=>[...document.querySelectorAll('.abele-trace-point .multi-select-pill-content')].some(p=>p.textContent.trim()===t)),'takes listed');
  press(document.querySelector('.abele-trace-point [aria-label="Keep (Enter)"]'));
  // The first record point of a project asks once where its runs go: the offered folder.
  for(let i=0;i<40;i++){const keep=[...document.querySelectorAll('.modal-container .modal button')].find(b=>b.textContent.trim()==='Keep them here');if(keep){press(keep);break}if(document.querySelector('.abele-breakpoint-mark_record'))break;await wait(50)}
  await until(()=>!document.querySelector('.abele-trace-point'),'point saved');
  const said=()=>[...document.querySelectorAll('button.abele-debug-source__point')].map(b=>b.getAttribute('aria-label')).filter(l=>l&&!l.startsWith('Stop at line')).join(' | ');
  await until(()=>said().startsWith('Record point ·'),'record point confirmed: '+said(),400).catch(()=>{throw Error('record point not confirmed: '+debugState())});
};
window.__dbgLog=[];if(!console.__wrapped){const d=console.debug.bind(console);console.debug=(...a)=>{if(/^\\[(debugger|trace|Abele node)\\]/.test(String(a[0])))window.__dbgLog.push(a.map(x=>x instanceof Error?x.message+' '+(x.code??''):typeof x==='string'?x:JSON.stringify(x)?.slice(0,300)).join(' '));d(...a)};console.__wrapped=true}
const debugState=()=>JSON.stringify({notices:[...document.querySelectorAll('.notice')].map(n=>n.textContent),leaves:app.workspace.getLeavesOfType('abele-node-file').length,debug:app.workspace.getLeavesOfType('abele-debug-view').length})+' '+debugState0()+' '+JSON.stringify(window.__dbgLog.slice(-30));
const debugState0=()=>{const b=api.DebuggerService.instance.active.value,c=b?.controller,n=c?.snapshot;return JSON.stringify({status:c?.session.status,error:c?.error,lifecycle:n?.lifecycle,execution:n?.execution,threads:n?.threads?.map(t=>[t.status,t.stop?.reason,t.stop?.description,t.stop?.hit_breakpoint_ids?.length]),identity:n?.target.build_identity,bps:n?.breakpoints?.map(x=>[x.source_id,x.line,x.status]),known:c?.knownBreakpoints?.().map(x=>[x.sourceId,x.line,x.state,x.file]),points:b?.trace?.points?.map(p=>p.breakpoint_id.slice(0,6)),actions:c?.actions?.slice(-3).map(a=>[a.kind,a.status,a.result])})};
const goOn=async()=>{
  const go=await until(()=>[...document.querySelectorAll('[aria-label="Continue (F5)"]')].find(b=>!b.classList.contains('is-disabled')&&!b.hasAttribute('disabled')),'Continue offered');
  press(go);
};
const panel=()=>document.querySelector('.abele-requests-panel');
const row=name=>[...document.querySelectorAll('.abele-requests-panel__request')].find(r=>r.querySelector('.abele-tree-item__text')?.textContent.trim()===name);
const tab=()=>app.workspace.getLeavesOfType('abele-request').filter(l=>l.view.getState().registrationId===requests.context.value?.registrationId).at(-1)?.view.containerEl.querySelector('.abele-http-request');
const facts=()=>[...(tab()?.querySelector('.abele-http-request__facts')?.children??[])].map(e=>e.textContent.trim()).filter(Boolean).join(' ');`

let child: ChildProcess | undefined
let dir = ''
let port = 0
let token = ''
let repo = ''
let registration = ''
let daemonErrors = ''
let daemonExit = ''
let folder: Record<string, string> = {}

/** The service: it takes an order and answers with its total, worked out on line 9. */
const SERVER = [
  "const http = require('http')",
  "const fs = require('fs')",
  "const path = require('path')",
  "const server = http.createServer((req, res) => { if (req.url === '/health') { res.writeHead(200); res.end('ok'); return }",
  "  let body = ''",
  "  req.on('data', (c) => (body += c))",
  "  req.on('end', () => {",
  "    const order = JSON.parse(body || '{}')",
  '    const total = order.qty * 5',
  "    res.writeHead(201, { 'content-type': 'application/json' })",
  "    res.end(JSON.stringify({ id: 'order-1', total }))",
  '  })',
  '})',
  "server.listen(0, '127.0.0.1', () => {",
  "  fs.writeFileSync(path.join(__dirname, 'port.txt'), String(server.address().port))",
  '})',
  '',
].join('\n')

/** Registers the node, its folder and a chat in the app; a phone run starts after a reload, so again. */
function openChat() {
  const r = evalAsync<{
    registration: string
    target: Record<string, string>
  }>(`(async()=>{${prelude}
    const existing=nodes.nodes.value.find(n=>n.label==='Recording fixture');if(existing)nodes.remove(existing.id);
    const node=await nodes.add('Recording fixture','http://127.0.0.1:${port}',${JSON.stringify(token)}),client=nodes.connection(node.id).client;
    const project=await client.registerProject(${JSON.stringify(repo)},'trusted');
    const workspaces=await client.listWorkspaces(project.project_id),workspace=(workspaces.items??workspaces)[0];
    await client.nodePath.execution({project_id:project.project_id,target:{kind:'workspace',workspace_id:workspace.workspace_id},enabled:true},crypto.randomUUID());
    const s=await client.nodePath.createSession({title:'Recording fixture',provider:'fake',target:{kind:'workspace',workspace_id:workspace.workspace_id}},crypto.randomUUID());
    await chats.openNodeSession({kind:'node-session',registrationId:node.id,nodeId:node.expectedNodeId,sessionId:s.session_id,title:s.title});
    await chats.revealSidebar({focus:false});
    await until(()=>document.querySelector('.abele-node-chat')?.dataset.sessionTitle==='Recording fixture','chat open');
    return {registration:node.id,target:{nodeId:node.expectedNodeId,registrationId:node.id,projectId:project.project_id,kind:'workspace',id:workspace.workspace_id}}
  })()`)
  registration = r.registration
  folder = r.target
}

beforeAll(async () => {
  const cli = process.env.ABELE_NODE_CLI
  if (!cli) throw new Error('Set ABELE_NODE_CLI to the built daemon CLI')
  mkdirSync('../.scratch', { recursive: true })
  dir = realpathSync(mkdtempSync(resolve('../.scratch/requests-recording-')))
  repo = resolve(dir, 'repo')
  const state = resolve(dir, 'state')
  mkdirSync(join(repo, 'src'), { recursive: true })
  writeFileSync(join(repo, 'src/server.js'), SERVER)
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
    `(()=>{const api=window.__abeleTest,chats=api.ChatService.getInstance();for(const t of ['abele-trace-run','abele-trace-value','abele-node-file','abele-request','abele-requests'])for(const l of app.workspace.getLeavesOfType(t))l.detach();app.saveLocalStorage('abele-requests-context',null);for(const id of chats.tabOrder.value.filter(id=>id.startsWith('node:'+${JSON.stringify(registration)}+':')))chats.closeTab(id);if(${JSON.stringify(registration)})api.NodeService.getInstance().remove(${JSON.stringify(registration)});return true})()`
  )
  if (child && child.exitCode === null && child.signalCode === null) {
    const stopped = new Promise<void>((r) => child!.once('exit', () => r()))
    child.kill('SIGTERM')
    await stopped
  }
  if (dir) rmSync(dir, { recursive: true, force: true })
})

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
  await until(()=>document.querySelector('.modal.abele-modal'),'launch options');
  const stopAtStart=document.querySelector('.modal.abele-modal [aria-label="Stop at start"]');if(stopAtStart?.getAttribute('aria-checked')==='false')press(stopAtStart);
  press(await until(()=>[...document.querySelectorAll('.modal-container .modal button')].find(b=>b.textContent.trim()==='Run a program'),'launch options confirmed'));
  await until(()=>{const b=api.DebuggerService.instance.active.value;return b?.sessionId&&b.sessionId!==previousSession},'new debug session',600);
  await until(()=>{const c=api.DebuggerService.instance.active.value?.controller;return c?.session.status==='paused'&&c.session.frames.some(f=>f.file)},'paused program stack ready',600);
  await until(()=>app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.getState().path===${JSON.stringify(program)}&&l.containerEl.querySelector('.abele-debug-source__point')),'debug source loaded',600);
  await until(()=>{const b=document.querySelector('[aria-label="Continue (F5)"]');return b&&b.offsetParent&&!b.disabled},'visible Continue offered',600);`

/** The service's port once it listens, and the request and environment that go to it. */
async function serviceListening() {
  const file = join(repo, 'src/port.txt')
  for (let i = 0; i < 400 && !existsSync(file); i++) await wait(50)
  const servicePort = readFileSync(file, 'utf8').trim()
  const at = (path: string, text: string) => {
    mkdirSync(join(repo, '.abele/requests', path, '..'), { recursive: true })
    writeFileSync(join(repo, '.abele/requests', path), text)
  }
  at(
    'Orders/Place order.http',
    [
      '# @name Place order',
      '# @check status == 201',
      'POST {{base}}/orders',
      'Content-Type: application/json',
      '',
      '{ "qty": 3 }',
      '',
    ].join('\n')
  )
  at('Orders/Health.http', '# @name Health\nGET {{base}}/health\n')
  at(
    'env/local.json',
    JSON.stringify({
      vars: [{ key: 'base', value: `http://127.0.0.1:${servicePort}` }],
      step_header: true,
    })
  )
}

const PAUSED_SEND = (shots: string) => `
  const live=api.DebuggerService.instance.active.value;
  const sourceId=live.controller.knownBreakpoints()[0].sourceId;
  await live.controller.toggleBreakpoint(sourceId,8);
  const requestLeaf=app.workspace.getLeavesOfType('abele-request').find(l=>l.view.getState().registrationId===${JSON.stringify(registration)});
  app.workspace.setActiveLeaf(requestLeaf,{focus:true});
  tab().querySelector('.abele-http-request__send').click();
  await until(()=>live.controller.session.status==='paused'&&tab().querySelector('.abele-http-request__paused'),'request paused').catch(async()=>{
    const diagnostic={error:live.controller.error,status:live.controller.session.status,execution:live.controller.snapshot?.execution,reason:live.controller.session.reason};
    require('fs').writeFileSync(${JSON.stringify(SHOTS)}+'/'+${JSON.stringify(shots)}+'-diagnostic.json',JSON.stringify(diagnostic,null,2));
    await shot(${JSON.stringify(shots + '-pause-unavailable')});
    throw Error('Paused request unavailable: '+JSON.stringify(diagnostic)+' '+debugState());
  });
  ${shots.includes('phone') ? "if(app.workspace.activeLeaf!==requestLeaf)throw Error('Paused request lost behind a source tab');" : 'await wait(31000);'}
  app.workspace.setActiveLeaf(requestLeaf,{focus:true});
  await shot(${JSON.stringify(shots + '-waiting-paused')});
  tab().querySelector('.abele-http-request__paused').click();
  await until(()=>!app.workspace.rightSplit.collapsed,'paused debugger opened in one press');
  await shot(${JSON.stringify(shots + '-paused-debugger')});
  await goOn();
  await until(()=>facts().startsWith('201'),'late answer received',600);
  ${shots.includes('phone') ? '' : "if(!(Number(/(\\d+) ms/.exec(facts())?.[1])>=31000))throw Error('The late answer was lost: '+facts());"}
  await live.controller.toggleBreakpoint(sourceId,8);
  app.workspace.rightSplit.collapse();
  app.workspace.setActiveLeaf(requestLeaf,{focus:true});
  await shot(${JSON.stringify(shots + '-late-answer')});
`

/** The Requests view of this project, the request open, sent into the recording. */
const SEND_INTO = (shots: string, paused = false) => `
  await api.requests.openView();
  if(requests.context.value?.projectId!==${JSON.stringify(folder.projectId)})throw Error('Open requests did not pick the debugger project');
  await until(()=>panel()?.querySelector('.abele-requests-panel__recording'),'recording said in the view',600);
  const recording=panel().querySelector('.abele-requests-panel__recording .abele-tree-item__text').textContent.trim();
  await shot(${JSON.stringify(shots + '-recording-view')});
  const r=await until(()=>row('Place order'),'request listed');
  (r.querySelector('.tree-item-self')??r).click();
  const into=await until(()=>tab()?.querySelector('.abele-http-request__into'),'send into the recording offered');
  await until(()=>into.classList.contains('abele-http-request__into_on'),'recording enabled by default');
  if(into.getAttribute('aria-checked')!=='true'||!tab().querySelector('.abele-http-request__recording').textContent.includes('Record request'))throw Error('Recording switch has no visible state or label');
  into.click();
  await until(()=>into.getAttribute('aria-checked')==='false','recording off');
  await shot(${JSON.stringify(shots + '-recording-off')});
  into.click();
  await until(()=>into.getAttribute('aria-checked')==='true','recording on');
  if(tab().querySelector('.abele-http-request__timeout select').value!=='300000')throw Error('Debugger requests need a five minute default');
  await shot(${JSON.stringify(shots + '-recording')});
  const requestModel=requests.model(requests.context.value),requestId='Orders/Place order.http';
  const previousSend=(await requestModel.rpc.history(${JSON.stringify(folder.projectId)},requestId))[0]?.id;
  tab().querySelector('.abele-http-request__send').click();
  await until(()=>facts().startsWith('201')&&requestModel.entry(requestId).history[0]?.id!==previousSend&&!requestModel.state.sending.includes(requestId),'new send answered',600);
  const steps=await until(()=>tab().querySelector('.abele-http-request__steps')?.textContent.trim(),'steps in code',200);
  await shot(${JSON.stringify(shots + '-into-run')});
  ${paused ? PAUSED_SEND(shots) : ''}
  tab().querySelector('.abele-http-request__steps').click();
  const runLeaf=await until(()=>app.workspace.getLeavesOfType('abele-trace-run').find(l=>l.view.getState().registrationId===${JSON.stringify(registration)}),'run tab opened',400);
  const runEl=runLeaf.containerEl;
  await until(()=>runEl.querySelectorAll('.abele-trace-run__step').length>=2,'run opened',400);
  const top=[...runEl.querySelectorAll('.abele-trace-run__steps > .abele-trace-run__step')].map(e=>e.querySelector('.abele-tree-item__text')?.textContent.trim());
  const under=[...runEl.querySelectorAll('.abele-trace-run__steps > .abele-trace-run__step .abele-trace-run__step .abele-tree-item__text, .abele-trace-run__steps > .abele-trace-run__step .tree-item-children .abele-tree-item__text')].map(e=>e.textContent.trim());
  const byTime=!!runEl.querySelector('.abele-trace-run__by-time');
  runLeaf.containerEl.querySelector('[aria-label="Back to the steps"]')?.click();
  await shot(${JSON.stringify(shots + '-run')});
  runEl.querySelector('.abele-trace-run [aria-label="Only the requests"]').click();
  await until(()=>runEl.querySelector('.abele-trace-run .tree-item-children .abele-trace-run__step'),'request flow retained by filter');
  await shot(${JSON.stringify(shots + '-requests-filter')});
  runEl.querySelector('.abele-trace-run .tree-item-children .abele-trace-run__step .abele-tree-item__text').click();
  await until(()=>runEl.querySelector('.abele-trace-step__title')?.textContent.trim()==='server.js:9'&&[...runEl.querySelectorAll('.abele-trace-value .abele-tree-item__text')].some(e=>e.textContent.trim()==='order'),'step values opened');
  await until(()=>app.workspace.activeLeaf===runLeaf,'step inspected in the run');
  await shot(${JSON.stringify(shots + '-flow-values')});
  const source=await until(()=>runEl.querySelector('.abele-trace-step__source'),'explicit step source link');
  source.click();
  await until(()=>app.workspace.activeLeaf?.getViewState().type==='abele-node-file','step source revealed');
  app.workspace.setActiveLeaf(runLeaf,{focus:true});
  await app.workspace.revealLeaf(runLeaf);
  await until(()=>app.workspace.activeLeaf===runLeaf,'run values visible');
  await shot(${JSON.stringify(shots + '-flow-values')});
  // A confirmed request can be recorded without ever hitting a code record point.
  await api.requests.openView();
  const health=await until(()=>row('Health'),'health request listed');
  (health.querySelector('.tree-item-self')??health).click();
  await until(()=>tab()?.textContent.includes('/health'),'health request open');
  const healthId='Orders/Health.http',previousHealthSend=(await requestModel.rpc.history(${JSON.stringify(folder.projectId)},healthId))[0]?.id;
  tab().querySelector('.abele-http-request__send').click();
  await until(()=>facts().startsWith('200')&&requestModel.entry(healthId).history[0]?.id!==previousHealthSend&&!requestModel.state.sending.includes(healthId),'new health send answered',600);
  const healthLink=await until(()=>tab().querySelector('.abele-http-request__steps'),'recorded request link');
  if(healthLink.textContent.trim()!=='Open recorded request')throw Error('Expected request link without code steps: '+healthLink.textContent);
  await shot(${JSON.stringify(shots + '-recorded-no-code')});
  healthLink.click();
  await until(()=>document.querySelector('.abele-trace-step__title')?.textContent.includes('GET /health'),'recorded request selected',400);
  await shot(${JSON.stringify(shots + '-recorded-request')});`

/** Stops the program, so the next one is the only service listening. */
const STOP = `
  const stop=document.querySelector('.abele-debug-panel [aria-label^="Stop"]');
  if(stop){press(stop);await until(()=>api.DebuggerService.instance.active.value?.controller.session.status==='exited','program stopped',600)}`

it('sends a saved request into the recording of a running service and opens its run with the code steps under it', async () => {
  const started = inApp<{ ok: boolean }>(`(async()=>{${prelude}
    ${RUN('src/server.js')}
    await recordPoint(9,['order']);
    await goOn();
    return {ok:true}
  })()`)
  expect(started.ok).toBe(true)
  await serviceListening()
  const seen = inApp<{
    recording: string
    steps: string
    top: string[]
    under: string[]
    byTime: boolean
  }>(`(async()=>{${prelude}
    ${SEND_INTO('2026-10-15-http-desktop')}
    ${STOP}
    return {recording,steps,top,under,byTime}
  })()`)
  expect(seen.recording).toContain('server.js')
  expect(seen.steps).toBe('1 step in code')
  expect(seen.top[0]).toBe('POST /orders')
  expect(seen.under.length, JSON.stringify(seen)).toBeGreaterThanOrEqual(1)
  expect(seen.byTime).toBe(true)
}, 240000)

async function pausedRequestScene(phone: boolean) {
  openChat()
  rmSync(join(repo, 'src/port.txt'), { force: true })
  inApp(`(async()=>{${prelude}
    ${RUN('src/server.js')}
    await recordPoint(9,['order']);
    await goOn();
    return {ok:true}
  })()`)
  await serviceListening()
  try {
    inApp(`(async()=>{${prelude}
      ${SEND_INTO(phone ? 'http-paused-phone' : 'http-paused-desktop', true)}
      ${STOP}
      return {ok:true}
    })()`)
  } catch (error) {
    console.log('[requests e2e] Paused send diagnostic', error)
    throw error
  } finally {
    evalRaw(
      `(async()=>{for(const t of ['abele-trace-run','abele-trace-value','abele-node-file','abele-debug-view','abele-request','abele-requests'])for(const l of app.workspace.getLeavesOfType(t))l.detach();await app.workspace.requestSaveLayout.run();return true})()`
    )
  }
}

it('retains a paused request beyond 30 seconds and shows its late answer', async () => {
  await pausedRequestScene(false)
}, 240000)

it('opens the paused debugger from a phone request in one press', async () => {
  await withEmulatedPhone(() => pausedRequestScene(true))
}, 240000)

it('on a phone: the recording said in the drawer, the switch beside Send, the steps of the code', async () => {
  await withEmulatedPhone(async () => {
    openChat()
    rmSync(join(repo, 'src/port.txt'), { force: true })
    inApp<{ ok: boolean }>(`(async()=>{${prelude}
      try{
        ${RUN('src/server.js')}
        await recordPoint(9,['order']);
        await goOn();
        return {ok:true}
      }catch(e){
        // The phone's layout is saved apart from the desktop's: leave no tab of this file in it.
        for(const t of ['abele-trace-run','abele-trace-value','abele-node-file','abele-debug-view','abele-request','abele-requests'])for(const l of app.workspace.getLeavesOfType(t))l.detach();
        await app.workspace.requestSaveLayout.run();
        throw e
      }
    })()`)
    await serviceListening()
    const seen = inApp<{ steps: string; top: string[] }>(`(async()=>{${prelude}
      try{
        ${SEND_INTO('2026-10-15-http-phone')}
        ${STOP}
        // A stopped program's run opens by itself: wait for it, so the cleanup below takes it too.
        await until(()=>app.workspace.getLeavesOfType('abele-trace-run').length>1,'ended run opened',60).catch(()=>{});
        return {steps,top}
      }finally{
        for(const t of ['abele-trace-run','abele-trace-value','abele-node-file','abele-debug-view','abele-request','abele-requests'])for(const l of app.workspace.getLeavesOfType(t))l.detach();
        await app.workspace.requestSaveLayout.run();
      }
    })()`)
    expect(seen.steps).toBe('1 step in code')
    expect(seen.top[0]).toBe('POST /orders')
  })
}, 240000)
