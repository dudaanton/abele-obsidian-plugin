import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  evalJson,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  runCli,
} from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { tap } from './helpers/phone'
import { columnShot } from './helpers/columnShots'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const FOLDER = 'Sample aside columns'
const SHOTS = shotDir('columns-aside')
const POLICIES = ['stack', 'aside-first', 'aside-collapse', 'keep'] as const
const STATES = [
  { name: 'empty', title: '', content: '' },
  {
    name: 'long',
    title: 'Sample reference with a heading that spans several lines in a narrow column',
    content: 'A supporting sample paragraph.',
  },
  { name: 'missing', title: 'Missing attachment', content: '![[sample-missing.svg]]' },
  { name: 'error', title: 'Invalid chart', content: '```abele-chart\ninvalid: value\n```' },
]
const body = (
  policy: string,
  title = 'Sample reference',
  content = 'Aside sample paragraph.\n\n- [ ] Aside sample task'
) =>
  `Before the sample.\n\n> [!abele-columns|ratio=2:1 mobile=${policy}]\n> > [!abele-column] Body\n> > Main sample paragraph.\n> >\n> > | WideUnbrokenHeadingForSampleOne | WideUnbrokenHeadingForSampleTwo |\n> > | --- | --- |\n> > | Alpha | Beta |\n>\n> > [!abele-column|role=aside] ${title}\n${content
    .split('\n')
    .map((line) => '> >' + (line ? ' ' + line : ''))
    .join('\n')}\n\nAfter the sample.\n`
const probe = <T>(code: string): T =>
  JSON.parse(
    evalRaw(`(async()=>JSON.stringify(await(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms));${code}
})()))()`)
  ) as T
const ROOT = `const view=app.workspace.activeLeaf.view;const root=view.getMode()==='preview'?view.previewMode.containerEl:view.editor.cm.dom;
 const frame=root.querySelector('.abele-columns');const columns=[...frame.querySelectorAll(':scope > .callout-content > .abele-column')];const aside=columns[1];const title=aside.querySelector('.callout-title');const content=aside.querySelector('.callout-content');`
