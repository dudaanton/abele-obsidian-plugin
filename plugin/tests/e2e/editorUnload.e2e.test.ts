import { expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { targets } from './helpers/target'

targets('desktop')

it('cancels header callbacks and removes editor extensions when an open editor outlives plugin unload', async () => {
  const result = JSON.parse(
    await evalLong(`(async()=>{
    const path='ScaleTest/editor-unload-sample-'+Date.now()+'.md';
    const file=await app.vault.create(path,'# Sample editor\\n');
    const leaf=app.workspace.getLeaf('tab');
    const original=window.setTimeout;
    let queued=0,fired=0;
    try {
      await leaf.openFile(file,{state:{mode:'source'}});
      const cm=leaf.view.editor.cm;
      await new Promise(resolve=>original(resolve,400));
      window.setTimeout=function(callback,delay,...args){
        if(delay===300&&String(callback).includes('noteType')){
          queued++;
          return original.call(this,()=>{fired++;callback(...args)},delay);
        }
        return original.call(this,callback,delay,...args);
      };
      cm.dispatch({changes:{from:cm.state.doc.length,insert:'Sample change'}});
      const before=app.workspace.editorExtensions.length;
      await app.plugins.disablePlugin('abele');
      const after=app.workspace.editorExtensions.length;
      await new Promise(resolve=>original(resolve,500));
      return JSON.stringify({queued,fired,before,after,headers:leaf.containerEl.querySelectorAll('.abele-header-widget-container').length});
    } finally {
      window.setTimeout=original;
      await app.plugins.enablePlugin('abele');
      await leaf.view.save();
      leaf.detach();
      await app.vault.delete(file);
    }
  })()`)
  )
  expect(result.queued).toBeGreaterThan(0)
  expect(result.fired).toBe(0)
  expect(result.after).toBeLessThan(result.before)
  expect(result.headers).toBe(0)
})
