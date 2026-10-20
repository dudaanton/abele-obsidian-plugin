import { expect, it } from 'vitest'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { evalLong } from './helpers/obsidianCli'
import { targets } from './helpers/target'

targets('desktop')
const cli = process.env.ABELE_NODE_CLI
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const prelude = `const api=window.__abeleTest,nodes=api.NodeService.getInstance();const wait=ms=>new Promise(r=>setTimeout(r,ms));const until=async f=>{for(let i=0;i<200;i++){if(f())return;await wait(50)}throw Error('Repository tree did not settle: '+f.toString())};const tree=()=>document.querySelector('.abele-node-sidebar .abele-file-tree');const row=p=>tree()?.querySelector('.tree-item-self[data-path="'+p+'"]');`
it('keeps an opened folder, its rows and the scroll of the file tree through node refreshes', async () => {
  if (!cli) throw new Error('Set ABELE_NODE_CLI to the built node CLI')
  mkdirSync('../.scratch', { recursive: true })
  const dir = mkdtempSync(resolve('../.scratch/t-')),
    projectPath = resolve(dir, 'sample-project')
  mkdirSync(resolve(projectPath, 'src'), { recursive: true })
  mkdirSync(resolve(projectPath, 'docs'))
  const git = (...args: string[]) =>
    promisify(execFile)('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: projectPath,
    })
  await git('init', '--initial-branch=main')
  for (let i = 10; i < 90; i++)
    writeFileSync(resolve(projectPath, `src/sample-${i}.ts`), `export const value = ${i}\n`)
  writeFileSync(resolve(projectPath, 'docs/guide.md'), '# Sample guide\n')
  writeFileSync(resolve(projectPath, 'README.md'), '# Sample repository\n')
  writeFileSync(resolve(projectPath, 'notes.txt'), 'first\n')
  await git('add', '.')
  await git(
    '-c',
    'user.name=Sample',
    '-c',
    'user.email=sample@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Add sample files'
  )
  let child: ChildProcess | undefined
  const env = { ...process.env, ABELE_CLAUDE_PATH: resolve('tests/fixtures/nodeClaude.mjs') }
  try {
    const enrolled = JSON.parse(
      (
        await promisify(execFile)(
          process.execPath,
          [cli, 'token', 'create', 'sample-reader', '--state-dir', dir, '--json'],
          { env }
        )
      ).stdout
    )
    child = spawn(process.execPath, [cli, 'start', '--state-dir', dir, '--port', '0', '--json'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = '',
      errors = ''
    child.stdout!.on('data', (data) => {
      output += data
    })
    child.stderr!.on('data', (data) => {
      errors += data
    })
    for (let i = 0; i < 300 && !output.includes('"listening"'); i++) {
      if (child.exitCode !== null) throw new Error(errors)
      await pause(20)
    }
    const ready = JSON.parse(output.split('\n').find((line) => line.includes('"listening"'))!)
    await evalLong(`(async()=>{${prelude}
      const node=await nodes.add('Sample tree node','http://127.0.0.1:${ready.port}',${JSON.stringify(enrolled.token)});
      window.__sampleTreeNode=node.id;
      const client=nodes.connection(node.id).client,project=await client.registerProject(${JSON.stringify(projectPath)},'trusted');
      window.__sampleTreeEvents=[];
      window.__sampleTreeStop=client.onEvent(event=>{if(event.type.startsWith('repository.')){window.__sampleTreeEvents.push({type:event.type,data:event.data});if(window.__sampleTreeEvents.length>12)window.__sampleTreeEvents.shift()}});
      const catalogue=await client.repository.worktrees({project_id:project.project_id});
      const workspace=catalogue.entries.find(w=>w.kind==='root');
      // The folder as a whole opens in the node panel, whose Files mode is its whole file tree.
      await api.openNodeRepository(node.id,project.project_id,workspace.worktree_id);
      await until(()=>document.querySelector('.abele-node-sidebar .abele-node-place__name')?.textContent.trim()==='main');
      const files=document.querySelector('.abele-node-sidebar .abele-node-modes [role="tab"][aria-label="Files"]');
      if(!files)throw Error('No Files mode in the node panel');
      if(files.getAttribute('aria-selected')!=='true')files.click();
      await until(()=>row('src'));
      row('src').click();
      await until(()=>row('src/sample-89.ts'));
      const body=tree().querySelector('.abele-file-tree__body');
      if(body.scrollHeight-body.clientHeight<200)throw Error('The tree is not tall enough to scroll');
      body.scrollTop=200;await wait(100);
      window.__sampleTreeScroll=body.scrollTop;window.__sampleTreeRow=row('src/sample-50.ts');window.__sampleTreeBody=body;
      return 'opened';
    })()`)
    // Several refresh cycles from changes outside the opened folder.
    for (let i = 0; i < 3; i++) {
      writeFileSync(resolve(projectPath, 'notes.txt'), `change ${i}\n`)
      await pause(2500)
    }
    // A change inside it, which has to appear in place.
    writeFileSync(resolve(projectPath, 'src/sample-99.ts'), 'export const value = 99\n')
    const state = JSON.parse(
      await evalLong(`(async()=>{${prelude}
      try { await until(()=>row('src/sample-99.ts')); } catch(error) {
        const connection=nodes.connection(window.__sampleTreeNode),model=api.NodePathService.getInstance().model(window.__sampleTreeNode),target=model.current.value;
        const {revision}=await connection.client.repository.observe({worktree_id:target.id});
        const direct=await connection.client.repository.tree({worktree_id:target.id,revision,path:'src'});
        throw Error(String(error)+' '+JSON.stringify({capabilities:model.capabilities.value,error:model.error.value,events:window.__sampleTreeEvents,directHasFile:direct.entries.some(e=>e.path==='src/sample-99.ts'),visibleRows:[...tree().querySelectorAll('[data-path]')].map(e=>e.dataset.path)}));
      }
      await wait(2500);
      const body=tree().querySelector('.abele-file-tree__body');
      return JSON.stringify({
        open:!!row('src/sample-10.ts'),
        sameRow:row('src/sample-50.ts')===window.__sampleTreeRow&&window.__sampleTreeRow.isConnected,
        sameBody:body===window.__sampleTreeBody,
        scroll:body.scrollTop,expected:window.__sampleTreeScroll,
        loading:tree().textContent.includes('Reading the files'),
      });
    })()`)
    )
    expect(state).toMatchObject({ open: true, sameRow: true, sameBody: true, loading: false })
    expect(Math.abs(state.scroll - state.expected)).toBeLessThanOrEqual(1)
  } finally {
    try {
      await evalLong(
        `(async()=>{const id=window.__sampleTreeNode;window.__sampleTreeStop?.();for(const leaf of app.workspace.getLeavesOfType('abele-node-sidebar'))leaf.detach();if(id)window.__abeleTest.NodeService.getInstance().remove(id);delete window.__sampleTreeNode;delete window.__sampleTreeScroll;delete window.__sampleTreeRow;delete window.__sampleTreeBody;delete window.__sampleTreeEvents;delete window.__sampleTreeStop;return 'restored'})()`
      )
    } finally {
      if (child?.exitCode === null) {
        child.kill('SIGTERM')
        await new Promise<void>((resolve) => child!.once('exit', () => resolve()))
      }
      rmSync(dir, { recursive: true, force: true })
    }
  }
}, 120000)
