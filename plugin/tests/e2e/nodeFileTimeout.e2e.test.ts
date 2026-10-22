import { expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { NODE_PANEL_FIXTURE } from './helpers/nodePanelFixture'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('abele-node-file-timeout')

const probe = (device: string) =>
  evalAsync<boolean>(`(async () => {
    ${NODE_PANEL_FIXTURE}
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const until = async fn => {
      for (let i = 0; i < 120; i++) { if (fn()) return; await wait(50); }
      throw Error('File error state did not render');
    };
    let leaf, original;
    try {
      await nodePanel.open('root');
      const state = window.__abeleNodePanelFixture;
      const connection = state.nodes.connections.get(state.registration.id);
      original = state.model.openFile;
      let reads = 0;
      state.model.openFile = async () => {
        reads++;
        if (reads === 1) throw Error('git_timeout');
        return { path: 'sample.ts', text: 'export const sample = true', target: state.model.current.value };
      };
      const open = async () => {
        leaf ??= app.workspace.getLeaf('tab');
        await leaf.setViewState({type:'abele-node-file',active:true,state:{kind:'file',target:{...state.model.current.value},path:'sample.ts'}});
        await leaf.loadIfDeferred?.();
        await app.workspace.revealLeaf(leaf);
        app.workspace.leftSplit.collapse();
        app.workspace.rightSplit.collapse();
        return leaf.view.contentEl;
      };
      const capture = async name => {
        await wait(350);
        require('fs').writeFileSync(${JSON.stringify(shots)} + '/' + ${JSON.stringify(device)} + '-' + name + '.png',
          (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG());
      };
      let pane = await open();
      await until(() => pane.querySelector('.abele-node-error-words')?.textContent.includes('Git on the node'));
      const line = pane.querySelector('.abele-node-error-words');
      const retry = [...pane.querySelectorAll('button')].find(el => el.textContent.trim() === 'Retry');
      const box = line.getBoundingClientRect();
      if (!retry || line.textContent.includes('git_timeout') || box.left < 0 || box.right > innerWidth || box.bottom > innerHeight) return false;
      await capture('timeout');
      retry.click();
      await until(() => pane.querySelector('.abele-file-view'));
      if (reads !== 2) return false;
      await leaf.setViewState({type:'empty',active:true});
      connection.state.value = 'disconnected';
      state.model.openFile = async () => { throw Error('offline'); };
      pane = await open();
      await until(() => pane.textContent.includes('The file will open when the node is back.'));
      if (pane.querySelector('[role=alert]') || pane.textContent.includes('disconnected')) return false;
      await capture('offline');
      return true;
    } finally {
      leaf?.detach();
      const state = window.__abeleNodePanelFixture;
      if (state && original) state.model.openFile = original;
      await nodePanel.close();
    }
  })()`)

it('offers a file retry and waits quietly offline on desktop and phone', async () => {
  expect(await probe('desktop')).toBe(true)
  expect(await withEmulatedPhone(() => probe('phone'))).toBe(true)
})
