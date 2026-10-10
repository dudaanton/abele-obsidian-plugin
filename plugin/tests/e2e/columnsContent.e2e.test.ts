import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { COLUMN_CONTENT, columnContentNote } from '../fixtures/columns/content'
import {
  evalJson,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  runCli,
} from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { screenshot, tap } from './helpers/phone'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const FOLDER = 'Sample column content'
const SHOTS = shotDir('columns-content')
const probe = <T>(code: string): T =>
  JSON.parse(
    evalRaw(`(async () => JSON.stringify(await (async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms)); ${code}
})()))()`)
  ) as T
function show(name: string, mode: string, selector: string) {
  return probe<boolean>(`
    const file=app.vault.getAbstractFileByPath(${JSON.stringify(FOLDER + '/' + name + '.md')});
    let leaf=app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path===file.path);
    if(!leaf){leaf=app.workspace.getLeaf('tab');await leaf.openFile(file)}
    await leaf.setViewState({type:'markdown',state:{file:file.path,mode:${JSON.stringify(mode)},source:false}});
    app.workspace.setActiveLeaf(leaf,{focus:true}); const view=leaf.view;
    if(view.getMode()==='source') view.editor.setCursor({line:view.editor.lineCount()-1,ch:0});
    for(let i=0;i<100;i++){
      const root=view.getMode()==='preview'?view.previewMode.containerEl:view.editor.cm.dom;
      const column=root.querySelector('.abele-column');column?.scrollIntoView({block:'center'});
      if(column?.querySelector(${JSON.stringify(selector)})){await wait(250);return true} await wait(100);
    } return false;
  `)
}
const ROOT = `const view=app.workspace.activeLeaf.view;
  const root=view.getMode()==='preview'?view.previewMode.containerEl:view.editor.cm.dom;
  const frame=root.querySelector('.abele-columns');const column=frame.querySelector('.abele-column');`
function capture(name: string) {
  if (onPhone()) {
    screenshot(`${SHOTS}/${name}.png`)
    return
  }
  probe(`require('fs').writeFileSync(${JSON.stringify(SHOTS)}+'/'+${JSON.stringify(name)}+'.png',
    (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG());return true`)
}

