import { expect, it } from 'vitest'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { evalLong } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotPath } from './helpers/shots'

targets('desktop')
const cli = process.env.ABELE_NODE_CLI
const SHOTS = shotPath('abele-node-compare')
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const prelude = `const api=window.__abeleTest,nodes=api.NodeService.getInstance();const wait=ms=>new Promise(r=>setTimeout(r,ms));const until=async(f,what)=>{for(let i=0;i<300;i++){if(f())return;await wait(50)}throw Error('Comparison UI did not settle: '+(what??f.toString()))};const tab=()=>app.workspace.getLeavesOfType('abele-github').find(l=>l.view.model?.sourceTarget?.source?.node===window.__sampleCompareNode)?.view.contentEl;`
// The base has files the current files no longer have: one the branch deleted, one added to the
// base after the branch left it. Uncommitted and untracked edits sit on top of committed ones.
it('compares the current files of a branch with another version, committed and uncommitted changes alike', async () => {
  if (!cli) throw new Error('Set ABELE_NODE_CLI to the built node CLI')
  mkdirSync('../.scratch', { recursive: true })
  const dir = mkdtempSync(resolve('../.scratch/c-')),
    projectPath = resolve(dir, 'sample-project')
  mkdirSync(projectPath)
  const git = (...args: string[]) =>
    promisify(execFile)(
      '/usr/bin/git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'user.name=Sample',
        '-c',
        'user.email=sample@example.invalid',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: projectPath }
    )
  await git('init', '--initial-branch=main')
  writeFileSync(resolve(projectPath, 'app.ts'), 'export const value = 1\n')
  writeFileSync(resolve(projectPath, 'removed.txt'), 'Removed on the branch\n')
  writeFileSync(resolve(projectPath, 'README.md'), '# Sample repository\n')
  await git('add', '.')
  await git('commit', '-m', 'Add sample files')
  await git('checkout', '-b', 'feature')
  writeFileSync(resolve(projectPath, 'feature.ts'), 'export const feature = true\n')
  await git('rm', '-q', 'removed.txt')
  await git('add', '.')
  await git('commit', '-m', 'Add the feature')
  await git('checkout', 'main')
  mkdirSync(resolve(projectPath, 'later'))
  writeFileSync(resolve(projectPath, 'later/main-only.txt'), 'Only on main\n')
  await git('add', '.')
  await git('commit', '-m', 'Main moves on')
  await git('checkout', 'feature')
  writeFileSync(resolve(projectPath, 'app.ts'), 'export const value = 2\n')
  writeFileSync(resolve(projectPath, 'draft.txt'), 'Untracked sample\n')
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
      const node=await nodes.add('Sample compare node','http://127.0.0.1:${ready.port}',${JSON.stringify(enrolled.token)});
      window.__sampleCompareNode=node.id;
      const client=nodes.connection(node.id).client,project=await client.registerProject(${JSON.stringify(projectPath)},'trusted');
      await client.setRepositorySettings({project_id:project.project_id,external_read:false,default_branch:'main'});
      const workspace=(await client.repository.worktrees({project_id:project.project_id})).entries.find(w=>w.kind==='root');
      window.__sampleCompareProject=project.project_id;window.__sampleCompareWorkspace=workspace.worktree_id;
      await api.openNodeRepository(node.id,project.project_id,workspace.worktree_id);
      await until(()=>tab()?.querySelector('.abele-github-home')?.textContent.includes('draft.txt'),'repository home');
      return node.id;
    })()`)
    // The owner's path: the tab's actions, «Compare with another version», then a branch.
    const page = await evalLong(`(async()=>{${prelude}
      const root=tab();
      root.querySelector('[aria-label="Repository actions"]').click();
      await until(()=>[...document.querySelectorAll('.menu-item')].some(el=>el.textContent.trim()==='Compare with another version'),'menu');
      [...document.querySelectorAll('.menu-item')].find(el=>el.textContent.trim()==='Compare with another version').click();
      await until(()=>document.querySelector('.abele-github-base-picker input'),'picker');
      const input=document.querySelector('.abele-github-base-picker input');input.value='main';input.dispatchEvent(new Event('input',{bubbles:true}));
      const row=()=>[...document.querySelectorAll('.abele-github-base-picker .suggestion-item')].find(el=>el.textContent.includes('Compare against commit'));
      await until(row,'resolved base row');row().click();
      const compare=()=>tab()?.querySelector('.abele-github-compare');
      await until(()=>compare()?.textContent.includes('feature.ts')||tab()?.querySelector('.abele-github-notice'),'comparison page');
      const failed=tab().querySelector('.abele-github-notice');
      if(!compare()||/stale/i.test(tab().textContent))throw Error('Comparison page failed: '+(failed?.textContent??tab().textContent.slice(0,400)));
      await until(()=>compare().textContent.includes('value = 2'),'diff of app.ts');
      const image=await require('@electron/remote').getCurrentWebContents().capturePage();
      require('fs').mkdirSync(${JSON.stringify(SHOTS)},{recursive:true});require('fs').writeFileSync(${JSON.stringify(SHOTS)}+'/compare-main.png',image.toPNG());
      return compare().textContent;
    })()`)
    for (const name of ['feature.ts', 'app.ts', 'draft.txt', 'removed.txt', 'later/main-only.txt'])
      expect(page).toContain(name)
    // A base chosen in a node tab opens the comparison; the tab's own file tree stays the files.
    const tree = await evalLong(`(async()=>{${prelude}
      await api.openNodeRepository(window.__sampleCompareNode,window.__sampleCompareProject,window.__sampleCompareWorkspace);
      const home=()=>app.workspace.getLeavesOfType('abele-github').map(l=>l.view.contentEl).find(el=>el.querySelector('.abele-github-home')?.textContent.includes('draft.txt')&&el.getBoundingClientRect().width);
      await until(home,'home again');
      const root=home();
      if(!root.querySelector('.abele-github-tree'))root.querySelector('[aria-label="Show the repository\\'s files beside this"]').click();
      await until(()=>root.querySelector('.abele-github-tree [role="tree"]')?.textContent.includes('README.md')||root.querySelector('.abele-github-tree__error'),'file tree');
      if(root.querySelector('.abele-github-tree__error'))throw Error('File tree failed: '+root.querySelector('.abele-github-tree__error').textContent);
      root.querySelector('[aria-label="Close the file tree"]')?.click();
      return root.querySelector('.abele-github-tree')?.textContent??'closed';
    })()`)
    expect(tree).not.toMatch(/stale/i)
  } finally {
    try {
      await evalLong(
        `(async()=>{const id=${JSON.stringify(registration)}||window.__sampleCompareNode;for(const leaf of app.workspace.getLeavesOfType('abele-github'))if(leaf.view.model?.sourceTarget?.source?.node===id)leaf.detach();if(id)window.__abeleTest.NodeService.getInstance().remove(id);delete window.__sampleCompareNode;delete window.__sampleCompareProject;delete window.__sampleCompareWorkspace;document.querySelector('.modal-close-button')?.click();return 'restored'})()`
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
