// A run the debugger recorded, opened from the node: its tab of steps, a step's values by shape,
// a value whole in its own tab, and a note about the run in the vault. No program is launched:
// the run is written as the node writes runs, into the project's runs folder, and the node serves
// it. Desktop and the emulated phone, with a picture of each screen.
import { afterAll, beforeAll, expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { evalAsync } from './helpers/githubLive'
import { evalRaw } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
targets('desktop')

const SHOTS = shotDir('abele-trace')
const RUN = '20260102-030405-a1b2c3'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const prelude = `const wait=ms=>new Promise(r=>setTimeout(r,ms)),until=async(fn,what)=>{for(let i=0;i<200;i++){if(fn())return;await wait(50)}throw Error('Trace view did not converge: '+what+'; '+(document.querySelector('.workspace-leaf.mod-active')?.textContent??'').slice(0,600))};
const api=window.__abeleTest,nodes=api.NodeService.getInstance();
const shot=async name=>{await wait(300);const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(SHOTS)}+'/'+name+'.png',image.toPNG())};`

let child: ChildProcess | undefined
let dir = ''
let port = 0
let token = ''
let repo = ''
let registration = ''
let project = ''

/** The run as the node writes one: a timeline of steps and each larger value by its hash. */
function writeRun(root: string) {
  const runDir = join(root, '.abele', 'runs', RUN)
  mkdirSync(join(runDir, 'blobs'), { recursive: true })
  const xml = `<?xml version="1.0"?><contracts>${Array.from(
    { length: 40 },
    (_, i) => `<contract id="C-${100 + i}"><amount>${(i * 12.5).toFixed(2)}</amount></contract>`
  ).join('')}</contracts>`
  const result = JSON.stringify({
    items: Array.from({ length: 40 }, (_, i) => ({ id: `C-${100 + i}`, amount: i * 12.5 })),
    source: 'sample-service',
  })
  const blob = (name: string, text: string, format: string, brief: string) => {
    const sha = createHash('sha256').update(text).digest('hex')
    writeFileSync(join(runDir, 'blobs', sha), text)
    return { name, format, bytes: Buffer.byteLength(text), sha256: sha, brief }
  }
  const xmlValue = blob('xmlText', xml, 'xml', '<contracts>')
  const resultValue = blob('result', result, 'json', '{ items: 40, source }')
  const steps = [
    {
      id: 't0001',
      kind: 'probe',
      ts: '2026-01-02T03:04:05.420Z',
      at: 420,
      label: 'Contracts parsed',
      point: 'bp-sample',
      place: { file: 'src/sample/parse.ts', line: 18, fn: 'parseContracts' },
      stack: ['parseContracts src/sample/parse.ts:18', 'loadContracts src/sample/service.ts:9'],
      paused_ms: 31,
      values: [xmlValue, resultValue],
    },
    {
      id: 't0002',
      kind: 'probe',
      ts: '2026-01-02T03:04:06.100Z',
      at: 1100,
      label: 'Contracts parsed',
      point: 'bp-sample',
      place: { file: 'src/sample/parse.ts', line: 18, fn: 'parseContracts' },
      paused_ms: 12,
      values: [
        xmlValue,
        blob('result', '{"source":"sample-updated"}', 'json', '{ source: "sample-updated" }'),
      ],
    },
    {
      id: 't0003',
      kind: 'error',
      ts: '2026-01-02T03:04:06.300Z',
      at: 1300,
      label: 'SampleError: no rows',
      values: [],
    },
  ]
  // A newer recorder's HTTP fields must survive the plugin's wire boundary.
  const httpDir = join(root, '.abele', 'runs', 'sample-http-run')
  mkdirSync(httpDir, { recursive: true })
  const httpSteps = [
    {
      id: 't0001',
      kind: 'probe',
      ts: '2026-01-02T03:04:05.020Z',
      at: 20,
      label: 'Handle sample',
      chain: 'n1',
      by_time: true,
      values: [],
    },
    {
      id: 't0002',
      kind: 'http',
      ts: '2026-01-02T03:04:05.010Z',
      at: 10,
      label: 'GET /api/sample',
      host: 'localhost:4000',
      direction: 'incoming',
      duration_ms: 50,
      status: 200,
      chain: 'n1',
      values: [],
    },
    {
      id: 't0003',
      kind: 'http',
      ts: '2026-01-02T03:04:05.030Z',
      at: 30,
      label: 'POST /worker/sample',
      host: 'localhost:4001',
      direction: 'outgoing',
      duration_ms: 12,
      status: 503,
      chain: 'n2',
      values: [],
    },
  ]
  writeFileSync(
    join(httpDir, 'timeline.jsonl'),
    httpSteps.map((s) => JSON.stringify(s)).join('\n') + '\n'
  )
  writeFileSync(
    join(httpDir, 'run.json'),
    JSON.stringify({
      version: 1,
      session: 'sample-session',
      id: 'sample-http-run',
      name: 'Sample program requests',
      debug_session_id: 'sample-session',
      started_at: '2026-01-02T03:04:05.000Z',
      length_ms: 100,
      state: 'done',
      steps: 3,
      bytes: 0,
      points: [],
    })
  )
  writeFileSync(
    join(runDir, 'timeline.jsonl'),
    steps.map((s) => JSON.stringify(s)).join('\n') + '\n'
  )
  writeFileSync(
    join(runDir, 'run.json'),
    JSON.stringify({
      version: 1,
      id: RUN,
      name: 'Sample contracts run',
      session: 'sample-debug',
      started_at: '2026-01-02T03:04:05.000Z',
      ended_at: '2026-01-02T03:04:07.000Z',
      length_ms: 2000,
      state: 'done',
      steps: 3,
      bytes: 0,
      points: [
        {
          breakpoint_id: 'bp-sample',
          file: 'src/sample/parse.ts',
          line: 18,
          take: ['xmlText', 'result'],
          note: 'Contracts parsed',
        },
      ],
    })
  )
}

beforeAll(async () => {
  const cli = process.env.ABELE_NODE_CLI
  if (!cli) throw new Error('Set ABELE_NODE_CLI to the built daemon CLI')
  mkdirSync('../.scratch', { recursive: true })
  dir = realpathSync(mkdtempSync(resolve('../.scratch/trace-')))
  repo = resolve(dir, 'repo')
  const state = resolve(dir, 'state')
  mkdirSync(repo)
  writeFileSync(resolve(repo, 'sample.txt'), 'sample')
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
  writeRun(repo)
  const fake = resolve('tests/fixtures/nodeClaude.mjs')
  const created = spawnSync(
    process.execPath,
    [cli, 'token', 'create', 'fixture', '--state-dir', state, '--claude-path', fake, '--json'],
    { encoding: 'utf8' }
  )
  expect(created.status, created.stderr).toBe(0)
  token = (JSON.parse(created.stdout) as { token: string }).token
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
    `(()=>{const api=window.__abeleTest;for(const l of app.workspace.getLeavesOfType('abele-trace-run').concat(app.workspace.getLeavesOfType('abele-trace-value')))l.detach();if(${JSON.stringify(registration)})api.NodeService.getInstance().remove(${JSON.stringify(registration)});return true})()`
  )
  if (child && child.exitCode === null && child.signalCode === null) {
    const stopped = new Promise<void>((r) => child!.once('exit', () => r()))
    child.kill('SIGTERM')
    await stopped
  }
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/** Registers the node and the project in the app; a phone run starts after a reload, so again. */
function connect() {
  const r = evalAsync<{ registration: string; project: string }>(`(async()=>{${prelude}
    const existing=nodes.nodes.value.find(n=>n.label==='Trace fixture');if(existing)nodes.remove(existing.id);
    const node=await nodes.add('Trace fixture','http://127.0.0.1:${port}',${JSON.stringify(token)}),client=nodes.connection(node.id).client;
    const project=await client.registerProject(${JSON.stringify(repo)},'untrusted');
    return {registration:node.id,project:project.project_id}
  })()`)
  registration = r.registration
  project = r.project
}

const OPEN_RUN =
  () => `await api.openTraceRun({registrationId:${JSON.stringify(registration)},projectId:${JSON.stringify(project)},runId:${JSON.stringify(RUN)}});
  await until(()=>document.querySelectorAll('.abele-trace-run__step').length>=2,'steps listed')`

const SEARCH_VALUES = (device: string) => `
    const search=document.querySelector('.abele-trace-run input[type="search"]');
    search.value='sample-service';search.dispatchEvent(new Event('input',{bubbles:true}));
    await until(()=>document.querySelectorAll('.abele-trace-run__step').length===1,'whole recorded value search');
    await shot('trace-value-search-${device}');
    search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));
    await until(()=>document.querySelectorAll('.abele-trace-run__step').length===3,'cleared value search');
    await shot('trace-distinct-hits-${device}');`

it('opens a recorded run as a tab of steps, a step with its values by shape, and a value whole', () => {
  connect()
  const seen = evalAsync<{
    rows: string[]
    place: string
    values: string[]
    wide: { em: number; beside: boolean; under: boolean; overflow: number; rule: number }
    narrow: { em: number; beside: boolean; under: boolean; overflow: number; rule: number }
    shape: boolean
    whole: string
  }>(`(async()=>{${prelude}
    ${OPEN_RUN()}
    const rows=[...document.querySelectorAll('.abele-trace-run__steps > .abele-trace-run__step .abele-tree-item__text')].map(e=>e.textContent.trim());
    await shot('2026-10-14-trace-run-desktop');
    document.querySelector('[aria-label="Only the requests"]').click();
    await until(()=>document.querySelector('.abele-trace-run').textContent.includes('Requests are recorded from a connected browser'),'request capture explanation');
    await shot('trace-requests-empty-desktop');
    document.querySelector('[aria-label="Only the requests"]').click();
    await until(()=>document.querySelectorAll('.abele-trace-run__step').length>=2,'steps restored');
    ${SEARCH_VALUES('desktop')}
    document.querySelector('.abele-trace-run__step .abele-tree-item__self, .abele-trace-run__step .tree-item-self')?.click();
    await until(()=>document.querySelector('.abele-trace-step'),'step detail');
    if(app.workspace.activeLeaf?.view.getViewType()!=='abele-trace-run')throw Error('Selecting a step left the run');
    await until(()=>document.querySelector('.abele-trace-step .abele-trace-shape, .abele-trace-step .abele-trace-value .tree-item-children'),'shape filled');
    const place=document.querySelector('.abele-trace-step__place')?.textContent.trim()??'';
    const values=[...document.querySelectorAll('.abele-trace-step .abele-trace-value > .tree-item-self .abele-tree-item__text, .abele-trace-step .abele-trace-value .abele-tree-item__text')].map(e=>e.textContent.trim()).slice(0,4);
    await shot('2026-10-14-trace-step-desktop');
    // Wide, the step stands beside the list; narrower than 44em, under it.
    const root=document.querySelector('.abele-trace-run'),list=root.querySelector('.abele-trace-run__list'),detail=root.querySelector('.abele-trace-run__detail');
    // Wide with both sidebars folded, narrow beside them: the tab's own width, nothing forced.
    const em=parseFloat(getComputedStyle(root).fontSize),sides=[app.workspace.leftSplit,app.workspace.rightSplit],wasCollapsed=sides.map(x=>x.collapsed);
    const layout=async fold=>{for(const x of sides)fold?x.collapse():x.expand();await wait(600);const l=list.getBoundingClientRect(),d=detail.getBoundingClientRect();return {em:Math.round(root.clientWidth/em),beside:d.left>=l.right-1&&Math.abs(d.top-l.top)<2,under:d.top>=l.bottom-1&&Math.abs(d.left-l.left)<2,overflow:root.scrollWidth-root.clientWidth,rule:parseFloat(getComputedStyle(list).borderRightWidth)||0}};
    let wide,narrow;
    try{
      wide=await layout(true);
      await shot('2026-10-14-trace4-run-wide-desktop');
      narrow=await layout(false);
      await shot('2026-10-14-trace4-run-narrow-desktop');
    }finally{sides.forEach((x,i)=>wasCollapsed[i]?x.collapse():x.expand())}
    await api.openTraceValue({registrationId:${JSON.stringify(registration)},projectId:${JSON.stringify(project)},runId:${JSON.stringify(RUN)},step:'t0001',valueName:'xmlText',view:'whole'});
    await until(()=>document.querySelector('.abele-trace-value-tab')?.textContent.includes('C-100'),'whole value');
    // The text view draws only the lines on screen: the value's last contract shows at its end.
    const tab=document.querySelector('.abele-trace-value-tab');
    await until(()=>{for(const el of [tab.closest('.view-content'),tab,...tab.querySelectorAll('*')])if(el&&el.scrollHeight>el.clientHeight+4){el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'))}return tab.textContent.includes('C-139')},'end of the whole value');
    await shot('2026-10-14-trace-value-desktop');
    return {rows,place,values,wide,narrow,shape:!!document.querySelector('.abele-trace-step'),whole:document.querySelector('.abele-trace-value-tab').textContent.slice(0,200)}
  })()`)
  expect(seen.rows).toEqual([
    'xmlText: <contracts>, result: { items: 40, source } · Contracts parsed',
    'result: { source: "sample-updated" } · Contracts parsed',
    'SampleError: no rows',
  ])
  expect(seen.place).toContain('parse.ts:18')
  expect(seen.values).toContain('xmlText')
  expect(seen.whole).toContain('Sample contracts run')
  expect(seen.wide.em, JSON.stringify(seen.wide)).toBeGreaterThanOrEqual(44)
  expect(seen.wide).toMatchObject({ beside: true, under: false })
  expect(seen.narrow.em, JSON.stringify(seen.narrow)).toBeLessThan(44)
  expect(seen.narrow).toMatchObject({ beside: false, under: true })
  // Under each other the panes are parted by a rule below the steps, none down their side.
  expect(seen.narrow.rule).toBe(0)
  expect(seen.wide.rule).toBeGreaterThan(0)
  expect(seen.wide.overflow).toBeLessThanOrEqual(1)
  expect(seen.narrow.overflow).toBeLessThanOrEqual(1)
})

it('writes a note about the run whose links lead back to the node', () => {
  const note = evalAsync<{ text: string }>(`(async()=>{${prelude}
    const leaf=app.workspace.getLeavesOfType('abele-trace-run')[0];app.workspace.setActiveLeaf(leaf,{focus:true});
    leaf.view.containerEl.querySelector('.view-action[aria-label="Write a note about this run"]').click();
    await until(()=>app.vault.getMarkdownFiles().some(f=>f.path.startsWith('Trace/Sample contracts run')),'note written');
    const file=app.vault.getMarkdownFiles().find(f=>f.path.startsWith('Trace/Sample contracts run'));
    const text=await app.vault.read(file);await app.vault.delete(file);
    for(const l of app.workspace.getLeavesOfType('markdown'))if(l.view.file?.path===file.path)l.detach();
    return {text}
  })()`).text
  expect(note).toContain('Recorded run [Sample contracts run]')
  expect(note).toContain('obsidian://abele-trace?node=')
  expect(note).toContain('### t0001 · Contracts parsed')
  expect(note).toContain('## What happens in this flow')
})

it('writes the note into a folder outside the vault, and writes nothing where that folder is missing', () => {
  const seen = evalAsync<{
    files: string[]
    text: string
    refused: boolean
    missingMade: boolean
    vaultNotes: number
  }>(`(async()=>{${prelude}
    const fs=require('fs'),path=require('path'),os=require('os'),cfg=api.AbeleConfig.getInstance(),before=cfg.traceNotesFolder;
    const out=fs.mkdtempSync(path.join(os.tmpdir(),'trace-notes-'));
    try{
      cfg.traceNotesFolder=out;
      const leaf=app.workspace.getLeavesOfType('abele-trace-run')[0];app.workspace.setActiveLeaf(leaf,{focus:true});
      const write=()=>leaf.view.containerEl.querySelector('.view-action[aria-label="Write a note about this run"]').click();
      write();
      await until(()=>fs.readdirSync(out).some(f=>f.startsWith('Sample contracts run')),'note outside the vault');
      const files=fs.readdirSync(out),text=fs.readFileSync(path.join(out,files[0]),'utf8');
      const missing=path.join(out,'not-on-this-device','runs');
      cfg.traceNotesFolder=missing;
      write();
      await until(()=>[...document.querySelectorAll('.notice')].some(n=>n.textContent.includes('is not on this device')),'refusal said');
      return {files,text,refused:true,missingMade:fs.existsSync(missing),vaultNotes:app.vault.getMarkdownFiles().filter(f=>f.path.startsWith('Trace/Sample contracts run')).length}
    }finally{cfg.traceNotesFolder=before;fs.rmSync(out,{recursive:true,force:true})}
  })()`)
  expect(seen.files).toEqual(['Sample contracts run.md'])
  expect(seen.text).toContain('Recorded run [Sample contracts run]')
  expect(seen.refused).toBe(true)
  expect(seen.missingMade).toBe(false)
  expect(seen.vaultNotes).toBe(0)
})

it('asks the node to run a program and says plainly that it has no JavaScript debugger yet', () => {
  const seen = evalAsync<{ profiles: unknown[]; code: string }>(`(async()=>{${prelude}
    const client=nodes.connection(${JSON.stringify(registration)}).client;
    const profiles=await client.request('debugger.v1.profiles',{});
    let code='started';
    try{await client.request('debugger.v1.start',{operation_id:crypto.randomUUID(),conversation_id:'sample-chat',program:'src/sample/parse.js'})}
    catch(e){code=String(e?.code??e?.message??e)}
    return {profiles,code}
  })()`)
  expect(seen.profiles).toEqual([])
  expect(seen.code).toContain('debugger_profile_unavailable')
})

it('reads the run on a phone: the steps whole-screen, a step over them', async () => {
  await withEmulatedPhone(async () => {
    connect()
    const seen = evalAsync<{
      steps: number
      detail: boolean
      overflow: number
    }>(`(async()=>{${prelude}
      ${OPEN_RUN()}
      await shot('2026-10-14-trace4-run-phone');
      document.querySelector('[aria-label="Only the requests"]').click();
      await until(()=>document.querySelector('.abele-trace-run').textContent.includes('Requests are recorded from a connected browser'),'request capture explanation');
      await shot('trace-requests-empty-phone');
      document.querySelector('[aria-label="Only the requests"]').click();
      await until(()=>document.querySelectorAll('.abele-trace-run__step').length>=2,'steps restored');
      ${SEARCH_VALUES('phone')}
      document.querySelector('.abele-trace-run__step .abele-tree-item__self, .abele-trace-run__step .tree-item-self')?.click();
      await until(()=>document.querySelector('.abele-trace-step'),'step detail');
      if(app.workspace.activeLeaf?.view.getViewType()!=='abele-trace-run')throw Error('Selecting a step left the run');
      await until(()=>document.querySelector('.abele-trace-step .abele-trace-value')?.textContent.includes('xmlText'),'selected step values');
      await shot('2026-10-14-trace4-step-phone');
      const root=document.querySelector('.abele-trace-run');
      const out={steps:document.querySelectorAll('.abele-trace-run__step').length,detail:!!document.querySelector('.abele-trace-step'),overflow:root.scrollWidth-root.clientWidth};
      // The phone's layout is saved apart from the desktop's: leave no run tab in it.
      for(const l of app.workspace.getLeavesOfType('abele-trace-run').concat(app.workspace.getLeavesOfType('abele-trace-value')))l.detach();
      await app.workspace.requestSaveLayout.run();
      return out
    })()`)
    expect(seen.steps).toBeGreaterThanOrEqual(2)
    expect(seen.detail).toBe(true)
    expect(seen.overflow).toBeLessThanOrEqual(1)
  })
}, 180000)

it('shows incoming and outgoing program requests with correlated code on desktop and phone', async () => {
  const check = (device: string) => {
    connect()
    const seen = evalAsync<{
      text: string
      children: number
      overflow: number
    }>(`(async()=>{${prelude}
      // Keep a main tab group when closing the final fixture leaves.
      await app.workspace.getLeaf('tab').setViewState({type:'empty',active:true});
      for(const leaf of app.workspace.getLeavesOfType('abele-trace-run').concat(app.workspace.getLeavesOfType('abele-trace-value')))leaf.detach();
      // Older fixture daemons omit the additive HTTP metadata on read. Supply those two
      // recorded fixture fields at the transport boundary to exercise the newer wire contract.
      const client=nodes.connection(${JSON.stringify(registration)}).client,request=client.request;
      client.request=async function(method,params,...rest){
        const result=await request.call(this,method,params,...rest);
        if(method!=='trace.v1.run'||params.run_id!=='sample-http-run')return result;
        return {...result,steps:result.steps.map(s=>s.kind!=='http'?s:{...s,direction:s.id==='t0002'?'incoming':'outgoing',duration_ms:s.id==='t0002'?50:12})};
      };
      try {
        await api.openTraceRun({registrationId:${JSON.stringify(registration)},projectId:${JSON.stringify(project)},runId:'sample-http-run'});
        await until(()=>document.querySelector('.abele-trace-run')?.textContent.includes('Outgoing'),'program HTTP metadata');
      } finally { client.request=request }

      document.querySelector('[aria-label="Only the requests"]').click();
      await until(()=>document.querySelector('.tree-item-children')?.textContent.includes('Handle sample'),'correlated handler');
      const root=document.querySelector('.abele-trace-run');
      await shot('trace-program-http-${device}');
      return {text:root.textContent,children:root.querySelectorAll('.tree-item-children .abele-trace-run__step').length,overflow:root.scrollWidth-root.clientWidth};
    })()`)
    expect(seen.text).toContain('Incoming')
    expect(seen.text).toContain('Outgoing')
    expect(seen.text).toContain('200')
    expect(seen.text).toContain('503')
    expect(seen.text).toContain('50 ms')
    expect(seen.text).toContain('12 ms')
    expect(seen.children).toBe(1)
    expect(seen.overflow).toBeLessThanOrEqual(1)
  }
  check('desktop')
  await withEmulatedPhone(async () => {
    try {
      check('phone')
    } finally {
      evalAsync(`(async()=>{
        for(const leaf of app.workspace.getLeavesOfType('abele-trace-run').concat(app.workspace.getLeavesOfType('abele-trace-value')))leaf.detach();
        await app.workspace.requestSaveLayout.run();
        return true;
      })()`)
    }
  })
}, 180000)

it('explains a missing run after refresh and a followed value with no matches on both layouts', async () => {
  const check = (device: string) => {
    connect()
    const seen = evalAsync<{ missing: boolean; stale: number }>(`(async()=>{${prelude}
      for(const leaf of app.workspace.getLeavesOfType('abele-trace-run'))leaf.detach();
      ${OPEN_RUN()}
      await api.openTraceRun({registrationId:${JSON.stringify(registration)},projectId:${JSON.stringify(project)},runId:${JSON.stringify(RUN)}},{follow:'sample-value-not-recorded'});
      await until(()=>document.querySelector('.abele-trace-trail')?.textContent.includes('No recorded steps contain this value.'),'empty value trail');
      await shot('trace-follow-no-matches-${device}');
      const fs=require('fs'),path=require('path'),folder=path.join(${JSON.stringify(repo)},'.abele','runs',${JSON.stringify(RUN)}),removed=folder+'-temporarily-removed';
      fs.renameSync(folder,removed);
      try {
        const leaf=app.workspace.getLeavesOfType('abele-trace-run').find(l=>l.view.getState().runId===${JSON.stringify(RUN)});
        leaf.view.containerEl.querySelector('[aria-label="Read the run again"]').click();
        await until(()=>leaf.view.containerEl.textContent.includes('This run is no longer on the node.'),'removed run explanation');
        await shot('trace-removed-run-${device}');
        return {missing:leaf.view.containerEl.textContent.includes('This run is no longer on the node.'),stale:leaf.view.containerEl.querySelectorAll('.abele-trace-run__step').length};
      } finally {
        fs.renameSync(removed,folder);
        for(const leaf of app.workspace.getLeavesOfType('abele-trace-run'))leaf.detach();
      }
    })()`)
    expect(seen).toEqual({ missing: true, stale: 0 })
  }
  check('desktop')
  await withEmulatedPhone(async () => check('phone'))
}, 180000)
