import { expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { startPairedNode, PAIRED_PRELUDE } from './helpers/pairedNode'
import { evalLong } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('abele-node-blame')

async function scenario(layout: string) {
  const node = await startPairedNode()
  const project = resolve(node.state, '../sample-project')
  let text =
    Array.from({ length: 1500 }, (_, index) => `// sample line ${index + 1}`).join('\n') + '\n'
  const git = (...args: string[]) =>
    promisify(execFile)('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: project,
    })
  const commitFile = async (message: string) => {
    await git('add', 'sample.ts')
    await git(
      '-c',
      'user.name=Sample',
      '-c',
      'user.email=sample@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      message
    )
  }
  try {
    writeFileSync(resolve(project, 'sample.ts'), text)
    await commitFile('Add sample file')
    const unavailable = (await git('rev-parse', 'HEAD')).stdout.trim()
    for (let line = 1; line <= 5; ++line) {
      const lines = text.split('\n')
      lines[line] = `// edited line ${line + 1}`
      text = lines.join('\n')
      writeFileSync(resolve(project, 'sample.ts'), text)
      await commitFile('Update sample line')
    }
    const transient = (await git('rev-parse', 'HEAD')).stdout.trim()
    writeFileSync(resolve(project, 'sample.ts'), text + '// uncommitted final line\n')
    const target = JSON.parse(
      await evalLong(`(async()=>{${PAIRED_PRELUDE}
      const client=nodes.connection(${JSON.stringify(node.registration)}).client;
      const project=await client.registerProject(${JSON.stringify(project)},'trusted');
      const rows=await client.repository.worktrees({project_id:project.project_id});
      const root=rows.entries.find(row=>row.kind==='root');
      return JSON.stringify({nodeId:${JSON.stringify(node.node)},registrationId:${JSON.stringify(node.registration)},projectId:project.project_id,kind:'worktree',id:root.worktree_id})})()`)
    )
    const probe = async (layout: string) => {
      const result = JSON.parse(
        await evalLong(`(async()=>{${PAIRED_PRELUDE}
        const leaf=app.workspace.getLeaf('tab');
        try {
          await leaf.setViewState({type:'abele-node-file',active:true,state:{kind:'file',target:${JSON.stringify(target)},path:'sample.ts',line:1}});
          await leaf.loadIfDeferred?.();await app.workspace.revealLeaf(leaf);
          app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse();
          const root=leaf.view.contentEl;
          let toggle;
          try {
            toggle=await until(()=>root.querySelector('[aria-label="Toggle line blame"]'),'Blame toggle');
          } catch(error) {
            require('fs').writeFileSync(${JSON.stringify(shots)}+'/'+${JSON.stringify(layout)}+'-missing-toggle.png',(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
            const principal=await nodes.connection(${JSON.stringify(node.registration)}).client.store.transaction(current=>({installation:!!current.installation_id}));
            throw Error(String(error)+'; '+JSON.stringify({text:root.textContent.slice(0,1600),state:leaf.view.getState(),principal,connection:nodes.connection(${JSON.stringify(node.registration)}).state.value}));
          }
          const client=nodes.connection(${JSON.stringify(node.registration)}).client;
          const original=client.repository.commit.bind(client.repository);
          const stats={active:0,peak:0,attempts:{}};
          window.__abeleBlameMetadataFixture={restore:()=>{client.repository.commit=original}};
          client.repository.commit=async params=>{
            const sha=params.revision.commit;
            const attempt=stats.attempts[sha]=(stats.attempts[sha]??0)+1;
            stats.peak=Math.max(stats.peak,++stats.active);
            try {
              if(sha===${JSON.stringify(unavailable)}||(sha===${JSON.stringify(transient)}&&attempt===1))
                throw Object.assign(Error('Sample read capacity exhausted'),{code:'resource_busy'});
              return await original(params);
            } finally {--stats.active}
          };
          toggle.click();
          await until(()=>root.querySelector('.abele-github-blame-range')||root.querySelector('.abele-github-notice'),'Blame response');
          const author=root.querySelector('.abele-github-blame-range__name');
          if(!author)throw Error('Blame missing: '+root.textContent);
          const authorName=author.textContent;
          const firstDate=root.querySelector('.abele-github-blame-range__date').textContent;
          await new Promise(r=>setTimeout(r,300));
          require('fs').writeFileSync(${JSON.stringify(shots)}+'/'+${JSON.stringify(layout)}+'.png',(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
          const scroll=root.querySelector('.abele-node-main');
          scroll.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:100}));
          scroll.scrollTop=scroll.scrollHeight;
          await until(()=>{
            scroll.scrollTop=scroll.scrollHeight;
            return [...root.querySelectorAll('.abele-github-blame-range__name')].some(el=>el.textContent==='Uncommitted');
          },'Attribution after line 1500').catch(async error=>{
            require('fs').writeFileSync(${JSON.stringify(shots)}+'/'+${JSON.stringify(layout)}+'-missing-final-line.png',(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
            throw Error(String(error)+'; '+JSON.stringify({top:scroll.scrollTop,height:scroll.scrollHeight,client:scroll.clientHeight,lines:[...root.querySelectorAll('.cm-line')].map(el=>el.textContent),authors:[...root.querySelectorAll('.abele-github-blame-range__name')].map(el=>el.textContent)}));
          });
          await until(()=>[...root.querySelectorAll('.cm-line')].some(el=>el.textContent.includes('uncommitted final line')),'Final source line');
          require('fs').writeFileSync(${JSON.stringify(shots)}+'/'+${JSON.stringify(layout)}+'-last-line.png',(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
          return JSON.stringify({author:authorName,firstDate,pressed:toggle.getAttribute('aria-pressed'),errors:[...root.querySelectorAll('[role=alert]')].map(el=>el.textContent),peak:stats.peak,unavailableAttempts:stats.attempts[${JSON.stringify(unavailable)}],transientAttempts:stats.attempts[${JSON.stringify(transient)}]});
        } finally {leaf.detach()}
      })()`)
      )
      expect(result).toMatchObject({ author: 'Sample', firstDate: '', pressed: 'true', errors: [] })
      expect(result.peak).toBeLessThanOrEqual(2)
      expect(result.unavailableAttempts).toBeGreaterThanOrEqual(3)
      expect(result.transientAttempts).toBeGreaterThanOrEqual(2)
    }
    await probe(layout)
  } finally {
    await evalLong(`(()=>{
      window.__abeleBlameMetadataFixture?.restore();delete window.__abeleBlameMetadataFixture;
      return 'restored commit transport';
    })()`).catch(() => {})
    await node.close()
  }
}

it('attributes a file beyond the first blame page in desktop and phone layouts', async () => {
  await scenario('desktop')
  await withEmulatedPhone(() => scenario('phone'))
}, 180_000)
