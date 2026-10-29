// The project's saved requests in their own view: a project with none yet, a long collection,
// a request's tab sending through the node to a small service and showing the answer with its
// checks, an error answer, a request that never got through, a key the plugin does not have,
// and the history of sends with an earlier answer compared. Desktop and the emulated phone, with
// a picture of each state. The requests are files the node reads from the project.
import { afterAll, beforeAll, expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { evalAsync } from './helpers/githubLive'
import { evalRaw } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
targets('desktop')

const SHOTS = shotDir('abele-requests')
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const prelude = `const wait=ms=>new Promise(r=>setTimeout(r,ms)),until=async(fn,what,tries=300)=>{for(let i=0;i<tries;i++){const v=fn();if(v)return v;await wait(50)}throw Error('Requests did not converge: '+what+'; '+[...document.querySelectorAll('.notice')].map(n=>n.textContent).join(' | ')+' '+(document.querySelector('.workspace-leaf.mod-active')?.textContent??'').slice(0,500))};
const api=window.__abeleTest,nodes=api.NodeService.getInstance(),requests=api.requests.service.instance();
const shot=async name=>{await wait(400);const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(SHOTS)}+'/'+name+'.png',image.toPNG())};
const panel=()=>document.querySelector('.abele-requests-panel');
const row=name=>[...document.querySelectorAll('.abele-requests-panel__request')].find(r=>r.querySelector('.abele-tree-item__text')?.textContent.trim()===name);
let shown;const leafOf=name=>app.workspace.getLeavesOfType('abele-request').find(l=>String(l.view.getState().id??'').endsWith('/'+name+'.http'));
const tab=()=>shown?.view.containerEl.querySelector('.abele-http-request');
const facts=()=>[...(tab()?.querySelector('.abele-http-request__facts')?.children??[])].map(e=>e.textContent.trim()).filter(Boolean).join(' ');
const notice=()=>tab()?.querySelector('.abele-http-request__notice')?.textContent.trim()??'';
const answerTab=label=>[...tab().querySelectorAll('.abele-http-request__answer [role="tab"]')].find(t=>t.querySelector('.abele-tabs__label')?.textContent.trim()===label);
const openRequest=async name=>{
  const r=await until(()=>row(name),'row '+name);
  (r.querySelector('.tree-item-self')??r).click();
  shown=await until(()=>{const l=leafOf(name);return l&&l.view.containerEl.querySelector('.abele-http-request__url')?l:null},'tab of '+name);
};
const send=async()=>{
  const b=await until(()=>{const x=tab()?.querySelector('.abele-http-request__send');return x&&!x.disabled&&!x.classList.contains('is-disabled')?x:null},'Send offered');
  b.click();
  await until(()=>!tab().querySelector('.abele-http-request__send').textContent.includes('Sending'),'answer in',600);
};`

let child: ChildProcess | undefined
let service: ChildProcess | undefined
let dir = ''
let port = 0
let token = ''
let repo = ''
let empty = ''
let base = ''
let closedPort = 0
let registration = ''
let project = ''
let emptyProject = ''
/** The fixture service: prints the port it listens on and one nothing listens on. */
const SERVICE = `
import { createServer } from 'node:http'
let created = 0
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const json = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(value, null, 2))
    }
    if (req.url === '/late') return setTimeout(() => json(200, { answer: 'late sample answer' }), 4500)
    if (req.url.startsWith('/samples/missing')) return json(404, { error: 'No such sample: ' + 'sample-reference '.repeat(12) })
    if (req.method === 'POST' && req.url.startsWith('/samples')) {
      const sent = JSON.parse(body || '{}')
      created++
      return json(201, {
        id: 'sample-' + created,
        reference: 'sample-reference-' + '0123456789'.repeat(8),
        qty: sent.qty,
        label: sent.label,
        created,
        items: Array.from({ length: created + 1 }, (_, i) => ({ line: i + 1 })),
      })
    }
    json(200, { url: req.url })
  })
})
const closed = createServer()
closed.listen(0, '127.0.0.1', () => {
  const free = closed.address().port
  closed.close(() =>
    server.listen(0, '127.0.0.1', () => console.log(server.address().port + ' ' + free))
  )
})
`

const httpFile = (lines: string[]) => lines.join('\n') + '\n'

/** The requests of the project, as files the node reads. */
function writeRequests(root: string) {
  const at = (path: string, text: string) => {
    mkdirSync(join(root, '.abele/requests', path, '..'), { recursive: true })
    writeFileSync(join(root, '.abele/requests', path), text)
  }
  at('Samples/Late answer.http', httpFile(['# @name Late answer', 'GET {{base}}/late']))
  at(
    'Samples/Create sample.http',
    httpFile([
      '# @name Create sample',
      '# @check status == 201',
      '# @check body.qty == 2',
      'POST {{base}}/samples?source=fixture',
      'Content-Type: application/json',
      '',
      '{',
      '  "qty": 2,',
      '  "label": "sample-label"',
      '}',
    ])
  )
  at(
    'Samples/Missing sample.http',
    httpFile(['# @name Missing sample', '# @check status == 200', 'GET {{base}}/samples/missing'])
  )
  at(
    'Samples/Unreachable.http',
    httpFile(['# @name Unreachable', `GET http://127.0.0.1:${closedPort}/samples`])
  )
  at(
    'Samples/Signed sample.http',
    httpFile([
      '# @name Signed sample',
      'GET {{base}}/samples/signed',
      'Authorization: Bearer ${abele_key:sample-absent-key}',
    ])
  )
  for (let i = 1; i <= 30; i++)
    at(
      `Catalogue/Item ${String(i).padStart(2, '0')}.http`,
      httpFile([`# @name Item ${String(i).padStart(2, '0')}`, `GET {{base}}/catalogue/${i}`])
    )
  at('env/local.json', JSON.stringify({ vars: [{ key: 'base', value: base }] }, null, 2))
  at(
    'env/staging.json',
    JSON.stringify({ vars: [{ key: 'base', value: 'http://127.0.0.1:9' }] }, null, 2)
  )
}

function makeRepo(path: string) {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'sample.txt'), 'sample')
  const git = (...args: string[]) => {
    const r = spawnSync('/usr/bin/git', args, { cwd: path, encoding: 'utf8' })
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
}

