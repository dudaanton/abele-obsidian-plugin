import { it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { startPairedNode, PAIRED_PRELUDE } from './helpers/pairedNode'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('abele-node-code-references')

async function scenario(layout: string) {
  const node = await startPairedNode()
  try {
    const session = await node.session('Sample code references')
    await node.open(session, 'Sample code references')
    await evalLong(`(async()=>{${PAIRED_PRELUDE}
      const p=chats.getNodeSession(chats.activeTabId.value);
      await p.send(${JSON.stringify('See [sample.txt:1](sample.txt#L1) and `sample.txt`. [Outside](/outside/secret.ts:3)')});
      await until(()=>chat()?.querySelector('.abele-chat-msg_assistant a[data-node-resource]'),'Code citation');
      const root=chat().querySelector('.abele-chat-msg_assistant');
      const links=[...root.querySelectorAll('a[data-node-resource]')];
      if(links.length!==2||links.some(a=>!a.classList.contains('internal-link')||a.classList.contains('external-link')))throw Error('Citations must look internal: '+JSON.stringify({links:links.map(a=>a.outerHTML),content:root.textContent}));
      if([...root.querySelectorAll('a')].some(a=>a.textContent==='Outside'))throw Error('Outside path is linked');
      const shot=async name=>{require('fs').writeFileSync(${JSON.stringify(shots)}+'/'+${JSON.stringify(layout)}+'-'+name+'.png',(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG())};
      await shot('answer');links[0].click();
      const leaf=await until(()=>app.workspace.getLeavesOfType('abele-node-file').find(l=>l.view.getState().path==='sample.txt'),'Opened node file');
      if(leaf.view.getState().line!==1)throw Error('Citation lost its line');
      await until(()=>leaf.view.contentEl.textContent.includes('Sample project'),'File contents');
      await shot('file-line');leaf.detach();return 'passed'
    })()`)
  } finally {
    await node.close()
  }
}

it('opens code citations from fake agent answers on desktop', async () => {
  await scenario('desktop')
}, 180000)
it('opens code citations from fake agent answers in phone emulation', async () => {
  await withEmulatedPhone(() => scenario('phone'))
}, 180000)