describe.skipIf(!available)('column content compatibility', () => {
  let size: number[]
  let trust: boolean | null
  beforeAll(() => {
    if (!onPhone())
      size = evalJson<number[]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)
    trust = evalJson<boolean | null>(`app.loadLocalStorage('mermaid-vault-trust')??null`)
    probe(`
      if(app.vault.getAbstractFileByPath(${JSON.stringify(FOLDER)})) throw Error('fixture already exists');
      await app.vault.createFolder(${JSON.stringify(FOLDER)});
      await app.vault.create(${JSON.stringify(FOLDER + '/sample-image.svg')},'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="200"><rect width="1200" height="200" fill="none" stroke="currentColor"/><text x="20" y="100">Sample attachment</text></svg>');
      await app.vault.create(${JSON.stringify(FOLDER + '/sample-embed.md')},'Sample embedded paragraph.');
      for(const sample of ${JSON.stringify(COLUMN_CONTENT)}) await app.vault.create(${JSON.stringify(FOLDER)}+'/'+sample.name+'.md',
        ${JSON.stringify(COLUMN_CONTENT.map((sample) => columnContentNote(sample.body)))}[${JSON.stringify(COLUMN_CONTENT.map((s) => s.name))}.indexOf(sample.name)]);
      app.saveLocalStorage('mermaid-vault-trust',true);
      app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse();return true;
    `)
  })
  afterAll(async () => {
    if (!onPhone()) {
      await reloadApp('app.emulateMobile(false)')
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]},${size[1]})`
      )
    }
    probe(`app.saveLocalStorage('mermaid-vault-trust',${JSON.stringify(trust)});
      for(const leaf of app.workspace.getLeavesOfType('markdown')) if(leaf.view.file?.path?.startsWith(${JSON.stringify(FOLDER + '/')}))leaf.detach();
      const folder=app.vault.getAbstractFileByPath(${JSON.stringify(FOLDER)});if(folder)await app.vault.delete(folder,true);return true;`)
  })
  for (const narrow of onPhone() ? [true] : [false, true]) {
    it(narrow ? 'switches to the 390 by 844 phone layout' : 'uses a desktop pane', async () => {
      if (!onPhone()) {
        await reloadApp(`app.emulateMobile(${narrow})`)
        probe(
          `require('@electron/remote').getCurrentWindow().setContentSize(${narrow ? 390 : 1400},${narrow ? 844 : 1000});return true`
        )
      }
    })
    for (const mode of ['preview', 'source'])
      for (const sample of COLUMN_CONTENT) {
        it(`${narrow ? 'phone' : 'desktop'} ${mode}: ${sample.name} fits, resizes and retains its source`, () => {
          expect(show(sample.name, mode, sample.selector)).toBe(true)
          const result = probe<{
            overflow: number
            width: number
            canvasWidth: number | null
            source: string
            scroll: number | null
          }>(`
          ${ROOT} const content=column.querySelector(${JSON.stringify(sample.selector)});
          const scroll=column.querySelector(${JSON.stringify(sample.name === 'code' ? 'pre' : '.abele-column-table')});
          if(scroll)scroll.scrollLeft=80;
          const canvas=column.querySelector('canvas');
          return {overflow:column.scrollWidth-column.clientWidth,width:(canvas?.closest('.abele-map')??column).clientWidth,
            canvasWidth:canvas?.getBoundingClientRect().width??null,
            scroll:scroll?.scrollLeft??null,source:await app.vault.read(view.file)};
        `)
          console.log(narrow, mode, sample.name, result)
          capture(`${narrow ? 'phone' : 'desktop'}-${mode}-${sample.name}`)
          expect(result.source).toBe(columnContentNote(sample.body))
          expect(result.overflow).toBeLessThanOrEqual(2)
          if (['tables', 'code'].includes(sample.name)) expect(result.scroll).toBeGreaterThan(0)
          if (result.canvasWidth !== null) expect(result.canvasWidth).toBeCloseTo(result.width, 0)
          if (['maps', 'charts', 'diagrams', 'gallery'].includes(sample.name)) {
            const resized = probe<{ width: number; contentWidth: number }>(`
            ${ROOT} frame.style.width='280px';await wait(800);
            const target=column.querySelector('canvas')??column.querySelector('.abele-mermaid__frame')??column.querySelector('.abele-gallery-widget-container');
            const result={width:column.clientWidth,contentWidth:target.getBoundingClientRect().width+(target.closest('.abele-map')?2:0)};frame.style.removeProperty('width');return result;
          `)
            expect(resized.contentWidth).toBeCloseTo(resized.width, 0)
          }
        })
      }
  }
  for (const name of ['gallery', 'diagrams', 'maps', 'charts']) {
    it(`${name}: repeated Live Preview replacement releases its render resources`, () => {
      const sample = COLUMN_CONTENT.find((s) => s.name === name)!
      expect(show(name, 'source', sample.selector)).toBe(true)
      const lifetime = probe<{ remaining: number; galleries: number }>(`
        ${ROOT}
        const Native=window.ResizeObserver, active=new Map();
        const store=window.__abeleTest.GlobalStore.getInstance();
        const baseline=store.galleriesContainers.value.filter(g=>g.filePath!==view.file.path).length;
        window.ResizeObserver=class extends Native {
          observe(el,options){if(el.closest('.abele-column'))active.set(this,el.className);return super.observe(el,options)}
          unobserve(el){active.delete(this);return super.unobserve(el)}
          disconnect(){active.delete(this);return super.disconnect()}
        };
        try{
          const text=view.editor.getValue();let first;
          for(let i=0;i<3;i++){
            view.editor.setValue(text+'\\nSample revision '+i);
            view.editor.setCursor({line:view.editor.lineCount()-1,ch:0});await wait(800);
            const count=store.galleriesContainers.value.length;
            if(i===0)first=count;else if(count!==first)throw Error('gallery count grew on replacement');
          }
          view.editor.focus();view.editor.setCursor({line:4,ch:6});await wait(500);
          if(root.querySelector('.abele-columns'))throw Error('the source area did not open');
          // MarkdownView keeps the inactive Reading render until its leaf closes.
          for(const leaf of app.workspace.getLeavesOfType('markdown'))if(leaf.view===view)leaf.detach();
          await wait(500);
          return {remaining:active.size,targets:[...active.values()],galleries:store.galleriesContainers.value.length-baseline};
        }finally{window.ResizeObserver=Native}
      `)
      console.log(name, 'lifetime', lifetime)
      expect(lifetime.remaining).toBe(0)
      expect(lifetime.galleries).toBe(0)
    })
  }
  it('tasks in a rendered Live Preview widget keep their exact source binding', () => {
    expect(show('tasks', 'source', 'input.task-list-item-checkbox')).toBe(true)
    const point = probe<{ x: number; y: number }>(
      `${ROOT} const task=column.querySelectorAll('input')[1];task.scrollIntoView({block:'center'});await wait(100);const r=task.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}`
    )
    if (onPhone()) tap(point.x, point.y)
    else
      for (const type of ['mousePressed', 'mouseReleased'])
        runCli([
          'dev:cdp',
          'method=Input.dispatchMouseEvent',
          `params=${JSON.stringify({ type, ...point, button: 'left', clickCount: 1 })}`,
        ])
    expect(
      probe<string>(
        `${ROOT} for(let i=0;i<60;i++){const text=await app.vault.read(view.file);if(text.includes('- [x] Second'))return text;await wait(100)}return await app.vault.read(view.file)`
      )
    ).toBe(
      columnContentNote(COLUMN_CONTENT.find((s) => s.name === 'tasks')!.body).replace(
        '- [ ] Second',
        '- [x] Second'
      )
    )
  })
})