beforeAll(async () => {
  const cli = process.env.ABELE_NODE_CLI
  if (!cli) throw new Error('Set ABELE_NODE_CLI to the built daemon CLI')
  mkdirSync('../.scratch', { recursive: true })
  dir = realpathSync(mkdtempSync(resolve('../.scratch/requests-')))
  // The service the requests go to, in a process of its own: this one stands still while it waits
  // on the app. It numbers what it creates, so two answers differ.
  const script = resolve(dir, 'service.mjs')
  writeFileSync(script, SERVICE)
  service = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] })
  let said = ''
  service.stdout!.on('data', (b) => (said += b))
  for (let i = 0; !/^\d+ \d+$/m.test(said); i++) {
    if (i > 250 || service.exitCode !== null) throw Error('Fixture service did not start')
    await wait(20)
  }
  const [open, closed] = said.trim().split(/\s+/).map(Number)
  base = `http://127.0.0.1:${open}`
  closedPort = closed!

  repo = resolve(dir, 'repo')
  empty = resolve(dir, 'empty-repo')
  makeRepo(repo)
  makeRepo(empty)
  writeRequests(repo)
  const state = resolve(dir, 'state')
  const fake = resolve('tests/fixtures/nodeClaude.mjs')
  const made = spawnSync(
    process.execPath,
    [cli, 'token', 'create', 'fixture', '--state-dir', state, '--claude-path', fake, '--json'],
    { encoding: 'utf8' }
  )
  expect(made.status, made.stderr).toBe(0)
  token = (JSON.parse(made.stdout) as { token: string }).token
  child = spawn(
    process.execPath,
    [cli, 'start', '--state-dir', state, '--port', '0', '--claude-path', fake, '--json'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let output = ''
  let errors = ''
  child.stdout!.on('data', (b) => (output += b))
  child.stderr!.on('data', (b) => (errors += b))
  for (let i = 0; !output.includes('"listening"'); i++) {
    if (i > 500 || child.exitCode !== null) throw Error(errors || 'Daemon startup deadline')
    await wait(20)
  }
  port = (
    JSON.parse(output.split('\n').find((l) => l.includes('"listening"'))!) as { port: number }
  ).port
}, 60000)

