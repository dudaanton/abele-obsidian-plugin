import { expect, it } from 'vitest'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { evalLong } from './helpers/obsidianCli'
import { targets } from './helpers/target'

targets('desktop')
const cli = process.env.ABELE_NODE_CLI
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const prelude = `const api=window.__abeleTest,nodes=api.NodeService.getInstance();const wait=ms=>new Promise(r=>setTimeout(r,ms));const until=async f=>{for(let i=0;i<200;i++){if(f())return;await wait(50)}throw Error('Node path sidebar did not settle: '+f.toString())};const tree=()=>[...document.querySelectorAll('.abele-file-tree')].find(el=>el.getBoundingClientRect().width>0);const row=p=>tree()?.querySelector('.tree-item-self[data-path="'+p+'"]');`
it('patches an opened folder of the node path sidebar in place without reading it again', async () => {
  if (!cli) throw new Error('Set ABELE_NODE_CLI to the built node CLI')
  mkdirSync('../.scratch', { recursive: true })
  const dir = mkdtempSync(resolve('../.scratch/t-')),
    projectPath = resolve(dir, 'sample-project')
  mkdirSync(resolve(projectPath, 'src'), { recursive: true })
  const git = (...args: string[]) =>
    promisify(execFile)('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: projectPath,
    })
  await git('init', '--initial-branch=main')
  for (let i = 10; i < 30; i++)
    writeFileSync(resolve(projectPath, `src/sample-${i}.ts`), `export const value = ${i}\n`)
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
      const node=await nodes.add('Sample path node','http://127.0.0.1:${ready.port}',${JSON.stringify(enrolled.token)});
      window.__samplePathNode=node.id;
      const client=nodes.connection(node.id).client,project=await client.registerProject(${JSON.stringify(projectPath)},'trusted');
      const described=await client.describe();
      if(described.capabilities.capabilities.repository_changes_v1?.status!=='supported')throw Error('The node does not stream changes');
      const catalogue=await client.repository.worktrees({project_id:project.project_id});
      const workspace=catalogue.entries.find(w=>w.kind==='root');
      for(const leaf of app.workspace.getLeavesOfType('abele-node-sidebar'))leaf.detach();
      const leaf=app.workspace.getLeftLeaf(false);
      await leaf.setViewState({type:'abele-node-sidebar',active:true,state:{registrationId:node.id}});
      await app.workspace.revealLeaf(leaf);
      const service=api.NodePathService.getInstance(),model=service.model(node.id);
      await service.ready(node.id);await model.refresh();await model.select(workspace.worktree_id);
      // Every file, from the panel's Files mode in its header.
      await until(()=>document.querySelector('.abele-node-modes [role="tab"][aria-label="Files"]'));
      document.querySelector('.abele-node-modes [role="tab"][aria-label="Files"]').click();
      await until(()=>model.panelMode.value==='files'&&row('src'));
      row('src').click();
      await until(()=>row('src/sample-29.ts'));
      window.__samplePathRow=row('src/sample-15.ts');window.__samplePathFolder=row('src');
      const repository=client.repository,read=repository.tree.bind(repository);
      window.__samplePathReads=[];
      repository.tree=p=>{window.__samplePathReads.push(p.path||'(root)');return read(p)};
      window.__samplePathLog=[];const debug=console.debug;window.__samplePathDebug=debug;
      console.debug=(...a)=>{if(/node path/.test(String(a[0])))window.__samplePathLog.push(a.map(v=>{try{return typeof v==='string'?v:JSON.stringify(v)}catch{return String(v)}}).join(' '));return debug.apply(console,a)};
      return 'opened';
    })()`)
    // Edits from outside: one added, one renamed, one removed in the opened folder, one elsewhere.
    writeFileSync(resolve(projectPath, 'src/sample-99.ts'), 'export const value = 99\n')
    renameSync(resolve(projectPath, 'src/sample-20.ts'), resolve(projectPath, 'src/renamed-20.ts'))
    rmSync(resolve(projectPath, 'src/sample-25.ts'))
    for (let i = 0; i < 3; i++) {
      writeFileSync(resolve(projectPath, 'notes.txt'), `change ${i}\n`)
      await pause(700)
    }
    const state = JSON.parse(
      await evalLong(`(async()=>{${prelude}
      await until(()=>row('src/sample-99.ts')&&row('src/renamed-20.ts')&&!row('src/sample-25.ts')&&!row('src/sample-20.ts'));
      await wait(2500);
      return JSON.stringify({
        open:!!row('src/sample-10.ts'),
        sameRow:row('src/sample-15.ts')===window.__samplePathRow&&window.__samplePathRow.isConnected,
        sameFolder:row('src')===window.__samplePathFolder,
        reads:window.__samplePathReads,
        log:window.__samplePathLog,
      });
    })()`)
    )
    console.info('[abele e2e] node path sidebar state', JSON.stringify(state))
    expect(state).toMatchObject({ open: true, sameRow: true, sameFolder: true })
    // Neither the opened folder nor the root is listed again for these edits.
    expect(state.reads).toEqual([])
  } finally {
    try {
      await evalLong(
        `(async()=>{const id=window.__samplePathNode;for(const leaf of app.workspace.getLeavesOfType('abele-node-sidebar'))leaf.detach();if(id)window.__abeleTest.NodeService.getInstance().remove(id);if(window.__samplePathDebug)console.debug=window.__samplePathDebug;for(const key of ['__samplePathNode','__samplePathRow','__samplePathFolder','__samplePathReads','__samplePathDebug','__samplePathLog'])delete window[key];return 'restored'})()`
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
