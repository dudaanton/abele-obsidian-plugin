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
import { evalRaw } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
targets('desktop')

const SHOTS = shotDir('abele-trace')
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const prelude = `const wait=ms=>new Promise(r=>setTimeout(r,ms)),until=async(fn,what,tries=300)=>{for(let i=0;i<tries;i++){const v=fn();if(v)return v;await wait(50)}throw Error('Did not converge: '+what+'; '+(document.querySelector('.workspace-leaf.mod-active')?.textContent??'').slice(0,400))};
const api=window.__abeleTest,nodes=api.NodeService.getInstance(),chats=api.ChatService.getInstance();
const shot=async name=>{await wait(300);const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(SHOTS)}+'/'+name+'.png',image.toPNG())};
const item=title=>[...document.querySelectorAll('.menu-item')].find(i=>i.querySelector('.menu-item-title')?.textContent.trim()===title);
const press=el=>{el.click()};
const marginAt=line=>document.querySelector('.workspace-leaf.mod-active button.abele-debug-source__point[aria-label^="Stop at line '+line+' "]')??[...document.querySelectorAll('button.abele-debug-source__point')].find(b=>b.getAttribute('aria-label')?.startsWith('Stop at line '+line+' ')&&b.offsetParent);
const recordPoint=async (line,takes)=>{
  const mark=await until(()=>marginAt(line),'margin of line '+line);
  mark.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:40,clientY:200}));
  press(await until(()=>item('Add record point'),'Add record point'));
  const input=await until(()=>document.querySelector('.abele-trace-point .multi-select-input'),'point editor');
  for(const t of takes){input.focus();input.value=t;input.dispatchEvent(new Event('input',{bubbles:true}));await wait(50);input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await wait(100)}
  input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  await until(()=>!document.querySelector('.abele-trace-point'),'point saved');
  await until(()=>document.querySelector('.abele-breakpoint-mark_record.abele-breakpoint-mark_set, .abele-breakpoint-mark_record.abele-breakpoint-mark_verified'),'record point confirmed');
};
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
let session = ''

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
    'dist/total.js':
      built.outputText.replace(/\/\/# sourceMappingURL=.*$/m, '') +
      '\n//# sourceMappingURL=total.js.map\n',
    'dist/total.js.map': JSON.stringify(map),
  })) {
    mkdirSync(join(repo, path, '..'), { recursive: true })
    writeFileSync(join(repo, path), text)
  }
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
  child.stdout!.on('data', (b) => (output += b))
  child.stderr!.on('data', (b) => (errors += b))
  for (let i = 0; !output.includes('"listening"'); i++) {
    if (i > 500 || child.exitCode !== null) throw Error(errors || 'Daemon startup deadline')
    await wait(20)
  }
  port = (
    JSON.parse(output.split('\n').find((l) => l.includes('"listening"'))!) as { port: number }
  ).port
  const r = evalAsync<{ registration: string; session: string }>(`(async()=>{${prelude}
    const existing=nodes.nodes.value.find(n=>n.label==='Program fixture');if(existing)nodes.remove(existing.id);
    const node=await nodes.add('Program fixture','http://127.0.0.1:${port}',${JSON.stringify(token)}),client=nodes.connection(node.id).client;
    const project=await client.registerProject(${JSON.stringify(repo)},'trusted');
    const workspaces=await client.listWorkspaces(project.project_id),workspace=(workspaces.items??workspaces)[0];
    await client.nodePath.execution({project_id:project.project_id,target:{kind:'workspace',workspace_id:workspace.workspace_id},enabled:true},crypto.randomUUID());
    const s=await client.createSession('Program fixture',workspace.workspace_id);
    await chats.openNodeSession({kind:'node-session',registrationId:node.id,nodeId:node.expectedNodeId,sessionId:s.session_id,title:s.title});
    await chats.revealSidebar({focus:false});
    await until(()=>document.querySelector('.abele-node-chat__title')?.textContent==='Program fixture','chat open');
    return {registration:node.id,session:s.session_id}
  })()`)
  registration = r.registration
  session = r.session
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

/** Runs `program` from the chat menu; the files open before it take record points too. */
const RUN = (program: string, shotMenu = '') => `
  document.querySelector('.abele-node-chat [aria-label="Node session menu"]').click();
  await until(()=>item('Run a program'),'Run a program in the menu');
  ${shotMenu ? `await shot(${JSON.stringify(shotMenu)});` : ''}
  press(item('Run a program'));
  const field=await until(()=>document.querySelector('.modal-container .modal input'),'program asked');
  field.value=${JSON.stringify(program)};field.dispatchEvent(new Event('input',{bubbles:true}));
  ${shotMenu ? `await shot(${JSON.stringify(shotMenu + '-dialog')});` : ''}
  press(await until(()=>[...document.querySelectorAll('.modal-container .modal button')].find(b=>b.textContent.trim()==='Run'),'Run button'));
  await until(()=>document.querySelector('[aria-label="Continue (F5)"]'),'debug panel',600);`

/** The run that opened by itself: its steps, and the values of each, read from the step pane. */
const READ_RUN = `
  await until(()=>document.querySelectorAll('.abele-trace-run__steps > .abele-trace-run__step').length>0,'run opened by itself',600);
  const rows=[...document.querySelectorAll('.abele-trace-run__steps > .abele-trace-run__step')];
  const steps=[];
  for(const row of rows){
    (row.querySelector('.abele-tree-item__self, .tree-item-self')??row).click();
    await until(()=>document.querySelector('.abele-trace-step'),'step detail');
    await wait(400);
    steps.push({label:row.querySelector('.abele-tree-item__text')?.textContent.trim()??'',place:document.querySelector('.abele-trace-step__place')?.textContent.trim()??'',text:document.querySelector('.abele-trace-step')?.textContent??''});
  }`

it('runs a JavaScript program from the chat menu, records at a point set in its margin, and opens the run by itself', () => {
  const seen = evalAsync<{
    steps: { label: string; place: string; text: string }[]
    notes: number
  }>(`(async()=>{${prelude}
    const notesBefore=app.vault.getMarkdownFiles().length;
    ${RUN('src/total.js', '2026-10-14-trace-run-program-menu')}
    await recordPoint(4,['sum','item']);
    await shot('2026-10-14-trace-margin-live-desktop');
    await goOn();
    ${READ_RUN}
    await shot('2026-10-14-trace-run-real-desktop');
    return {steps,notes:app.vault.getMarkdownFiles().length-notesBefore}
  })()`)
  expect(seen.steps).toHaveLength(3)
  for (const s of seen.steps) expect(s.place).toContain('total.js:4')
  // What the point took at each hit: the sum before the line adds the item's price.
  expect(seen.steps.map((s) => /sum\s*([0-9]+)/.exec(s.text)?.[1])).toEqual(['0', '2', '5'])
  expect(seen.steps[2]!.text).toContain('price')
  // A run never writes a note by itself.
  expect(seen.notes).toBe(0)
})

it('records at a line of TypeScript open beside its build, through the source map', () => {
  const seen = evalAsync<{
    steps: { label: string; place: string; text: string }[]
  }>(`(async()=>{${prelude}
    for(const t of ['abele-trace-run','abele-trace-value','abele-node-file'])for(const l of app.workspace.getLeavesOfType(t))l.detach();
    const presenter=chats.getNodeSession(chats.activeTabId.value);
    presenter.openResource('src/total.ts');
    await until(()=>[...document.querySelectorAll('.workspace-leaf')].some(l=>l.textContent.includes('type Item')),'TypeScript open');
    ${RUN('dist/total.js')}
    // The TypeScript tab takes the point: bring it forward.
    const leaf=app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.containerEl.textContent.includes('type Item'));
    app.workspace.setActiveLeaf(leaf,{focus:true});
    await wait(300);
    await recordPoint(6,['sum','item.label']);
    await shot('2026-10-14-trace-margin-ts-desktop');
    await goOn();
    ${READ_RUN}
    return {steps}
  })()`)
  expect(seen.steps).toHaveLength(2)
  for (const s of seen.steps) expect(s.place).toContain('total.ts:6')
  expect(seen.steps.map((s) => /sum\s*([0-9]+)/.exec(s.text)?.[1])).toEqual(['0', '7'])
  expect(seen.steps[1]!.text).toContain('second')
})
