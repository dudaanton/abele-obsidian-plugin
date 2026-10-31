import { expect, it } from 'vitest'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { evalLong } from './helpers/obsidianCli'
import { targets } from './helpers/target'

targets('desktop')

const prelude = `const api=window.__abeleTest,nodes=api.NodeService.getInstance();const wait=ms=>new Promise(r=>setTimeout(r,ms));const until=async f=>{for(let i=0;i<2400;i++){if(f())return;await wait(50)}throw Error('Node fixture did not settle')};`

it('opens files and history independently of a large recursive tree refresh against the vendored client', async () => {
  const cli = process.env.ABELE_NODE_CLI
  if (!cli) throw new Error('Set ABELE_NODE_CLI to a built node CLI')
  const dir = mkdtempSync(resolve(realpathSync(tmpdir()), 'node-path-performance-'))
  const home = resolve(dir, 'home'),
    repo = resolve(home, 'sample-repository'),
    state = resolve(dir, 'state')
  mkdirSync(repo, { recursive: true })
  mkdirSync(state, { mode: 0o700 })
  for (let folder = 0; folder < 40; folder++) {
    const nested = resolve(repo, `packages/module-${folder}/src`)
    mkdirSync(nested, { recursive: true })
    for (let file = 0; file < 50; file++)
      writeFileSync(resolve(nested, `sample-${file}.ts`), `export const value = ${file}\n`)
  }
  writeFileSync(resolve(repo, 'sample.ts'), 'export const sample = 1\n')
  const git = (...args: string[]) =>
    promisify(execFile)(
      '/usr/bin/git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=Sample',
        '-c',
        'user.email=sample@example.invalid',
        ...args,
      ],
      { cwd: repo }
    )
  await git('init', '--initial-branch=trunk')
  await git('add', '.')
  await git('commit', '-m', 'Add sample modules')
  for (let file = 0; file < 5; file++)
    writeFileSync(
      resolve(repo, `packages/module-${file}/src/sample-${file}.ts`),
      `export const value = ${file}\nexport const changed = true\n`
    )
  await git('commit', '-am', 'Change sample modules')
  for (let i = 0; i < 23; i++) await git('commit', '--allow-empty', '-m', `Sample history ${i}`)
  await git('worktree', 'add', '-b', 'topic', resolve(home, 'external-copy'))
  let child: ChildProcess | undefined,
    registration = ''
  try {
    child = spawn(
      process.execPath,
      [
        cli,
        'start',
        '--port',
        '0',
        '--state-dir',
        state,
        '--node-name',
        'Sample node',
        '--claude-path',
        resolve(home, 'missing-provider'),
        '--codex-path',
        resolve(home, 'missing-provider'),
        '--json',
      ],
      { env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let output = '',
      errors = ''
    child.stdout!.on('data', (data) => {
      output += data
    })
    child.stderr!.on('data', (data) => {
      errors += data
    })
    for (let i = 0; i < 400 && !output.includes('"listening"'); i++) {
      if (child.exitCode !== null) throw new Error(errors)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    if (!output.includes('"listening"')) throw new Error('Fixture node did not start')
    registration = await evalLong(
      `(async()=>{${prelude}if(nodes.nodes.value.length)throw Error('Use a clean node registry fixture');app.commands.executeCommandById('abele:open-node');await until(()=>app.workspace.getLeavesOfType('abele-node-sidebar')[0]?.view.discovery);const discovery=app.workspace.getLeavesOfType('abele-node-sidebar')[0].view.discovery;const found=discovery.discover(${JSON.stringify(state)});if(!found)throw Error('Fixture local node was not discovered');const node=await discovery.connect(found,'Sample device',{add:(_label,endpoint,token,id)=>nodes.add('Sample node','http://127.0.0.1:'+new URL(endpoint).port,token,id)});return node.id})()`
    )
    const setup = JSON.parse(
      await evalLong(
        `(async()=>{${prelude}const connection=nodes.connection(${JSON.stringify(registration)});const project=await connection.client.nodePath.register({path:${JSON.stringify(repo)},trust:'untrusted',exact_root:true});const worktrees=await connection.client.repository.worktrees({project_id:project.project_id});const root=worktrees.entries.find(w=>w.kind==='root');const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await model.refresh();window.__nodePathFixtureTree=model.select(root.worktree_id);return JSON.stringify({nodeId:nodes.nodes.value.find(n=>n.id===${JSON.stringify(registration)}).expectedNodeId,registrationId:${JSON.stringify(registration)},projectId:project.project_id,kind:'worktree',id:root.worktree_id})})()`
      )
    )
    // Selection itself reads only the root. Opening a nested file may then reveal its ancestors.
    await evalLong(
      `(async()=>{${prelude}const service=api.NodePathService.getInstance(),model=service.model(${JSON.stringify(registration)});await service.ready(${JSON.stringify(registration)});await window.__nodePathFixtureTree;if(model.entries.value.length!==2||model.entries.value.find(e=>e.path==='packages')?.children!==undefined)throw Error('Selection descended beyond its root page');window.__nodePathFixtureTree=model.refresh();return 'root only'})()`
    )
    const measurement = JSON.parse(
      await evalLong(
        `(async()=>{${prelude}const connection=nodes.connection(${JSON.stringify(registration)}),client=connection.client,records=[],methods=['observe','status','blob','content','tree','history'];const originals=methods.map(name=>[name,client.repository[name]]);for(const [name,original] of originals)client.repository[name]=async function(...args){const start=performance.now();try{return await original.apply(this,args)}finally{records.push({name,ms:Math.round(performance.now()-start)})}};try{const start=performance.now(),leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-node-file',active:true,state:${JSON.stringify({ kind: 'file', target: setup, path: 'packages/module-0/src/sample-0.ts' })}});const shellMs=Math.round(performance.now()-start);await until(()=>leaf.view.file?.document.value);const documentMs=Math.round(performance.now()-start);await until(()=>leaf.containerEl.querySelector('.cm-line'));const totalMs=Math.round(performance.now()-start);return JSON.stringify({shellMs,documentMs,totalMs,records})}finally{for(const [name,original]of originals)client.repository[name]=original}})()`
      )
    )
    console.info('Large node repository cold file timing', JSON.stringify(measurement))
    expect(measurement.shellMs).toBeLessThan(500)
    expect(measurement.totalMs).toBeLessThan(10000)
    await evalLong(
      `(async()=>{${prelude}const model=api.NodePathService.getInstance().model(${JSON.stringify(registration)});await api.NodePathService.getInstance().ready(${JSON.stringify(registration)});await window.__nodePathFixtureTree;const expand=async entries=>{for(const entry of entries){if(entry.kind!=='folder')continue;await model.loadFolder(entry.path);while(model.treeCursors.value[entry.path])await model.loadMore(entry.path);const find=list=>list.flatMap(e=>e.path===entry.path?[e]:find(e.children??[]));await expand(find(model.entries.value)[0].children??[])}};await expand(model.entries.value);const walk=entries=>entries.reduce((count,e)=>count+(e.kind==='file'?1:walk(e.children??[])),0);await until(()=>walk(model.entries.value)===2001);if(!model.entries.value.find(e=>e.path==='packages')?.children.find(e=>e.path==='packages/module-0')?.children.find(e=>e.path==='packages/module-0/src')?.children.some(e=>e.path==='packages/module-0/src/sample-0.ts'))throw Error('Nested file missing');return 'complete tree'})()`,
      150000
    )
    const warm = JSON.parse(
      await evalLong(
        `(async()=>{${prelude}const start=performance.now(),leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-node-file',active:true,state:${JSON.stringify({ kind: 'file', target: setup, path: 'sample.ts' })}});const shellMs=Math.round(performance.now()-start);await until(()=>leaf.view.file?.document.value);const documentMs=Math.round(performance.now()-start);await until(()=>leaf.containerEl.querySelector('.cm-line'));return JSON.stringify({shellMs,documentMs,totalMs:Math.round(performance.now()-start)})})()`
      )
    )
    console.info('Large node repository warm file timing', JSON.stringify(warm))
    expect(warm.shellMs).toBeLessThan(500)
    expect(warm.totalMs).toBeLessThan(10000)
    const history = JSON.parse(
      await evalLong(
        `(async()=>{${prelude}const start=performance.now(),leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-node-history',active:true,state:${JSON.stringify({ kind: 'history', target: setup })}});const shellMs=Math.round(performance.now()-start);await until(()=>leaf.view.history?.commits.value.length===25);await until(()=>leaf.containerEl.querySelector('.abele-history__row'));return JSON.stringify({shellMs,totalMs:Math.round(performance.now()-start)})})()`
      )
    )
    console.info('Large node repository history timing', JSON.stringify(history))
    expect(history.shellMs).toBeLessThan(500)
    // A commit page opens on its file list, then fills the diffs in; a big commit lists at once too.
    const openCommit = async (subject: string) =>
      JSON.parse(
        await evalLong(
          `(async()=>{${prelude}const leaf=app.workspace.getLeavesOfType('abele-node-history').at(-1),history=leaf.view.history;history.back();await until(()=>leaf.containerEl.querySelector('.abele-history__row'));const row=[...leaf.containerEl.querySelectorAll('.abele-history__row')].find(r=>r.textContent.includes(${JSON.stringify(subject)}));const start=performance.now();row.click();await until(()=>leaf.containerEl.querySelector('.abele-history__commit-head'));const listMs=Math.round(performance.now()-start);const frame=performance.now();await new Promise(r=>requestAnimationFrame(()=>r()));const frameMs=Math.round(performance.now()-frame);const files=()=>history.commits.value.find(c=>c.hash===history.openCommit.value).files;const count=files().length;const pending=files().filter(f=>f.pending).length;if(count<=10)await until(()=>!files().some(f=>f.pending)&&leaf.containerEl.querySelectorAll('.abele-diff').length===count);const loadedMs=Math.round(performance.now()-start);if(history.error.value)throw Error(history.error.value);history.back();return JSON.stringify({count,pending,listMs,frameMs,loadedMs})})()`,
          150000
        )
      )
    const typical = await openCommit('Change sample modules')
    console.info('Large node repository typical commit timing', JSON.stringify(typical))
    expect(typical.count).toBe(5)
    expect(typical.listMs).toBeLessThan(1000)
    expect(typical.loadedMs).toBeLessThan(5000)
    const big = await openCommit('Add sample modules')
    console.info('Large node repository big commit timing', JSON.stringify(big))
    expect(big.count).toBe(2001)
    expect(big.pending).toBeGreaterThan(1900)
    expect(big.listMs).toBeLessThan(10000)
    expect(big.frameMs).toBeLessThan(1000)
  } finally {
    try {
      await evalLong(
        `(async()=>{${prelude}for(const type of ['abele-node-file','abele-node-history','abele-node-sidebar'])for(const leaf of app.workspace.getLeavesOfType(type))leaf.detach();if(${JSON.stringify(registration)})nodes.remove(${JSON.stringify(registration)});delete window.__nodePathFixtureTree;app.workspace.requestSaveLayout();return 'fixture closed'})()`
      )
    } finally {
      if (child && child.exitCode === null) {
        child.kill('SIGTERM')
        await new Promise<void>((resolve) => child!.once('exit', () => resolve()))
      }
      rmSync(dir, { recursive: true, force: true })
    }
  }
}, 180000)
