import { expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { NODE_PANEL_FIXTURE } from './helpers/nodePanelFixture'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('abele-node-navigation')

it.each([false, true])(
  'keeps a short linked file header visible, phone layout: %s',
  async (phone) => {
    const probe = async () =>
      JSON.parse(
        await evalLong(`(async () => {
    ${NODE_PANEL_FIXTURE}
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const until = async fn => { for (let i=0;i<160;i++) { if(fn()) return; await wait(50) } throw Error('Linked file did not render') };
    let leaf;
    try {
      await nodePanel.open('root');
      const state = window.__abeleNodePanelFixture;
      const client = state.nodes.connections.get(state.registration.id).client;
      const transaction = client.store.transaction;
      client.store.transaction = async fn => transaction(raw => fn({...raw,installation_id:'sample-installation'}));
      const eol = String.fromCharCode(10);
      const text = Array.from({length:18},(_,i)=>'export const v'+String(i).padStart(2,'0')+' = '+i).join(eol)+eol;
      client.repository.blob = async () => ({content_id:'sample-navigation-content',size:text.length,binary:false,requires_larger_load:false,too_large:false});
      client.repository.content = async () => ({offset:0,total:text.length,base64:btoa(text)});
      leaf = app.workspace.getLeaf('tab');
      const tab = {kind:'file',target:{...state.model.current.value},path:'src/sample-panel.ts',line:8};
      await leaf.setViewState({type:'abele-node-file',active:true,state:tab});
      await leaf.loadIfDeferred?.();
      await app.workspace.revealLeaf(leaf);
      if (${phone}) { app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse() }
      const pane = leaf.view.contentEl;
      await until(()=>pane.querySelector('.abele-file-view__header') && pane.querySelector('.cm-line'));
      await wait(1200);
      const content = pane.querySelector('.abele-node-main');
      const card = pane.querySelector('.abele-file-view');
      const style = getComputedStyle(content);
      const height = card.getBoundingClientRect().height + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) - 24;
      content.style.flex = '0 0 auto';
      content.style.height = height+'px';
      content.style.maxHeight = height+'px';
      await leaf.setViewState({type:'abele-node-file',active:true,state:{...tab,line:9}});
      await wait(200);
      await leaf.setViewState({type:'abele-node-file',active:true,state:tab});
      await until(()=>pane.querySelector('.abele-file-view__header') && pane.querySelector('.cm-line'));
      await wait(1200);
      const header = pane.querySelector('.abele-file-view__header');
      const result = {range:content.scrollHeight-content.clientHeight,scroll:content.scrollTop,headerTop:header.getBoundingClientRect().top-content.getBoundingClientRect().top};
      require('fs').writeFileSync(${JSON.stringify(shots + '/')}+${JSON.stringify(phone ? 'phone' : 'desktop')}+'-short-linked-file.png',(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
      return JSON.stringify(result);
    } finally {
      leaf?.detach();
      await nodePanel.close();
    }
  })()`)
      ) as { range: number; scroll: number; headerTop: number }
    const result = phone ? await withEmulatedPhone(probe) : await probe()
    expect(result.range).toBeGreaterThan(0)
    expect(result.range).toBeLessThan(96)
    expect(result.scroll).toBe(0)
    expect(result.headerTop).toBeGreaterThanOrEqual(-1)
  }
)
