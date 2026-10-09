import { expect, it } from 'vitest'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { evalLong, evalRaw } from './helpers/obsidianCli'
import { targets } from './helpers/target'

targets('desktop')
const cli = process.env.ABELE_NODE_CLI
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const prelude = `const api=window.__abeleTest,nodes=api.NodeService.getInstance();const wait=ms=>new Promise(r=>setTimeout(r,ms));const until=async f=>{for(let i=0;i<200;i++){if(f())return;await wait(50)}throw Error('Repository UI did not settle: '+f.toString())};`
it('opens the real node repository in the shared tab, follows history, compares, searches and refreshes external edits', async () => {
  if (!cli) throw new Error('Set ABELE_NODE_CLI to the built node CLI')
  mkdirSync('../.scratch', { recursive: true })
  const dir = mkdtempSync(resolve('../.scratch/r-')),
    projectPath = resolve(dir, 'sample-project')
  mkdirSync(projectPath)
  const git = (...args: string[]) =>
    promisify(execFile)('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: projectPath,
    })
  await git('init', '--initial-branch=main')
  writeFileSync(resolve(projectPath, 'app.ts'), 'export const value = 1\n')
  writeFileSync(resolve(projectPath, 'README.md'), '# Sample repository\n')
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
  const head = (await git('rev-parse', 'HEAD')).stdout.trim()
  await git('worktree', 'add', '-b', 'feature', resolve(dir, 'external-worktree'))
  writeFileSync(resolve(projectPath, 'app.ts'), 'export const value = 2\n')
  await git('add', 'app.ts')
  writeFileSync(resolve(projectPath, 'app.ts'), 'export const value = 3\n')
  writeFileSync(resolve(projectPath, 'new.txt'), 'Untracked sample\n')
  let child: ChildProcess | undefined,
    registration = ''
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
    registration = await evalLong(`(async()=>{${prelude}
      const node=await nodes.add('Sample repository node','http://127.0.0.1:${ready.port}',${JSON.stringify(enrolled.token)});
      window.__sampleRepositoryNode=node.id;
      const client=nodes.connection(node.id).client,project=await client.registerProject(${JSON.stringify(projectPath)},'trusted');
      await client.setRepositorySettings({project_id:project.project_id,external_read:true,default_branch:'main'});
      const catalogue=await client.repository.worktrees({project_id:project.project_id});
      const workspace=catalogue.entries.find(w=>w.kind==='root');
      window.__sampleRepositoryProject=project.project_id;window.__sampleRepositoryWorkspace=workspace.worktree_id;
      await api.openNodeRepository(node.id,project.project_id,workspace.worktree_id);
      await until(()=>document.querySelector('.abele-github-home')?.textContent.includes('external-worktree'));
      return node.id;
    })()`)
    const state = JSON.parse(
      await evalLong(`(async()=>{${prelude}
      const root=document.querySelector('.abele-github-home');
      if(!root.textContent.includes('Partly ready'))throw Error('Missing independent status columns');
      const view=app.workspace.getLeavesOfType('abele-github').find(l=>l.view.model?.sourceTarget?.provider==='node').view;
      const state=view.getState();if(JSON.stringify(state).includes('127.0.0.1')||JSON.stringify(state).includes(${JSON.stringify(enrolled.token)}))throw Error('Credentials leaked into state');
      await api.openNodeRepository(window.__sampleRepositoryNode,window.__sampleRepositoryProject,window.__sampleRepositoryWorkspace,{path:'app.ts'});
      await until(()=>document.querySelector('.abele-github-blob')?.textContent.includes('value = 3'));
      document.querySelector('[aria-label="Toggle line blame"]').click();await until(()=>document.querySelector('.abele-github-blame-range')?.textContent.includes('Uncommitted'));
      document.querySelector('[aria-label="Repository actions"]').click();
      await until(()=>[...document.querySelectorAll('.menu-item')].some(el=>el.textContent.trim()==='File history'));
      [...document.querySelectorAll('.menu-item')].find(el=>el.textContent.trim()==='File history').click();await until(()=>document.querySelector('.abele-github-commits')?.textContent.includes('Add sample files'));
      const search=[...document.querySelectorAll('.abele-github-header .abele-obsidian-icon')].find(el=>el.getAttribute('aria-label')?.startsWith('Search the code'));if(!search)throw Error('Search action missing: '+[...document.querySelectorAll('.abele-github-header .abele-obsidian-icon')].map(el=>el.outerHTML).join('|'));search.click();
      await until(()=>document.querySelector('.abele-github-search input'));const input=document.querySelector('.abele-github-search input');input.value='value';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      await until(()=>document.querySelector('.abele-github-search__results')?.textContent.includes('app.ts'));
      return JSON.stringify(state);
    })()`)
    )
    expect(state.sourceTarget.provider).toBe('node')
    writeFileSync(resolve(projectPath, 'app.ts'), 'export const value = 4\n')
    await evalLong(
      `(async()=>{${prelude}await until(()=>document.querySelector('.abele-github-blob')?.textContent.includes('value = 4'));return 'refreshed'})()`
    )
    await evalLong(`(async()=>{${prelude}
      await api.openNodeRepository(window.__sampleRepositoryNode,window.__sampleRepositoryProject,window.__sampleRepositoryWorkspace,{location:{kind:'comparison',base:${JSON.stringify(head)},head:'Working tree',direct:true}});
      await until(()=>document.querySelector('.abele-github-compare')?.textContent.includes('value = 4'));
      const mode=document.querySelector('.abele-github-compare select');mode.value='staged';mode.dispatchEvent(new Event('change',{bubbles:true}));
      await until(()=>document.querySelector('.abele-github-compare')?.textContent.includes('value = 2'));
      return 'compared';
    })()`)
  } finally {
    try {
      await evalLong(
        `(async()=>{const id=${JSON.stringify(registration)}||window.__sampleRepositoryNode;for(const leaf of app.workspace.getLeavesOfType('abele-github'))if(leaf.view.model?.sourceTarget?.source?.node===id)leaf.detach();if(id)window.__abeleTest.NodeService.getInstance().remove(id);delete window.__sampleRepositoryNode;delete window.__sampleRepositoryProject;delete window.__sampleRepositoryWorkspace;return 'restored'})()`
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
