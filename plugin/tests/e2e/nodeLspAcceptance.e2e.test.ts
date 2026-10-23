import { expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { startPairedNode, PAIRED_PRELUDE } from './helpers/pairedNode'
import { evalLong } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('abele-node-lsp-hover')

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
      '/** Sample dependency documentation. */\nexport declare const sample: number\n' +
        '/** Registers a handler for the selected lifecycle stage.\n * @param stage The stage to observe.\n * @param handler Receives the request and response.\n * Use `register` to attach handlers.\n */\n' +
        'export declare function register<Context extends { request: { headers: Record<string, string>; body: unknown }; response: { status: number; send(value: unknown): void } }>(stage: "beforeRequest", handler: (this: Context, request: Context["request"], response: Context["response"]) => Promise<void>): void\n' +
        'export declare function register(stage: "afterResponse", handler: () => void): void\n'
    )
    const source =
      "import { sample, register } from 'sample-types'\nexport const value = sample\nregister('beforeRequest', async function (request, response) {})\nconst broken: string = 42\n"
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
        await api.openDialog('node-lsp-live', {lspFile:{text:${JSON.stringify(source)},target:{kind:'workspace',id:workspace.workspace_id,projectId:project.project_id,registrationId:${JSON.stringify(node.registration)},nodeId:${JSON.stringify(node.node)}}}});
        await until(()=>document.querySelector('.abele-lsp-root .cm-content'),'Live language viewer');
        await until(()=>document.querySelector('.abele-lsp-error'),'Live diagnostic');
        if(document.querySelector('.modal.abele-modal').textContent.includes('Language server missing'))throw Error('Optional lint server hid TypeScript status');
        const point = (word, line) => {
          const content=document.querySelectorAll('.abele-lsp-root .cm-line')[line];
          const walker=document.createTreeWalker(content,NodeFilter.SHOW_TEXT);
          for(let node;node=walker.nextNode();) {
            const at=node.textContent.indexOf(word); if(at<0)continue;
            const range=document.createRange();range.setStart(node,at+1);range.setEnd(node,at+2);
            const b=range.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2,target:node.parentElement};
          }
          throw Error('Symbol not drawn: '+word);
        };
        const move=(p,mod=false)=>p.target.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:p.x,clientY:p.y,ctrlKey:mod}));
        const shot=async name=>{await wait(150);require('fs').writeFileSync(${JSON.stringify(shots)}+'/'+name+'.png',(await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())};
        const originalTheme=document.body.classList.contains('theme-dark');
        try { for(const theme of ['light','dark']) {
          document.body.classList.toggle('theme-dark',theme==='dark');document.body.classList.toggle('theme-light',theme==='light');
          const long=point('register',2);move(long);
          await wait(600);
          if(document.querySelector('.abele-lsp-message'))throw Error('Plain hover exposed type');
          await shot(theme+'-plain');
          document.dispatchEvent(new KeyboardEvent('keydown',{key:'Control',ctrlKey:true,bubbles:true}));
          await until(()=>document.querySelector('.abele-lsp-message pre code'),'Modifier hover').catch(error=>{
            const cm=api.codeView(document.querySelector('.abele-lsp-root .cm-content'));
            const modifiers=cm.plugins.map(p=>p.value).filter(p=>p && 'active' in p && 'revision' in p).map(p=>({active:p.active,revision:p.revision,pointer:!!p.pointer}));
            throw Error(error.message+' '+JSON.stringify({targetConnected:long.target.isConnected,modifiers,pointer:{x:long.x,y:long.y},currentSymbol:((p)=>({x:p.x,y:p.y}))(point('register',2)),position:cm.posAtCoords(long)}));
          });
          const popup=document.querySelector('.abele-lsp-message');
          if(popup.textContent.includes('\`\`\`') || !popup.querySelector('code span') || !popup.querySelector('.abele-lsp-documentation'))throw Error('Markdown hover not rendered');
          if(!popup.textContent.includes('overload'))throw Error('Overloaded signature missing');
          await shot(theme+'-overloaded');
          popup.scrollTop=popup.scrollHeight;
          const docs=popup.querySelector('.abele-lsp-documentation');
          const docsBox=docs.getBoundingClientRect(), popupBox=popup.getBoundingClientRect();
          if(docsBox.bottom>popupBox.bottom+1 || docsBox.top<popupBox.top)throw Error('Hover documentation cannot be scrolled into view');
          await shot(theme+'-overloaded-docs');
          document.dispatchEvent(new KeyboardEvent('keyup',{key:'Control',bubbles:true}));
          await until(()=>!document.querySelector('.abele-lsp-message'),'Modifier release');
          const short=point('sample',1);move(short,true);
          await until(()=>document.querySelector('.abele-lsp-message pre code'),'Short hover');
          await shot(theme+'-short');
          document.dispatchEvent(new KeyboardEvent('keyup',{key:'Control',bubbles:true}));
          const problem=point('broken',3);move(problem);
          await until(()=>document.querySelector('.abele-lsp-problem'),'Plain diagnostic');
          if(document.querySelector('.abele-lsp-message pre'))throw Error('Diagnostic exposed type');
          await shot(theme+'-diagnostic');
          problem.target.dispatchEvent(new MouseEvent('mouseleave',{bubbles:true}));
          await until(()=>!document.querySelector('.abele-lsp-message'),'Leave diagnostic');
        }} finally {
          document.body.classList.toggle('theme-dark',originalTheme);document.body.classList.toggle('theme-light',!originalTheme);
          document.querySelector('[data-lsp-close]')?.click();
        }
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
