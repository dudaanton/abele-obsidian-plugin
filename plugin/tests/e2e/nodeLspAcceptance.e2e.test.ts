import { expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { startPairedNode, PAIRED_PRELUDE } from './helpers/pairedNode'
import { evalLong } from './helpers/obsidianCli'
import { targets } from './helpers/target'

targets('desktop')

it('returns real TypeScript hover documentation and a root-local dependency declaration', async () => {
  const node = await startPairedNode()
  try {
    const project = join(dirname(node.state), 'sample-typescript-project')
    mkdirSync(join(project, 'node_modules/sample-types'), { recursive: true })
    writeFileSync(join(project, 'package.json'), '{"name":"sample-project","private":true}')
    writeFileSync(join(project, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}')
    writeFileSync(
      join(project, 'node_modules/sample-types/package.json'),
      '{"name":"sample-types","types":"index.d.ts"}'
    )
    writeFileSync(
      join(project, 'node_modules/sample-types/index.d.ts'),
      '/** Sample dependency documentation. */\nexport declare const sample: number\n'
    )
    const source = "import { sample } from 'sample-types'\nexport const value = sample\n"
    writeFileSync(join(project, 'sample.ts'), source)
    const git = (...args: string[]) =>
      promisify(execFile)('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], {
        cwd: project,
      })
    await git('init', '--initial-branch=main')
    await git('-c', 'core.excludesFile=/dev/null', 'add', '.')
    await git(
      '-c',
      'user.name=Sample',
      '-c',
      'user.email=sample@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'sample'
    )
    const result = JSON.parse(
      await evalLong(
        `(async()=>{
      ${PAIRED_PRELUDE}
      const client=nodes.connection(${JSON.stringify(node.registration)}).client;
      const project=await client.registerProject(${JSON.stringify(project)},'trusted');
      const job=await client.createWorkspace(project.project_id);
      for(let i=0;i<400;i++) {
        const state=await client.getJob(job.job_id);
        if(state.state==='succeeded')break;
        if(state.state==='failed')throw Error('TypeScript workspace failed');
        await wait(50);
      }
      const workspace=(await client.listWorkspaces(project.project_id))[0];
      const root={workspace_id:workspace.workspace_id};
      await client.lsp.install(['typescript']);
      const opened=await client.lsp.open(root,'sample.ts',${JSON.stringify(source)});
      try {
        let hover;
        for(let i=0;i<40;i++) {
          hover=await client.lsp.hover(root,'sample.ts',{line:1,character:22});
          if(hover.text.includes('Sample dependency documentation.'))break;
          await wait(100);
        }
        const definitions=await client.lsp.definition(root,'sample.ts',{line:1,character:22});
        return JSON.stringify({opened,hover,definitions});
      } finally { await client.lsp.close(root,'sample.ts'); }
    })()`,
        240000
      )
    ) as {
      opened: { servers: string[] }
      hover: { text: string }
      definitions: { path: string; range: { start: { line: number } } }[]
    }
    expect(result.opened.servers).toContain('typescript')
    expect(result.hover.text).toContain('number')
    expect(result.hover.text).toContain('Sample dependency documentation.')
    expect(result.definitions).toContainEqual(
      expect.objectContaining({
        path: 'node_modules/sample-types/index.d.ts',
        range: expect.objectContaining({ start: expect.objectContaining({ line: 1 }) }),
      })
    )
  } finally {
    await node.close()
  }
}, 300000)