afterAll(async () => {
  evalRaw(
    `(()=>{const api=window.__abeleTest;for(const t of ['abele-request','abele-requests'])for(const l of app.workspace.getLeavesOfType(t))l.detach();app.saveLocalStorage('abele-requests-context',null);if(${JSON.stringify(registration)})api.NodeService.getInstance().remove(${JSON.stringify(registration)});return true})()`
  )
  if (child && child.exitCode === null && child.signalCode === null) {
    const stopped = new Promise<void>((r) => child!.once('exit', () => r()))
    child.kill('SIGTERM')
    await stopped
  }
  if (service && service.exitCode === null) service.kill('SIGTERM')
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/** Registers the node and both projects; a phone run starts after a reload, so again. */
function connect() {
  const r = evalAsync<{
    registration: string
    project: string
    empty: string
  }>(`(async()=>{${prelude}
    for(const leaf of app.workspace.getLeavesOfType('abele-request'))leaf.detach();
    const existing=nodes.nodes.value.find(n=>n.label==='Requests fixture');if(existing)nodes.remove(existing.id);
    const node=await nodes.add('Requests fixture','http://127.0.0.1:${port}',${JSON.stringify(token)}),client=nodes.connection(node.id).client;
    const project=await client.registerProject(${JSON.stringify(repo)},'untrusted');
    const empty=await client.registerProject(${JSON.stringify(empty)},'untrusted');
    return {registration:node.id,project:project.project_id,empty:empty.project_id}
  })()`)
  registration = r.registration
  project = r.project
  emptyProject = r.empty
}

const CHOOSE = (projectId: () => string, label: string) => `
  requests.choose({registrationId:${JSON.stringify(registration)},projectId:${JSON.stringify(projectId())},label:${JSON.stringify(label)},node:'Requests fixture'});
  await api.requests.openView();
  await until(()=>panel()&&panel().querySelector('.abele-requests-panel__project .abele-tree-item__text')?.textContent.trim()===${JSON.stringify(label)},'project shown');`

it('shows a late answer live, after changing tabs and after reopening without resending', () => {
  connect()
  const seen = evalAsync<boolean>(`(async()=>{${prelude}
    ${CHOOSE(() => project, 'repo')}
    await openRequest('Late answer');
    const state=shown.view.getState(),model=requests.model(state);
    model.setTimeout(state.id,1000);
    await send();
    if(!notice().includes('No answer'))throw Error('Expected an unknown outcome before the late answer');
    const sendId=model.entry(state.id).shown;
    await until(()=>facts().includes('200')&&tab().textContent.includes('late sample answer'),'late answer shown live',300);
    if(model.entry(state.id).history[0].status!==200)throw Error('History disagrees with the tab');
    await shot('late-answer-live');
    const other=app.workspace.getLeaf('tab');await other.setViewState({type:'empty',active:true});
    await app.workspace.revealLeaf(shown);
    if(!facts().includes('200'))throw Error('Answer lost after switching tabs');
    shown.detach();await openRequest('Late answer');
    await until(()=>facts().includes('200')&&tab().textContent.includes('late sample answer'),'late answer reopened');
    if(model.entry(state.id).shown!==sendId||model.entry(state.id).history.length!==1)throw Error('Read changed the send identity');
    await shot('late-answer-reopened');
    await send();
    if(!notice().includes('No answer'))throw Error('Expected another unknown outcome');
    const secondId=model.entry(state.id).shown;
    shown.detach();for(const leaf of app.workspace.getLeavesOfType('abele-requests'))leaf.detach();
    await wait(5000);
    await api.requests.openTab(state,state.id);shown=await until(()=>leafOf('Late answer'),'reopened tab');
    await until(()=>facts().includes('200')&&tab().textContent.includes('late sample answer'),'answer read after closing while unknown');
    if(model.entry(state.id).shown!==secondId||model.entry(state.id).history.length!==2)throw Error('Reopening resent or selected a different request');
    await shot('late-answer-closed-while-unknown');other.detach();return true;
  })()`)
  expect(seen).toBe(true)
})

it('gives the agent the timed-out send id for reading its late answer', () => {
  connect()
  const seen = evalAsync<boolean>(`(async()=>{${prelude}
    ${CHOOSE(() => project, 'repo')}
    const chats=api.ChatService.getInstance(),chatId=chats.createTab(),session=chats.getSession(chatId);
    try {
      const connection=nodes.connection(${JSON.stringify(registration)});
      const nodeId=await connection.client.store.transaction(state=>state.node_id);
      await api.giveNodeChatAccess(session,{kind:'project',node_id:nodeId,project_id:${JSON.stringify(project)},access:'run'});
      session.permissionMode.value='allow-all';
      const tools=api.createAgentTools({session}),params={node:${JSON.stringify(registration)},project:${JSON.stringify(project)},id:'Samples/Late answer.http'};
      const sent=(await tools.find(t=>t.name==='http_send').execute('sample-send', {...params,timeout_ms:1000},undefined,{session})).content[0].text;
      const send=/^Send (s[a-z0-9]+) in/.exec(sent)?.[1];
      if(!send||!sent.includes('Outcome unknown'))throw Error('Missing timed-out send identity: '+sent);
      await wait(5000);
      const answer=(await tools.find(t=>t.name==='http_send_result').execute('sample-result',{...params,send},undefined,{session})).content[0].text;
      if(!answer.includes('200')||!answer.includes('late sample answer'))throw Error('Cannot read late answer with returned id: '+answer);
      return true;
    } finally {
      const file=session.currentChatFile.value;chats.closeTab(chatId);if(file)await app.vault.delete(file);
    }
  })()`)
  expect(seen).toBe(true)
})

it('refreshes requests added on disk without reopening the view on either layout', async () => {
  const check = (device: string) => {
    connect()
    const seen = evalAsync<boolean>(`(async()=>{${prelude}
      ${CHOOSE(() => project, 'repo')}
      const fs=require('fs'),path=require('path'),file=path.join(${JSON.stringify(repo)},'.abele','requests','Samples','Disk sample.http');
      fs.writeFileSync(file,${JSON.stringify('# @name Disk sample\nGET http://localhost:4000/sample\n')});
      try {
        panel().querySelector('[aria-label="Refresh requests"]').click();
        await until(()=>panel().textContent.includes('Disk sample'),'new disk request');
        await shot('requests-disk-refresh-${device}');
        row('Disk sample').scrollIntoView({block:'center'});
        await shot('requests-disk-refresh-row-${device}');
        return panel().textContent.includes('Disk sample');
      } finally {
        fs.unlinkSync(file);
        for(const leaf of app.workspace.getLeavesOfType('abele-requests'))leaf.detach();
      }
    })()`)
    expect(seen).toBe(true)
  }
  check('desktop')
  await withEmulatedPhone(async () => check('phone'))
}, 180000)

it('says what to do in a project with no saved requests yet', () => {
  connect()
  const seen = evalAsync<{ empty: string; environment: string }>(`(async()=>{${prelude}
    ${CHOOSE(() => emptyProject, 'empty-repo')}
    await until(()=>panel().querySelector('.abele-requests-panel__empty'),'empty said');
    await shot('2026-10-15-http-empty-desktop');
    return {empty:panel().querySelector('.abele-requests-panel__empty').textContent.trim(),environment:panel().querySelector('.abele-requests-panel__environment .abele-tree-item__text')?.textContent.trim()??''}
  })()`)
  expect(seen.empty).toBe('Save a request to send it again; the agent can make one too.')
  expect(seen.environment).toBe('No environment')
})

it('lists a long collection under its environment, each request with its method', () => {
  const seen = evalAsync<{
    collections: string[]
    rows: number
    methods: string[]
    environment: string
    scrolls: boolean
  }>(`(async()=>{${prelude}
    ${CHOOSE(() => project, 'repo')}
    await until(()=>document.querySelectorAll('.abele-requests-panel__request').length>=34,'every request listed');
    const collections=[...panel().querySelectorAll(':scope > .tree-item:not(.abele-requests-panel__project):not(.abele-requests-panel__environment):not(.abele-requests-panel__recording) > .tree-item-self .abele-tree-item__text')].map(e=>e.textContent.trim());
    const methods=[...panel().querySelectorAll('.abele-requests-panel__request .abele-http-method')].map(e=>e.textContent.trim()).filter(Boolean).slice(0,6);
    const scroller=panel().closest('.view-content');
    await shot('2026-10-15-http-long-desktop');
    return {collections,rows:document.querySelectorAll('.abele-requests-panel__request').length,methods,environment:panel().querySelector('.abele-requests-panel__environment .abele-tree-item__text')?.textContent.trim()??'',scrolls:scroller.scrollHeight>scroller.clientHeight}
  })()`)
  expect(seen.collections).toEqual(['Catalogue', 'Samples'])
  expect(seen.rows).toBe(34)
  expect(seen.environment).toBe('local')
  expect(seen.methods).toContain('GET')
  expect(seen.scrolls).toBe(true)
})

it('sends a request from its tab and shows the answer with its checks', () => {
  const seen = evalAsync<{
    facts: string
    body: string
    checks: string
    last: string
    file: string
    selection: string[]
  }>(
    `(async()=>{${prelude}
    await openRequest('Create sample');
    await until(()=>tab().querySelector('.abele-http-request__to')?.textContent.includes(${JSON.stringify(base)}),'address resolved');
    await send();
    await until(()=>facts().startsWith('201'),'answered 201');
    const body=tab().querySelector('.abele-http-request__body-view')?.textContent??'';
    const checks=answerTab('Checks')?.querySelector('.abele-tabs__badge')?.textContent.trim()??'';
    await shot('2026-10-15-http-answer-desktop');
    answerTab('Headers').click();
    const headers=await until(()=>tab().querySelector('.abele-http-request__headers'),'response headers');
    const selection=[...headers.querySelectorAll('dt,dd,code'),...tab().querySelectorAll('.abele-http-request__facts > span,.abele-http-request__to')].map(e=>getComputedStyle(e).userSelect);
    await shot('http-headers-desktop');
    answerTab('Body').click();
    const last=await until(()=>row('Create sample')?.querySelector('.abele-requests-panel__last')?.textContent.trim(),'last status in the list');
    const file=require('fs').readdirSync(${JSON.stringify(join(repo, '.abele/requests/.history'))}).length;
    return {facts:facts(),body,checks,last,file:String(file),selection}
  })()`
  )
  expect(seen.facts).toMatch(/^201 Created \d+ ms/)
  expect(seen.body).toContain('sample-1')
  expect(seen.checks).toBe('2/2')
  expect(seen.last).toBe('201')
  expect(Number(seen.file)).toBeGreaterThan(0)
  expect(seen.selection.length).toBeGreaterThan(3)
  expect(seen.selection.every((s) => s === 'text')).toBe(true)
})

it('shows an error answer in red and a request that never got through', () => {
  const seen = evalAsync<{ error: string; tone: boolean; failed: string; checks: string }>(
    `(async()=>{${prelude}
    await openRequest('Missing sample');
    await send();
    await until(()=>facts().startsWith('404'),'answered 404');
    const tone=tab().querySelector('.abele-http-request__status').classList.contains('abele-http-request__status_error');
    const checks=answerTab('Checks')?.querySelector('.abele-tabs__badge')?.textContent.trim()??'';
    await shot('2026-10-15-http-error-desktop');
    const error=facts();
    await openRequest('Unreachable');
    await send();
    await until(()=>notice().startsWith('Could not connect'),'refused said');
    await shot('2026-10-15-http-failed-desktop');
    return {error,tone,failed:notice(),checks}
  })()`
  )
  expect(seen.error).toMatch(/^404 Not Found/)
  expect(seen.tone).toBe(true)
  expect(seen.checks).toBe('0/1')
  expect(seen.failed).toMatch(/^Could not connect to 127\.0\.0\.1:\d+/)
})

it('keeps Send off while a key the plugin does not have is named, and says which', () => {
  const seen = evalAsync<{
    disabled: boolean
    missing: boolean
    key: string
    said: string
    openKeys: boolean
  }>(`(async()=>{${prelude}
    await openRequest('Signed sample');
    const b=tab().querySelector('.abele-http-request__send');
    const missing=!!tab().querySelector('.abele-http-pairs__row_missing');
    const said=tab().querySelector('.abele-http-request__why')?.textContent.trim()??'';
    const openKeys=!!tab().querySelector('.abele-http-request__open-keys');
    await shot('2026-10-15-http-missing-key-desktop');
    return {said,openKeys,disabled:b.disabled||b.classList.contains('is-disabled')||b.getAttribute('aria-disabled')==='true',missing,key:tab().querySelector('.abele-http-pairs__secret')?.textContent.trim()??''}
  })()`)
  expect(seen.disabled).toBe(true)
  expect(seen.said).toBe('The key sample-absent-key is not on this device')
  expect(seen.openKeys).toBe(true)
  expect(seen.missing).toBe(true)
  expect(seen.key).toBe('sample-absent-key')
})

it('keeps every send, shows an earlier answer again and compares it with the one shown', () => {
  const seen = evalAsync<{
    sends: number
    shownAt: string
    diff: string
  }>(`(async()=>{${prelude}
    await openRequest('Create sample');
    await send();
    await until(()=>facts().startsWith('201'),'second answer');
    (await until(()=>answerTab('History'),'History offered')).click();
    const rows=await until(()=>{const r=[...tab().querySelectorAll('.abele-http-request__answer .tree-item')];return r.length>=2?r:null},'two sends listed');
    // The earlier one shown again: its time joins the facts.
    (rows[1].querySelector('.tree-item-self')??rows[1]).click();
    await until(()=>tab().querySelectorAll('.abele-http-request__facts .abele-http-request__fact').length>=3,'earlier answer shown');
    const shownAt=facts();
    await shot('2026-10-15-http-history-desktop');
    (await until(()=>answerTab('History'),'History again')).click();
    const latest=(await until(()=>tab().querySelectorAll('.abele-http-request__answer .tree-item')[0],'latest row'));
    latest.querySelector('[aria-label="Compare with the answer shown"]').click();
    const diff=await until(()=>tab().querySelector('.abele-http-request__compare')?.textContent,'compared');
    await shot('2026-10-15-http-compare-desktop');
    return {sends:rows.length,shownAt,diff}
  })()`)
  expect(seen.sends).toBeGreaterThanOrEqual(2)
  expect(seen.shownAt).toMatch(/^201 Created/)
  expect(seen.diff).toContain('Compared with the answer of')
  expect(seen.diff).toMatch(/sample-1|sample-2/)
})

it('imports requests from the clipboard into the view, a clash numbered, nothing read said so', () => {
  const seen = evalAsync<{
    notice: string
    unfolded: boolean
    visible: string[]
    nothing: string
  }>(`(async()=>{${prelude}
    const clip=require('electron').clipboard,was=clip.readText();
    const notices=()=>[...document.querySelectorAll('.notice')].map(n=>n.textContent.trim());
    try{
      clip.writeText(${JSON.stringify(
        [
          '### Archive sample',
          'POST {{base}}/samples',
          'Content-Type: application/json',
          '',
          '{"qty":5}',
          '',
          '### Count samples',
          'GET {{base}}/samples/count',
          '',
        ].join('\n')
      )});
      app.commands.executeCommandById('abele:import-requests');
      await until(()=>notices().find(n=>n.startsWith('Imported')),'first import said');
      await until(()=>row('Count samples'),'first import listed');
      for(const n of document.querySelectorAll('.notice'))n.remove();
      // The same again: nothing is overwritten, each clashing name is numbered.
      app.commands.executeCommandById('abele:import-requests');
      const notice=await until(()=>notices().find(n=>n.startsWith('Imported')),'import said');
      await until(()=>row('Archive sample 2')&&row('Count samples 2'),'imported rows listed');
      const imported=[...document.querySelectorAll('.abele-requests-panel__request')].filter(r=>/^(Archive sample 2|Count samples 2)$/.test(r.querySelector('.abele-tree-item__text')?.textContent.trim()??''));
      const box=panel().closest('.view-content').getBoundingClientRect();
      const visible=imported.filter(r=>{const b=r.getBoundingClientRect();return b.top>=box.top-1&&b.bottom<=box.bottom+1}).map(r=>r.querySelector('.abele-tree-item__text').textContent.trim());
      await shot('2026-10-15-http-import-desktop');
      for(const n of document.querySelectorAll('.notice'))n.remove();
      clip.writeText('hello, nothing to import here');
      app.commands.executeCommandById('abele:import-requests');
      const nothing=await until(()=>notices().find(n=>n.startsWith('The clipboard')),'nothing said');
      return {notice,unfolded:!!row('Archive sample 2')?.offsetParent,visible,nothing};
    }finally{clip.writeText(was)}
  })()`)
  expect(seen.notice).toBe('Imported 2 requests into Imported.')
  expect(seen.unfolded).toBe(true)
  expect(seen.visible.sort()).toEqual(['Archive sample 2', 'Count samples 2'])
  expect(seen.nothing).toBe(
    'The clipboard holds no request: paste a curl command, a .http file, or a Postman, Insomnia or Bruno export'
  )
})

async function scriptPickerScenes(phone: boolean) {
  connect()
  const seen = evalAsync<{
    filtered: boolean
    created: boolean
    changed: boolean
    removed: boolean
    missing: boolean
    height: boolean
    dragged: boolean
    noBody: boolean
    noBodyVisible: boolean
    overflow: number
  }>(`(async()=>{${prelude}
    ${CHOOSE(() => project, 'repo')}
    await openRequest('Create sample');
    await until(()=>!document.querySelector('.notice'),'earlier notices dismissed');
    const context=shown.view.getState(),model=requests.model(context),entry=model.entry(context.id);
    const original=JSON.parse(JSON.stringify(entry.doc)),oldOutcome=entry.outcome;
    const cfg=api.AbeleConfig.getInstance().ai,oldFolder=cfg.scriptsFolder,oldWidth=app.loadLocalStorage('abele-http-request-width'),rightCollapsed=app.workspace.rightSplit.collapsed;
    const folder='RequestPickerFixture',scripts=api.ScriptService.getInstance();
    // Remove only this fixture's files left by an interrupted earlier attempt.
    const leftovers=app.vault.getAbstractFileByPath(folder);
    if(leftovers){
      const oldLeaves=[];app.workspace.iterateAllLeaves(leaf=>{if(leaf.view.getState?.().file?.startsWith(folder+'/'))oldLeaves.push(leaf)});for(const leaf of oldLeaves)leaf.detach();
      for(const file of app.vault.getFiles().filter(f=>f.path.startsWith(folder+'/')))await app.vault.delete(file);
      await app.vault.delete(leftovers,true);
    }
    await app.vault.createFolder(folder);cfg.scriptsFolder=folder;
    const suffix=${JSON.stringify(phone ? 'phone' : 'desktop')};
    const picker=()=>document.querySelector('.abele-request-script-picker');
    const pickRow=text=>[...picker().querySelectorAll('.suggestion-item')].find(e=>e.textContent.includes(text));
    const choose=async text=>{(await until(()=>pickRow(text),'choice '+text)).click();await until(()=>!picker(),'selection closed')};
    const type=async text=>{const input=picker().querySelector('input');input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));await wait(150)};
    const closePicker=async()=>{if(!picker())return;document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));await until(()=>!picker(),'picker closed')};
    const reveal=async()=>{await app.workspace.revealLeaf(shown);app.workspace.setActiveLeaf(shown,{focus:true});await until(()=>app.workspace.activeLeaf===shown&&tab()?.offsetWidth,'request visible')};
    const slot=when=>tab().querySelector('[aria-label="Pick a script to run '+(when==='before'?'before it goes':'after it comes back')+'"]');
    const change=()=>tab().querySelector('[aria-label="Run another script before it goes"]');
    const remove=()=>tab().querySelector('[aria-label="Take it off this request; the script stays"]');
    const saved=()=>require('fs').readFileSync(${JSON.stringify(join(repo, '.abele/requests/Samples/Create sample.http'))},'utf8');
    let filtered=false,created=false,changed=false,removed=false,missing=false,height=true,dragged=true,noBody=false,noBodyVisible=true;
    try{
      if(!${phone})app.workspace.rightSplit.collapse();
      await scripts.discover();
      const fold=[...tab().querySelectorAll('.abele-fold-heading')].find(e=>e.textContent.includes('Scripts'));
      if(!slot('before'))fold.click();
      (await until(()=>slot('before'),'empty slot')).click();
      await until(()=>picker(),'picker');await shot('http-scripts-none-'+suffix);
      await closePicker();
      for(const [file,header] of [['sign','// @request'],['after','// @request'],['ordinary','']])
        await app.vault.create(folder+'/'+file+'.js','// @name Sample '+file+' hook\\n// @description A sample request hook\\n'+header+'\\n');
      await scripts.discover();
      slot('before').click();await until(()=>pickRow('Sample sign hook'),'scripts listed');
      filtered=!picker().textContent.includes('Sample ordinary hook')&&picker().textContent.includes('A sample request hook');
      await shot('http-scripts-picker-'+suffix);
      await type('New sample hook');await until(()=>pickRow('New script'),'new script offered');
      await shot('http-scripts-picker-typed-'+suffix);await choose('New script');
      await until(()=>entry.doc.scripts.before==='New sample hook','new script assigned');
      await until(()=>saved().includes('# @before New sample hook'),'created assignment saved');created=saved().includes('# @before New sample hook')&&scripts.getAll().some(s=>s.meta.name==='New sample hook'&&s.meta.request);
      await reveal();change().click();await until(()=>picker(),'change picker');await choose('Sample sign hook');
      await until(()=>entry.doc.scripts.before==='Sample sign hook','changed');await until(()=>saved().includes('# @before Sample sign hook'),'changed assignment saved');
      changed=saved().includes('# @before Sample sign hook');
      slot('after').click();await until(()=>picker(),'after picker');await choose('Sample after hook');
      await until(()=>entry.doc.scripts.after==='Sample after hook','after assigned');await until(()=>saved().includes('# @after Sample after hook'),'after assignment saved');
      if(${phone})tab().querySelector('.abele-http-request__script').scrollIntoView({block:'center'});
      await shot('http-scripts-'+suffix);
      remove().click();await until(()=>!entry.doc.scripts.before,'removed');await until(()=>!saved().includes('# @before'),'removed assignment saved');
      removed=!saved().includes('# @before')&&saved().includes('# @after Sample after hook')&&!!app.vault.getAbstractFileByPath(folder+'/sign.js');
      await app.vault.delete(app.vault.getAbstractFileByPath(folder+'/after.js'));await scripts.discover();
      await until(()=>tab().querySelector('.abele-http-request__script_problem'),'missing marked');
      missing=tab().querySelector('.abele-http-request__script_problem .tree-item-self').getAttribute('aria-label').includes('There is no script');
      if(${phone})tab().querySelector('.abele-http-request__script_problem').scrollIntoView({block:'center'});
      await shot('http-scripts-problem-'+suffix);
      for(const longRequest of [false,true]){
        model.change(context.id,{...original,headers:longRequest?Array.from({length:30},(_,i)=>({key:'X-Sample-'+i,value:'sample value'})):[]});
        entry.outcome={kind:'answered',response:{status:200,reason:'OK',ms:1,bytes:10,headers:Array.from({length:longRequest?0:30},(_,i)=>({key:'X-Answer-'+i,value:'sample answer'})),body:''}};
        await wait(200);
        if(longRequest){const h=[...tab().querySelectorAll('.abele-fold-heading')].find(e=>e.textContent.includes('Headers'));if(h.getAttribute('aria-expanded')==='false')h.click();answerTab('Body').click()}
        else answerTab('Headers').click();
        await wait(200);
        if(longRequest)noBody=tab().querySelector('.abele-http-request__answer').textContent.includes('No body.');
        if(!${phone}){
          const d=tab().querySelector('.abele-http-request__divider'),a=tab().querySelector('.abele-http-request__answer'),p=tab().querySelector('.abele-http-request__parts');
          height=height&&d.getBoundingClientRect().height>=Math.max(a.getBoundingClientRect().height,p.getBoundingClientRect().height)-1;
          if(!longRequest){
            const box=d.getBoundingClientRect(),before=Number(d.getAttribute('aria-valuenow')),web=require('@electron/remote').getCurrentWebContents();
            const x=Math.round(box.x+box.width/2),y=Math.round(box.y+Math.min(box.height-2,100));
            web.sendInputEvent({type:'mouseMove',x,y});web.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x,y});
            web.sendInputEvent({type:'mouseMove',x:x-60,y});web.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:x-60,y});
            await wait(200);dragged=Number(d.getAttribute('aria-valuenow'))<before&&typeof app.loadLocalStorage('abele-http-request-width')==='number';
          }
        }
        tab().scrollIntoView({block:'start'});await shot('http-'+(longRequest?'long-short':'short-long')+'-'+suffix);
        if(${phone}){
          tab().querySelector('.abele-http-request__answer').scrollIntoView({block:'start'});await shot('http-'+(longRequest?'no-body':'long-answer')+'-'+suffix);
          if(longRequest){const empty=tab().querySelector('.abele-http-request__answer .abele-empty-state'),nav=document.querySelector('.mobile-navbar');noBodyVisible=empty.getBoundingClientRect().bottom<=(nav?.getBoundingClientRect().top??innerHeight)}
        }
      }
      return {filtered,created,changed,removed,missing,height,dragged,noBody,noBodyVisible,overflow:tab().scrollWidth-tab().clientWidth};
    }finally{
      try{await closePicker();model.change(context.id,original);await model.flush(context.id)}finally{
        entry.outcome=oldOutcome;
        try{
          const scriptLeaves=[];app.workspace.iterateAllLeaves(leaf=>{if((leaf.view.file?.path??leaf.view.getState?.().file)?.startsWith(folder+'/'))scriptLeaves.push(leaf)});for(const leaf of scriptLeaves)leaf.detach();
          for(const file of app.vault.getFiles().filter(f=>f.path.startsWith(folder+'/')))await app.vault.delete(file);
          const dir=app.vault.getAbstractFileByPath(folder);if(dir)await app.vault.delete(dir,true);
        }finally{cfg.scriptsFolder=oldFolder;await scripts.discover();app.saveLocalStorage('abele-http-request-width',oldWidth);if(!rightCollapsed)app.workspace.rightSplit.expand()}
      }
    }
  })()`)
  expect(seen).toMatchObject({
    filtered: true,
    created: true,
    changed: true,
    removed: true,
    missing: true,
    height: true,
    dragged: true,
    noBody: true,
    noBodyVisible: true,
  })
  expect(seen.overflow).toBeLessThanOrEqual(1)
}

it('picks, creates, replaces and removes request scripts and drags the full-height divider', async () => {
  await scriptPickerScenes(false)
}, 180000)

it('offers request scripts on the phone with the same persisted assignments', async () => {
  await withEmulatedPhone(() => scriptPickerScenes(true))
}, 180000)

it('works the same on a phone: the list in the drawer, a request on the whole screen', async () => {
  await withEmulatedPhone(async () => {
    connect()
    const seen = evalAsync<{
      rows: number
      facts: string
      overflow: number
      error: string
      compared: boolean
      selection: string
      selectable: string
      controlSelection: string[]
    }>(`(async()=>{${prelude}
      try{
      ${CHOOSE(() => emptyProject, 'empty-repo')}
      await until(()=>panel().querySelector('.abele-requests-panel__empty'),'empty said');
      await shot('2026-10-15-http-empty-phone');
      ${CHOOSE(() => project, 'repo')}
      await until(()=>document.querySelectorAll('.abele-requests-panel__request').length>=34,'every request listed');
      await shot('2026-10-15-http-long-phone');
      const rows=document.querySelectorAll('.abele-requests-panel__request').length;
      await openRequest('Create sample');
      await until(()=>app.workspace.leftSplit.collapsed,'drawer closed');
      await send();
      await until(()=>facts().startsWith('201'),'answered on the phone');
      await until(()=>{const box=tab().querySelector('.abele-http-request__facts').getBoundingClientRect();return box.top>=0&&box.top<200},'answer scrolled above the form');
      const code=tab().querySelector('.abele-http-request__body-view .cm-content');
      if(getComputedStyle(code).whiteSpace!=='pre-wrap')throw Error('Response values do not wrap');
      if(code.scrollWidth>code.clientWidth+2)throw Error('Response ids overflow the phone');
      await shot('2026-10-15-http-answer-phone');
      answerTab('Headers').click();
      const header=await until(()=>tab().querySelector('.abele-http-request__header-value'),'header value');
      header.scrollIntoView({block:'center'});
      const selectable=getComputedStyle(header).userSelect;
      // Desktop Chromium does not produce native phone long-press selection. Show the
      // selected text in the phone layout; native selection handles require WebKit.
      const range=document.createRange();range.selectNodeContents(header);
      const selected=window.getSelection();selected.removeAllRanges();selected.addRange(range);
      const selection=selected.toString();
      const controlSelection=[...tab().querySelectorAll('.abele-fold-heading,.abele-http-request__send')].map(e=>getComputedStyle(e).userSelect);
      await shot('http-header-selection-phone');
      selected.removeAllRanges();
      const root=tab(),overflow=root.scrollWidth-root.clientWidth,f=facts();
      (await until(()=>answerTab('History'),'History on the phone')).click();
      const latest=await until(()=>tab().querySelectorAll('.abele-http-request__answer .tree-item')[1],'two sends');
      // Pressed until it takes: the row's actions settle in on a phone after the tab redraws.
      await until(()=>{if(tab().querySelector('.abele-http-request__compare'))return true;tab().querySelectorAll('.abele-http-request__answer .tree-item')[1]?.querySelector('[aria-label="Compare with the answer shown"]')?.click();return false},'compared on the phone');
      tab().closest('.view-content').scrollTop=tab().querySelector('.abele-http-request__answer').offsetTop;
      await shot('2026-10-15-http-compare-phone');
      const compared=true;
      await api.requests.openView();
      await openRequest('Missing sample');
      await send();
      await until(()=>facts().startsWith('404'),'404 on the phone');
      tab().closest('.view-content').scrollTop=tab().querySelector('.abele-http-request__answer').offsetTop;
      await shot('2026-10-15-http-error-phone');
      const error=facts();
      await api.requests.openView();
      await openRequest('Signed sample');
      await until(()=>tab().querySelector('.abele-http-request__why'),'missing key explained on phone');
      await shot('http-missing-key-phone');
      return {rows,facts:f,overflow,error,compared,selection,selectable,controlSelection}
      }finally{
        // The phone's layout is saved apart from the desktop's: leave no request tab in it.
        for(const t of ['abele-request','abele-requests'])for(const l of app.workspace.getLeavesOfType(t))l.detach();
        await app.workspace.requestSaveLayout.run();
      }
    })()`)
    expect(seen.rows).toBeGreaterThanOrEqual(34)
    expect(seen.facts).toMatch(/^201 Created/)
    expect(seen.overflow).toBeLessThanOrEqual(1)
    expect(seen.error).toMatch(/^404/)
    expect(seen.compared).toBe(true)
    expect(seen.selectable).toBe('text')
    expect(seen.selection).not.toBe('')
    expect(seen.controlSelection.every((s) => s === 'none')).toBe(true)
  })
}, 180000)

it('reads a project request file, sends its chain and writes an edit back on both layouts', async () => {
  const check = (device: string) => {
    connect()
    const path = join(repo, 'sample-chain.http')
    const env = join(repo, 'http-client.env.json')
    writeFileSync(
      path,
      `# @name create\nPOST ${base}/samples\nContent-Type: application/json\n\n{"qty":2}\n### Read created sample\nGET ${base}/samples/{{create.response.body.$.id}}\n### Broken sample\nnot an address\n`
    )
    writeFileSync(env, JSON.stringify({ sample: { base, token: 'fixture-secret' } }))
    try {
      const result = evalAsync<{
        url: string
        edited: boolean
        gone: boolean
      }>(`(async()=>{${prelude}
        let stage='choose project';
        try {
        ${CHOOSE(() => project, 'repo')}
        const c={registrationId:${JSON.stringify(registration)},projectId:${JSON.stringify(project)}},m=requests.model(c);
        stage='load sources';
        await m.load();
        const collection=await until(()=>m.files?.collections.find(c=>c.file.path==='sample-chain.http'),'source collection');
        const [create,read]=collection.requests;
        requests.reveal.value={collection:'sample-chain.http',ids:collection.requests.map(r=>r.id),at:Date.now()};
        await wait(400);
        await shot('file-requests-01-collection-${device}');
        (await until(()=>panel().querySelector('.abele-requests-panel__problem'),'partial read diagnostic')).scrollIntoView({block:'nearest'});
        await shot('file-requests-07-partial-${device}');
        await api.requests.openTab(c,read.id);
        shown=app.workspace.getLeavesOfType('abele-request').find(l=>l.view.getState().id===read.id);
        await until(()=>tab()?.querySelector('.abele-http-request__why')?.textContent.includes('create'),'blocked dependency');
        if(!tab().querySelector('.abele-http-request__send').disabled)throw Error('Dependent Send is enabled');
        await shot('file-requests-03-blocked-${device}');
        stage='send chain';
        await m.sendAll('sample-chain.http',{interactive:true});
        await until(()=>tab()?.querySelector('.abele-http-request__facts')?.textContent.includes('200'),'chain answer');
        const url=m.entry(read.id).outcome.response.body;
        if(!JSON.parse(url).url.startsWith('/samples/sample-'))throw Error('Capture was not substituted: '+url);
        await shot('file-requests-02-request-${device}');
        const answers=[...tab().querySelectorAll('.abele-fold-heading')].find(el=>el.textContent.includes('From answers'));
        if(!tab().querySelector('.abele-http-request__capture'))answers?.click();
        await shot('file-requests-04-answers-${device}');
        const address=tab().querySelector('.abele-http-request__url');
        address.value=${JSON.stringify(base)}+'/samples/edited';
        address.dispatchEvent(new Event('change',{bubbles:true}));
        stage='write back';
        await m.flush(read.id);
        const fs=require('fs');
        const edited=fs.readFileSync(${JSON.stringify(path)},'utf8').includes('/samples/edited');
        if(!edited)throw Error('Edit was not written back');
        stage='send edited request';
        await m.send(read.id,{interactive:true});
        await shot('file-requests-08-edited-${device}');
        stage='open source';
        tab().querySelector('.abele-http-request__origin-link').click();
        await until(()=>document.querySelector('.abele-file-lens__send'),'file send glyphs');
        stage='send from source';
        const history=m.entry(read.id).history.length;
        (await until(()=>[...document.querySelectorAll('.abele-file-lens__send')].find(el=>el.getAttribute('aria-label')==='Send Read created sample'),'source send glyph')).click();
        await until(()=>m.entry(read.id).history.length>history,'glyph send finished');
        await shot('file-requests-05-glyphs-${device}');
        (await until(()=>document.querySelector('[aria-label="Open in Requests"]'),'open in requests action')).click();
        await until(()=>panel(),'requests panel from file');
        stage='select source environment';
        await m.selectEnvironment(m.files.environments.find(e=>e.name==='sample').id);
        panel().querySelector('.abele-requests-panel__environment .tree-item-self')?.click();
        (await until(()=>[...document.querySelectorAll('.menu-item')].find(el=>/Edit.*environment/i.test(el.textContent)),'edit environment menu')).click();
        await until(()=>document.querySelector('.abele-http-env__exposed'),'file secret warning');
        if(document.querySelector('.abele-http-env__exposed').textContent.includes('fixture-secret'))throw Error('Secret is visible');
        await shot('file-requests-06-environment-${device}');
        const environmentDialog=document.querySelector('.abele-http-env__exposed').closest('.modal');
        [...environmentDialog.querySelectorAll('button')].find(button=>button.textContent.trim()==='Cancel').click();
        await until(()=>!document.querySelector('.abele-http-env__exposed'),'environment dialog closed');
        await api.requests.openTab(c,read.id);
        stage='saved request secret preview';
        const saved=await m.create('Samples','File environment preview',{url:'{{base}}/samples/{{token}}'});
        try {
          await api.requests.openTab(c,saved);
          shown=app.workspace.getLeavesOfType('abele-request').find(l=>l.view.getState().id===saved);
          const preview=await until(()=>tab()?.querySelector('.abele-http-request__resolved'),'saved request preview');
          if(preview.textContent.includes('fixture-secret'))throw Error('File environment secret leaked into saved request preview');
          if(!preview.textContent.includes('••••'))throw Error('Secret preview is not masked');
          await shot('file-environment-saved-preview-${device}');
        } finally { await m.remove(saved); }
        await api.requests.openTab(c,read.id);
        shown=app.workspace.getLeavesOfType('abele-request').find(l=>l.view.getState().id===read.id);
        stage='move secret without persistent drafts';
        await m.files.moveSecret(m.files.environments.find(e=>e.name==='sample').id,'token',async()=> 'fixture-file-key');
        if(fs.readFileSync(${JSON.stringify(env)},'utf8').includes('fixture-secret'))throw Error('Secret move did not update source');
        const leaked=await nodes.connection(c.registrationId).client.store.transaction(state=>JSON.stringify(state).includes('fixture-secret'));
        if(leaked)throw Error('Secret move persisted plaintext in the node store');
        stage='remove source';
        fs.unlinkSync(${JSON.stringify(path)});
        await m.refreshFiles();
        const gone=!!m.files.get(read.id).gone;
        await until(()=>tab()?.textContent.includes('sample-chain.http is gone'),'deleted file warning');
        if(!m.entry(read.id).outcome)throw Error('Deleting source lost the last answer');
        await shot('file-requests-09-gone-${device}');
        return {url,edited,gone};
        } catch(error) { throw Error('${device} '+stage+': '+(error?.message??String(error))) }
      })()`)
      expect(result.edited).toBe(true)
      expect(result.gone).toBe(true)
    } finally {
      rmSync(path, { force: true })
      rmSync(env, { force: true })
      evalRaw(
        `(()=>{for(const t of ['abele-request','abele-requests','abele-github'])for(const l of app.workspace.getLeavesOfType(t))l.detach();return true})()`
      )
    }
  }
  check('desktop')
  await withEmulatedPhone(async () => check('phone'))
}, 180000)
