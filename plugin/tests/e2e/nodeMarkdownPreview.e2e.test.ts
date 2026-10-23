import { it } from 'vitest'
import { copyFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { startPairedNode, PAIRED_PRELUDE } from './helpers/pairedNode'
import { evalLong } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('abele-node-md-preview')

async function scenario(shell: string) {
  const node = await startPairedNode()
  let originalDark = ''
  try {
    originalDark = await evalLong("String(document.body.classList.contains('theme-dark'))")
    const projectPath = resolve(node.state, '../sample-project')
    const guide =
      '# Sample guide\n\n' +
      Array.from(
        { length: 100 },
        (_, i) => `## Section ${i + 1}\n\nA paragraph to read and search in a long document.\n\n`
      ).join('')
    writeFileSync(
      resolve(projectPath, 'README.md'),
      '# Sample project\n\n[Guide](guide.md)\n\n[Website](https://example.invalid)\n\n![Sample picture](sample.png)\n\n![Missing picture](missing.png)\n\n| Name | Description | A | B | C | D | E |\n| --- | --- | --- | --- | --- | --- | --- |\n| Short | This is a long description that wraps within a readable column rather than stretching the entire page. | One | Two | Three | Four | Five |\n'
    )
    writeFileSync(resolve(projectPath, 'guide.md'), guide)
    writeFileSync(resolve(projectPath, 'empty.md'), '')
    copyFileSync(
      resolve('tests/fixtures/images/sample-gradient.png'),
      resolve(projectPath, 'sample.png')
    )
    execFileSync('git', ['add', 'README.md', 'guide.md', 'empty.md', 'sample.png'], {
      cwd: projectPath,
    })
    execFileSync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'user.name=Sample',
        '-c',
        'user.email=sample@example.invalid',
        'commit',
        '-m',
        'Add sample documents',
      ],
      { cwd: projectPath }
    )
    await evalLong(`(async()=>{${PAIRED_PRELUDE}
      const client=nodes.connection(${JSON.stringify(node.registration)}).client;
      const project=await client.registerProject(${JSON.stringify(projectPath)},'trusted');
      const rows=await client.repository.worktrees({project_id:project.project_id});
      const root=rows.entries.find(w=>w.kind==='root');
      const leaf=app.workspace.getLeaf('tab');
      await leaf.setViewState({type:'abele-node-file',active:true,state:{kind:'file',target:{nodeId:${JSON.stringify(node.node)},registrationId:${JSON.stringify(node.registration)},projectId:project.project_id,kind:'worktree',id:root.worktree_id},path:'README.md'}});
      await app.workspace.revealLeaf(leaf);return 'opened'})()`)
    const failures: string[] = []
    for (const theme of ['light', 'dark']) {
      for (const state of [
        'readme',
        'code',
        'empty',
        'guide',
        'scrolled-preview',
        'scrolled-code',
        'end-preview',
        'end-code',
      ]) {
        const failure = await evalLong(`(async()=>{${PAIRED_PRELUDE}
          const issues=[];
          const leaf=app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.getState().target.registrationId===${JSON.stringify(node.registration)});
          const root=leaf.view.contentEl;
          document.body.classList.toggle('theme-dark',${theme === 'dark'});document.body.classList.toggle('theme-light',${theme === 'light'});
          const state=${JSON.stringify(state)};
          if(['readme','empty','guide'].includes(state))await leaf.setViewState({type:'abele-node-file',active:true,state:{...leaf.view.getState(),path:state==='readme'?'README.md':state==='empty'?'empty.md':'guide.md',markdownMode:'preview'}});
          await until(()=>root.querySelector('.abele-file-view__header'),'Header');
          if(state==='empty')await until(()=>root.textContent.includes('This file is empty.'),'Empty markdown');
          else if(state==='code'||state==='scrolled-code'||state==='end-code') {root.querySelector('.abele-file-view__header .lucide-book-open').closest('button').click();await until(()=>root.querySelector('.cm-editor'),'Code');}
          else await until(()=>root.querySelector('.abele-github-md'),'Rendered markdown');
          if(state==='readme') {await until(()=>root.querySelector('.abele-github-md__missing'),'Missing image fallback');await until(()=>root.querySelector('.abele-github-md img[src^="blob:"]')?.naturalWidth>0,'Node image bytes');if(!root.querySelector('.abele-github-md__table'))throw Error('Missing table scroll box');}
          const card=root.querySelector('.abele-file-view__file'),header=root.querySelector('.abele-file-view__header');
          if(state.startsWith('scrolled')) {card.scrollTop=(card.scrollHeight-card.clientHeight)/2;await wait(250);if(card.scrollTop<100)throw Error('File card does not scroll');const a=card.getBoundingClientRect(),b=header.getBoundingClientRect();if(Math.abs(b.top-a.top)>3)throw Error('Header is not pinned inside card');if(b.bottom>a.bottom)throw Error('Header outside visible card');}
          if(state==='readme') {const link=root.querySelector('a[data-abele-node-path="guide.md"]'),external=root.querySelector('a[href="https://example.invalid"]');if(!link?.classList.contains('internal-link')||link.classList.contains('external-link'))issues.push('Relative file link must look internal');if(!external?.classList.contains('external-link'))issues.push('Browser link must look external');}
          if(state.startsWith('end-')) {card.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:100}));card.scrollTop=card.scrollHeight;await wait(250);const bar=document.querySelector('.mobile-navbar'),bottom=${shell === 'phone'}?(bar?.getBoundingClientRect().top??innerHeight):innerHeight;if(${shell === 'phone'}&&card.getBoundingClientRect().bottom>bottom-2)issues.push('File card overlaps floating bottom bar');const lines=root.querySelectorAll(state==='end-code'?'.cm-line':'.abele-github-md p'),last=lines[lines.length-1];if(!last||last.getBoundingClientRect().bottom>Math.min(card.getBoundingClientRect().bottom,bottom))issues.push('Last line is hidden at the end of the file');}
          const name=header.querySelector('.abele-file-view__path'),nameStyle=getComputedStyle(name);if(name.getBoundingClientRect().height>(parseFloat(nameStyle.lineHeight)||parseFloat(nameStyle.fontSize)*1.5)+2)throw Error('File header name must fit on one line');
          await wait(250);require('fs').writeFileSync(${JSON.stringify(shots)}+'/'+${JSON.stringify(`${shell}-${theme}-${state}.png`)},(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
          if(state==='code') {if(leaf.view.getState().markdownMode!=='code')throw Error('Mode not saved in tab');const count=app.workspace.getLeavesOfType('abele-node-file').length;header.querySelector('.lucide-book-open').closest('button').click();await until(()=>root.querySelector('a[data-abele-node-path="guide.md"]'),'Relative guide link');root.querySelector('a[data-abele-node-path="guide.md"]').click();await until(()=>leaf.view.getState().path==='guide.md'&&root.textContent.includes('Sample guide'),'Guide in same tab');if(app.workspace.getLeavesOfType('abele-node-file').length!==count)throw Error('Relative link opened another tab');}
          if(state==='scrolled-code') {header.querySelector('.lucide-book-open').closest('button').click();await until(()=>root.querySelector('.abele-github-md'),'Pinned toggle still works');}
          return issues.join('; ')})()`)
        if (failure) failures.push(`${shell}-${theme}-${state}: ${failure}`)
      }
    }
    if (failures.length) throw Error(failures.join('\n'))
  } finally {
    await evalLong(
      `(()=>{document.body.classList.toggle('theme-dark',${String(originalDark).includes('true')});document.body.classList.toggle('theme-light',${!String(originalDark).includes('true')});return 'restored'})()`
    ).catch(() => {})
    await evalLong(
      `(()=>{for(const leaf of app.workspace.getLeavesOfType('abele-node-file'))if(leaf.view.getState().target.registrationId===${JSON.stringify(node.registration)})leaf.detach();return 'closed'})()`
    ).catch(() => {})
    await node.close()
  }
}

it('reads node markdown and pins its working file header on desktop', async () => {
  await scenario('desktop')
}, 180000)
it('reads node markdown and pins its working file header in phone emulation', async () => {
  await withEmulatedPhone(() => scenario('phone'))
}, 180000)
