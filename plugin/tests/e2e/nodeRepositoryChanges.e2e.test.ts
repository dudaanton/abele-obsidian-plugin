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
const prelude = `const api=window.__abeleTest,nodes=api.NodeService.getInstance();const wait=ms=>new Promise(r=>setTimeout(r,ms));const until=async f=>{for(let i=0;i<200;i++){if(f())return;await wait(50)}throw Error('Repository tree did not settle: '+f.toString())};const tree=()=>document.querySelector('.abele-github-tree');const row=p=>tree()?.querySelector('.tree-item-self[data-path="'+p+'"]');`
it('patches the node file tree in place from the change stream without reading it again', async () => {
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
      const node=await nodes.add('Sample stream node','http://127.0.0.1:${ready.port}',${JSON.stringify(enrolled.token)});
      window.__sampleStreamNode=node.id;
      const client=nodes.connection(node.id).client,project=await client.registerProject(${JSON.stringify(projectPath)},'trusted');
      const catalogue=await client.repository.worktrees({project_id:project.project_id});
      const workspace=catalogue.entries.find(w=>w.kind==='root');
      await api.openNodeRepository(node.id,project.project_id,workspace.worktree_id);
      await until(()=>document.querySelector('.abele-github-home'));
      if(!tree()){
        const toggle=document.querySelector('[aria-label="Show the repository\\'s files beside this"],[aria-label="Show the repository\\'s file tree beside the page"]');
        if(!toggle)throw Error('No file tree toggle');toggle.click();
      }
      await until(()=>row('src'));
      row('src').click();
      await until(()=>row('src/sample-89.ts'));
      const body=tree().querySelector('.abele-github-tree__body');
      if(body.scrollHeight-body.clientHeight<200)throw Error('The tree is not tall enough to scroll');
      body.scrollTop=200;await wait(100);
      window.__sampleStreamScroll=body.scrollTop;window.__sampleStreamRow=row('src/sample-50.ts');window.__sampleStreamBody=body;
      const described=await client.describe();
      if(described.capabilities.capabilities.repository_changes_v1?.status!=='supported')throw Error('The node does not stream changes');
      const repository=client.repository,read=repository.tree.bind(repository);
      window.__sampleStreamReads=0;window.__sampleStreamReadsFrom=[];repository.tree=p=>{if(p.path==='src'){window.__sampleStreamReads++;window.__sampleStreamReadsFrom.push(String(new Error().stack).split('\\n').slice(2,9).join(' < '))}return read(p)};
      return 'opened';
    })()`)
    // Edits from outside: one added, one renamed, one removed in the opened folder, one elsewhere.
    writeFileSync(resolve(projectPath, 'src/sample-99.ts'), 'export const value = 99\n')
    renameSync(resolve(projectPath, 'src/sample-20.ts'), resolve(projectPath, 'src/renamed-20.ts'))
    rmSync(resolve(projectPath, 'src/sample-30.ts'))
    for (let i = 0; i < 3; i++) {
      writeFileSync(resolve(projectPath, 'notes.txt'), `change ${i}\n`)
      await pause(700)
    }
    const state = JSON.parse(
      await evalLong(`(async()=>{${prelude}
      await until(()=>row('src/sample-99.ts')&&row('src/renamed-20.ts')&&!row('src/sample-30.ts')&&!row('src/sample-20.ts'));
      await wait(2500);
      const body=tree().querySelector('.abele-github-tree__body');
      return JSON.stringify({
        open:!!row('src/sample-10.ts'),
        sameRow:row('src/sample-50.ts')===window.__sampleStreamRow&&window.__sampleStreamRow.isConnected,
        sameBody:body===window.__sampleStreamBody,
        scroll:body.scrollTop,expected:window.__sampleStreamScroll,
        loading:tree().textContent.includes('Loading the files'),
        reads:window.__sampleStreamReads,
        // Where a read of the opened folder came from, should one happen.
        readsFrom:window.__sampleStreamReadsFrom,
      });
    })()`)
    )
    expect(state).toMatchObject({
      open: true,
      sameRow: true,
      sameBody: true,
      loading: false,
      reads: 0,
    })
    expect(Math.abs(state.scroll - state.expected)).toBeLessThanOrEqual(1)
  } finally {
    try {
      await evalLong(
        `(async()=>{const id=window.__sampleStreamNode;for(const leaf of app.workspace.getLeavesOfType('abele-github'))if(leaf.view.model?.sourceTarget?.source?.node===id)leaf.detach();if(id)window.__abeleTest.NodeService.getInstance().remove(id);delete window.__sampleStreamNode;delete window.__sampleStreamScroll;delete window.__sampleStreamRow;delete window.__sampleStreamBody;delete window.__sampleStreamReads;delete window.__sampleStreamReadsFrom;return 'restored'})()`
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