function show(policy: string, mode: string, expectedPolicy = policy) {
  return probe<boolean>(`
    const path=${JSON.stringify(FOLDER)}+'/'+${JSON.stringify(policy)}+'.md';const file=app.vault.getAbstractFileByPath(path);
    let leaf=app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path===path);
    if(!leaf){leaf=app.workspace.getLeaf('tab');await leaf.openFile(file)}
    await leaf.setViewState({type:'markdown',state:{file:path,mode:${JSON.stringify(mode)},source:false}});app.workspace.setActiveLeaf(leaf,{focus:true});
    if(leaf.view.getMode()==='source'){leaf.view.editor.setCursor({line:leaf.view.editor.lineCount()-1,ch:0});leaf.view.editor.blur()}
    for(let i=0;i<50;i++){
      const frame=leaf.view.containerEl.querySelector('.abele-columns');
      if(frame?.dataset.abeleColumnsMobile===${JSON.stringify(expectedPolicy)}){await wait(300);if(frame.isConnected)return true}
      await wait(100)
    }return false;
  `)
}
function capture(name: string) {
  columnShot(`${SHOTS}/${name}.png`)
}
function click(x: number, y: number) {
  if (onPhone()) tap(x, y)
  else
    for (const type of ['mousePressed', 'mouseReleased'])
      runCli([
        'dev:cdp',
        'method=Input.dispatchMouseEvent',
        'params=' + JSON.stringify({ type, x, y, button: 'left', clickCount: 1 }),
      ])
}
describe.skipIf(!available)('aside column layouts', () => {
  let size: number[]
  beforeAll(() => {
    if (!onPhone())
      size = evalJson(`require('@electron/remote').getCurrentWindow().getContentSize()`)
    probe(`if(app.vault.getAbstractFileByPath(${JSON.stringify(FOLDER)}))throw Error('fixture already exists');await app.vault.createFolder(${JSON.stringify(FOLDER)});
      for(const [policy,text] of ${JSON.stringify([...POLICIES.map((p) => [p, body(p)]), ...STATES.map((state) => [state.name, body('aside-collapse', state.title, state.content)])])})await app.vault.create(${JSON.stringify(FOLDER)}+'/'+policy+'.md',text);
      app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse();return true;`)
  })
  afterAll(async () => {
    if (!onPhone()) {
      await reloadApp('app.emulateMobile(false)')
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]},${size[1]})`
      )
    }
    probe(
      `for(const leaf of app.workspace.getLeavesOfType('markdown'))if(leaf.view.file?.path?.startsWith(${JSON.stringify(FOLDER + '/')}))leaf.detach();const folder=app.vault.getAbstractFileByPath(${JSON.stringify(FOLDER)});if(folder)await app.vault.delete(folder,true);return true;`
    )
  })
  for (const narrow of onPhone() ? [true] : [false, true]) {
    it(`sets the ${narrow ? 'phone' : 'desktop'} viewport`, async () => {
      if (!onPhone()) {
        await reloadApp(`app.emulateMobile(${narrow})`)
        probe(
          `require('@electron/remote').getCurrentWindow().setContentSize(${narrow ? 390 : 1400},${narrow ? 844 : 1000});await wait(200);return true`
        )
      }
    })
    for (const mode of ['preview', 'source'])
      for (const policy of POLICIES) {
        it(`${narrow ? 'phone' : 'desktop'} ${mode}: ${policy} keeps content and the native reference heading`, () => {
          expect(show(policy, mode)).toBe(true)
          const layout = probe<{
            boxes: { x: number; y: number; w: number; h: number }[]
            title: string
            display: string
            expanded: string | null
            role: string
            foldVisible: boolean
            source: string
          }>(`
          ${ROOT} await wait(300);
          return {boxes:columns.map(c=>{const r=c.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}),
            title:getComputedStyle(title).display,display:getComputedStyle(content).display,expanded:title.getAttribute('aria-expanded'),role:aside.dataset.abeleColumnRole,foldVisible:!!title.querySelector('.abele-column-aside-fold') && getComputedStyle(title.querySelector('.abele-column-aside-fold')).display!=='none',source:await app.vault.read(view.file)};
        `)
          expect(layout.source).toBe(body(policy))
          expect(layout.role).toBe('aside')
          expect(layout.title).not.toBe('none')
          expect(layout.foldVisible).toBe(narrow && policy === 'aside-collapse')
          if (!narrow || policy === 'keep') {
            expect(layout.boxes[1].y).toBeCloseTo(layout.boxes[0].y, 0)
            if (!narrow) expect(layout.boxes[0].w / layout.boxes[1].w).toBeCloseTo(2, 1)
          } else if (policy === 'aside-first')
            expect(layout.boxes[1].y + layout.boxes[1].h).toBeLessThanOrEqual(layout.boxes[0].y)
          else
            expect(layout.boxes[1].y).toBeGreaterThanOrEqual(layout.boxes[0].y + layout.boxes[0].h)
          expect(layout.display === 'none').toBe(narrow && policy === 'aside-collapse')
          capture(`${narrow ? 'phone' : 'desktop'}-${mode}-${policy}`)
          if (narrow && policy === 'aside-collapse') {
            expect(layout.expanded).toBe('false')
            const point = probe<{ x: number; y: number }>(
              `${ROOT}title.scrollIntoView({block:'center'});await wait(100);const r=title.getBoundingClientRect();return {x:r.x+30,y:r.y+r.height/2}`
            )
            click(point.x, point.y)
            expect(
              probe<string>(`${ROOT}await wait(300);return getComputedStyle(content).display`)
            ).not.toBe('none')
            expect(probe<string>(`${ROOT}return title.getAttribute('aria-expanded')`)).toBe('true')
            capture(`phone-${mode}-aside-expanded`)
            expect(probe<string>(`${ROOT}return await app.vault.read(view.file)`)).toBe(
              body(policy)
            )
          }
        })
      }
    for (const mode of ['preview', 'source'])
      for (const state of STATES) {
        it(`${narrow ? 'phone' : 'desktop'} ${mode}: ${state.name} reference state fits the column`, () => {
          expect(show(state.name, mode, 'aside-collapse')).toBe(true)
          const result = probe<{ overflow: number; label: string; body: string }>(`${ROOT}
          if(title.getAttribute('aria-expanded')==='false')title.click();await wait(300);
          return {overflow:aside.scrollWidth-aside.clientWidth,label:title.textContent,body:content.textContent};`)
          expect(result.overflow).toBeLessThanOrEqual(2)
          expect(result.label).toContain(state.title || 'Aside')
          if (state.name === 'error') expect(result.body).toContain('No series defined')
          capture(`${narrow ? 'phone' : 'desktop'}-${mode}-${state.name}`)
        })
      }
  }
  it('the native menu changes a column role without changing its body', () => {
    expect(show('stack', 'source')).toBe(true)
    probe(
      `${ROOT}frame.querySelector('.abele-columns-controls button').click();await wait(200);return true;`
    )
    capture('column-role-menu')
    expect(
      probe<boolean>(
        `const item=[...document.querySelectorAll('.menu-item')].find(e=>e.querySelector('.menu-item-title')?.textContent==='Use this column as an aside');if(!item)return false;item.click();await wait(300);return true;`
      )
    ).toBe(true)
    expect(probe<string>(`return app.workspace.activeLeaf.view.editor.getValue()`)).toBe(
      body('stack').replace('[!abele-column] Body', '[!abele-column|role=aside] Body')
    )
    probe(
      `const view=app.workspace.activeLeaf.view;view.editor.setValue(${JSON.stringify(body('stack'))});await view.save();return true;`
    )
  })
  it.skipIf(onPhone())('print expands the aside, restores proportions and exports a PDF', () => {
    expect(show('aside-collapse', 'preview')).toBe(true)
    probe(`${ROOT}
      const print=document.body.createDiv({cls:'print'});
      const preview=print.createDiv({cls:'markdown-preview-view'});
      const sizer=preview.createDiv({cls:'markdown-preview-sizer'});sizer.style.width='700px';sizer.append(frame.cloneNode(true));
      require('@electron/remote').getCurrentWindow().setContentSize(900,1000);return true;`)
    runCli([
      'dev:cdp',
      'method=Emulation.setEmulatedMedia',
      'params=' + JSON.stringify({ media: 'print' }),
    ])
    try {
      const layout = probe<{
        visible: boolean
        controls: boolean
        ratio: number
        ordered: boolean
      }>(
        `const frame=document.querySelector('.print .abele-columns');const columns=[...frame.querySelectorAll(':scope > .callout-content > .abele-column')];const aside=columns[1];const content=aside.querySelector('.callout-content');await wait(300);return {visible:getComputedStyle(content).display!=='none',controls:getComputedStyle(frame.querySelector('.abele-columns-controls')).display!=='none',ratio:columns[0].clientWidth/aside.clientWidth,ordered:columns[0].getBoundingClientRect().x<aside.getBoundingClientRect().x}`
      )
      expect(layout.visible).toBe(true)
      expect(layout.controls).toBe(false)
      expect(layout.ratio).toBeCloseTo(2, 1)
      expect(layout.ordered).toBe(true)
      capture('print-expanded-aside')
    } finally {
      runCli([
        'dev:cdp',
        'method=Emulation.setEmulatedMedia',
        'params=' + JSON.stringify({ media: '' }),
      ])
      probe(`document.querySelector('.print')?.remove();return true;`)
    }
    const bytes = probe<number>(`${ROOT}
      const fs=require('fs'),remote=require('@electron/remote'),dialog=remote.dialog;
      const path=${JSON.stringify(SHOTS + '/sample-columns.pdf')};if(fs.existsSync(path))fs.unlinkSync(path);
      const save=dialog.showSaveDialog,saveSync=dialog.showSaveDialogSync;
      dialog.showSaveDialog=async()=>({filePath:path,canceled:false});dialog.showSaveDialogSync=()=>path;
      try{
        view.printToPdf();await wait(100);
        const button=[...document.querySelectorAll('.modal button')].find(e=>e.textContent==='Export to PDF');
        if(!button)throw Error('the native PDF export modal did not open');button.click();
        for(let i=0;i<100;i++){if(fs.existsSync(path))return fs.statSync(path).size;await wait(100)}
        throw Error('the native PDF exporter did not save');
      }finally{dialog.showSaveDialog=save;dialog.showSaveDialogSync=saveSync}
    `)
    expect(bytes).toBeGreaterThan(1000)
  })
})
