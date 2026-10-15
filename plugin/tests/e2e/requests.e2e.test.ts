// The project's saved requests in their own view: a project with none yet, a long collection,
// a request's tab sending through the node to a small service and showing the answer with its
// checks, an error answer, a request that never got through, a key the plugin does not have,
// and the history of sends with an earlier answer compared. Desktop and the emulated phone, with
// a picture of each state. The requests are files the node reads from the project.
import { afterAll, beforeAll, expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
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
const facts=()=>tab()?.querySelector('.abele-http-request__facts')?.textContent.replace(/\\s+/g,' ').trim()??'';
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
let service: Server | undefined
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
let created = 0

const httpFile = (lines: string[]) => lines.join('\n') + '\n'

/** The requests of the project, as files the node reads. */
function writeRequests(root: string) {
  const at = (path: string, text: string) => {
    mkdirSync(join(root, '.abele/requests', path, '..'), { recursive: true })
    writeFileSync(join(root, '.abele/requests', path), text)
  }
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
  // The service the requests go to: it numbers what it creates, so two answers differ.
  service = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const json = (status: number, value: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(value, null, 2))
      }
      if (req.url?.startsWith('/samples/missing')) return json(404, { error: 'No such sample' })
      if (req.method === 'POST' && req.url?.startsWith('/samples')) {
        const sent = JSON.parse(body || '{}') as { qty?: number; label?: string }
        created++
        return json(201, {
          id: `sample-${created}`,
          qty: sent.qty,
          label: sent.label,
          created,
          items: Array.from({ length: created + 1 }, (_, i) => ({ line: i + 1 })),
        })
      }
      json(200, { url: req.url })
    })
  })
  await new Promise<void>((r) => service!.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(service.address() as { port: number }).port}`
  const closed = createServer()
  await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r))
  closedPort = (closed.address() as { port: number }).port
  await new Promise((r) => closed.close(r))

  mkdirSync('../.scratch', { recursive: true })
  dir = realpathSync(mkdtempSync(resolve('../.scratch/requests-')))
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
  if (service) await new Promise((r) => service!.close(r))
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/** Registers the node and both projects; a phone run starts after a reload, so again. */
function connect() {
  const r = evalAsync<{
    registration: string
    project: string
    empty: string
  }>(`(async()=>{${prelude}
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
  }>(
    `(async()=>{${prelude}
    await openRequest('Create sample');
    await until(()=>tab().querySelector('.abele-http-request__to')?.textContent.includes(${JSON.stringify(base)}),'address resolved');
    await send();
    await until(()=>facts().startsWith('201'),'answered 201');
    const body=tab().querySelector('.abele-http-request__body-view')?.textContent??'';
    const checks=answerTab('Checks')?.querySelector('.abele-tabs__badge')?.textContent.trim()??'';
    await shot('2026-10-15-http-answer-desktop');
    const last=await until(()=>row('Create sample')?.querySelector('.abele-requests-panel__last')?.textContent.trim(),'last status in the list');
    const file=require('fs').readdirSync(${JSON.stringify(join(repo, '.abele/requests/.history'))}).length;
    return {facts:facts(),body,checks,last,file:String(file)}
  })()`
  )
  expect(seen.facts).toMatch(/^201 Created \d+ ms/)
  expect(seen.body).toContain('sample-1')
  expect(seen.checks).toBe('2/2')
  expect(seen.last).toBe('201')
  expect(Number(seen.file)).toBeGreaterThan(0)
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
  }>(`(async()=>{${prelude}
    await openRequest('Signed sample');
    const b=tab().querySelector('.abele-http-request__send');
    const missing=!!tab().querySelector('.abele-http-pairs__row_missing');
    await shot('2026-10-15-http-missing-key-desktop');
    return {disabled:b.disabled||b.classList.contains('is-disabled')||b.getAttribute('aria-disabled')==='true',missing,key:tab().querySelector('.abele-http-pairs__secret')?.textContent.trim()??''}
  })()`)
  expect(seen.disabled).toBe(true)
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

it('works the same on a phone: the list in the drawer, a request on the whole screen', async () => {
  await withEmulatedPhone(async () => {
    connect()
    const seen = evalAsync<{
      rows: number
      facts: string
      overflow: number
      error: string
      compared: boolean
    }>(`(async()=>{${prelude}
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
      tab().closest('.view-content').scrollTop=tab().querySelector('.abele-http-request__answer').offsetTop;
      await shot('2026-10-15-http-answer-phone');
      const root=tab(),overflow=root.scrollWidth-root.clientWidth,f=facts();
      (await until(()=>answerTab('History'),'History on the phone')).click();
      const latest=await until(()=>tab().querySelectorAll('.abele-http-request__answer .tree-item')[1],'two sends');
      latest.querySelector('[aria-label="Compare with the answer shown"]').click();
      await until(()=>tab().querySelector('.abele-http-request__compare'),'compared on the phone');
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
      // The phone's layout is saved apart from the desktop's: leave no request tab in it.
      for(const t of ['abele-request','abele-requests'])for(const l of app.workspace.getLeavesOfType(t))l.detach();
      await app.workspace.requestSaveLayout.run();
      return {rows,facts:f,overflow,error,compared}
    })()`)
    expect(seen.rows).toBe(34)
    expect(seen.facts).toMatch(/^201 Created/)
    expect(seen.overflow).toBeLessThanOrEqual(1)
    expect(seen.error).toMatch(/^404/)
    expect(seen.compared).toBe(true)
  })
}, 180000)
