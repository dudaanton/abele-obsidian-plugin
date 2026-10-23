import { expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { NODE_PANEL_FIXTURE } from './helpers/nodePanelFixture'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('abele-node-navigation')

it('returns through native history after language definition and reference jumps', async () => {
  const result = JSON.parse(
    await evalLong(`(async () => {
    ${NODE_PANEL_FIXTURE}
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const until = async fn => { for(let i=0;i<160;i++){if(fn())return;await wait(50)} throw Error('Language history did not settle') };
    let leaf;
    try {
      await nodePanel.open('root');
      const fixture = window.__abeleNodePanelFixture;
      const client = fixture.nodes.connections.get(fixture.registration.id).client;
      const describe = client.describe;
      client.describe = async () => { const info=await describe(); info.capabilities.capabilities.lsp_v1={status:'supported'};return info };
      client.lsp = {status:async()=>[],open:async()=>({servers:['typescript']}),close:async()=>({}),diagnostics:async()=>[],
        definition:async()=>[{path:'src/definition.ts',range:{start:{line:6,character:0},end:{line:6,character:6}}}],
        references:async()=>[{path:'src/definition.ts',range:{start:{line:11,character:0},end:{line:11,character:6}}},{path:'src/other.ts',range:{start:{line:1,character:0},end:{line:1,character:6}}}]};
      const text=Array.from({length:18},(_,i)=>'export const sample'+i+' = '+i).join(String.fromCharCode(10));
      client.repository.blob=async()=>({content_id:'sample-history-content',size:text.length,binary:false,requires_larger_load:false,too_large:false});
      client.repository.content=async()=>({offset:0,total:text.length,base64:btoa(text)});
      leaf=app.workspace.getLeaf('tab');
      await leaf.setViewState({type:'abele-node-file',active:true,state:{kind:'file',target:{...fixture.model.current.value},path:'src/source.ts',line:4}});
      await leaf.loadIfDeferred?.();await app.workspace.revealLeaf(leaf);
      const pane=leaf.view.contentEl;
      const editor=()=>{const el=pane.querySelector('.cm-editor');return el&&window.__abeleTest.codeView(el)};
      const at=async(path,line)=>{await until(()=>leaf.view.getState().path===path&&leaf.view.getState().line===line&&pane.querySelector('.abele-github-code__line_target'));await wait(150)};
      await at('src/source.ts',4);
      const menuJump=async(title,line)=>{
        await until(()=>pane.querySelector('.abele-lsp-root'));
        const cm=editor();const pos=cm.state.doc.line(line).from+14;
        cm.dispatch({selection:{anchor:pos}});
        const box=cm.coordsAtPos(pos);
        cm.contentDOM.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:box.left,clientY:box.top+4}));
        await until(()=>[...document.querySelectorAll('.menu-item-title')].some(el=>el.textContent===title));
        [...document.querySelectorAll('.menu-item-title')].find(el=>el.textContent===title).closest('.menu-item').click();
      };
      await menuJump('Go to definition',4);await at('src/definition.ts',7);
      await wait(200);await leaf.history.back();await at('src/source.ts',4);
      await leaf.history.forward();await at('src/definition.ts',7);
      await menuJump('Find references',7);
      await until(()=>[...document.querySelectorAll('.abele-github-definition__place')].some(el=>el.textContent==='src/definition.ts:12'));
      [...document.querySelectorAll('.abele-github-definition__place')].find(el=>el.textContent==='src/definition.ts:12').closest('.suggestion-item').click();
      await at('src/definition.ts',12);
      await wait(200);await leaf.history.back();await at('src/definition.ts',7);
      await leaf.history.forward();await at('src/definition.ts',12);
      const actions=[...leaf.containerEl.querySelectorAll('.view-action')].map(el=>el.getAttribute('aria-label'));
      const previous=actions.indexOf('Previous changed file'),next=actions.indexOf('Next changed file');
      if(previous<0||next!==previous+1)throw Error('Header arrow order: '+JSON.stringify(actions));
      require('fs').writeFileSync(${JSON.stringify(shots + '/desktop-language-history.png')},(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
      return JSON.stringify({path:leaf.view.getState().path,line:leaf.view.getState().line});
    } finally {leaf?.detach();await nodePanel.close()}
  })()`)
  ) as { path: string; line: number }
  expect(result).toEqual({ path: 'src/definition.ts', line: 12 })
})

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
      const tab = {kind:'file',target:{...state.model.current.value},path:'src/sample-panel.ts',line:8,match:{column:13,length:3}};
      await leaf.setViewState({type:'abele-node-file',active:true,state:tab});
      await leaf.loadIfDeferred?.();
      await app.workspace.revealLeaf(leaf);
      if (${phone}) { app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse() }
      const pane = leaf.view.contentEl;
      await until(()=>pane.querySelector('.abele-file-view__header') && pane.querySelector('.cm-line'));
      await until(()=>pane.querySelector('.cm-searchMatch')?.textContent==='v07');
      if(getComputedStyle(pane.querySelector('.cm-searchMatch')).backgroundColor==='rgba(0, 0, 0, 0)')throw Error('Search destination has no visible highlight');
      await wait(1200);
      const content = pane.querySelector('.abele-file-view__file');
      const card = content;
      const height = card.getBoundingClientRect().height - 24;
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
