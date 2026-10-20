import { expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { NODE_PANEL_FIXTURE } from './helpers/nodePanelFixture'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('abele-node-disconnect')
async function probe(device: string) {
  return JSON.parse(
    await evalLong(`(async()=>{
    ${NODE_PANEL_FIXTURE}
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const until=async fn=>{for(let i=0;i<100;i++){const v=fn();if(v)return v;await wait(50)}throw Error('Disconnect confirmation did not appear')};
    const states=[];
    try {
      await nodePanel.open('root');
      const fixture=window.__abeleNodePanelFixture;
      const client=fixture.nodes.connections.get(fixture.registration.id).client;
      for(const supported of [false,true]) {
        client.describe=async()=>({capabilities:{capabilities:{device_disconnect:{status:supported?'supported':'unsupported'}}}});
        const menu=await nodePanel.menu();
        const item=[...menu.querySelectorAll('.menu-item')].find(i=>i.querySelector('.menu-item-title')?.textContent.trim()==='Disconnect this device…');
        if(!item)throw Error('Disconnect action missing');
        item.click();
        const modal=await until(()=>[...document.querySelectorAll('.modal.abele-modal')].find(m=>m.textContent.includes('Disconnect')));
        await wait(200);
        const text=modal.textContent;
        if(supported ? !text.includes('revoke its key') : !text.includes('does not revoke'))throw Error('Incorrect revocation disclosure: '+text);
        require('fs').writeFileSync(${JSON.stringify(shots)}+'/'+${JSON.stringify(device)}+'-'+(supported?'supported':'legacy')+'.png',(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
        [...modal.querySelectorAll('button')].find(b=>b.textContent.trim()==='Cancel').click();
        await wait(200);
        if(!fixture.nodes.nodes.value.some(n=>n.id===fixture.registration.id))throw Error('Cancel removed the registration');
        states.push(supported);
      }
      return JSON.stringify(states);
    } finally {await nodePanel.close()}
  })()`)
  ) as boolean[]
}
it('discloses supported revocation and legacy local removal on desktop and phone', async () => {
  expect(await probe('desktop')).toEqual([false, true])
  expect(await withEmulatedPhone(() => probe('phone'))).toEqual([false, true])
})
