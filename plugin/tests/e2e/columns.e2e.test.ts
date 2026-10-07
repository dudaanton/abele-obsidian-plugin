/** Native callouts as columns: renderer, source bindings and editor transitions. */
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
import { screenshot, swipe, tap } from './helpers/phone'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const FOLDER = 'Sample columns probe'
const NOTE = `${FOLDER}/Columns.md`
const BODY = [
  'Before the columns.',
  '',
  '> [!abele-columns|ratio=2:1 mobile=stack]',
  '> > [!abele-column] First',
  '> > First column paragraph.',
  '> >',
  '> > - List item',
  '> > - [ ] First task',
  '> >',
  '> > ```js',
  '> > const sample = 42',
  '> > ```',
  '> >',
  '> > $$',
  '> > x^2 + y^2 = 1',
  '> > $$',
  '> >',
  '> > ![[Sample picture.svg]]',
  '>',
  '> > [!abele-column] Second',
  '> > Second column paragraph.',
  '> >',
  '> > - [ ] Second task',
  '> >',
  '> > | WideHeadingWithNoBreaksForHorizontalScrollingOne | WideHeadingWithNoBreaksForHorizontalScrollingTwo | WideHeadingWithNoBreaksForHorizontalScrollingThree |',
  '> > | --- | --- | --- |',
  '> > | Alpha | Beta | Gamma |',
  '> >',
  '> > ![[Sample embed]]',
  '',
  'After the columns.',
  '',
].join('\n')
const PRELUDE = `
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let leaf = app.workspace.getLeavesOfType('markdown').find(l => l.view.file?.path === ${JSON.stringify(NOTE)});
  let view = leaf?.view;
  const root = () => view.getMode() === 'preview' ? view.previewMode.containerEl : view.editor.cm.dom;
`
const asyncEval = <T>(code: string): T =>
  JSON.parse(
    evalRaw(`(async () => JSON.stringify(await (async () => { ${PRELUDE} ${code} })()))()`)
  ) as T
const SHOTS = shotDir('columns')
async function shot(name: string) {
  const path = `${SHOTS}/${name}.png`
  if (onPhone()) screenshot(path)
  else
    asyncEval(
      `require('fs').writeFileSync(${JSON.stringify(path)}, (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG()); return true`
    )
}
function click(x: number, y: number) {
  if (onPhone()) tap(x, y)
  else
    for (const type of ['mousePressed', 'mouseReleased'])
      runCli([
        'dev:cdp',
        'method=Input.dispatchMouseEvent',
        `params=${JSON.stringify({ type, x, y, button: 'left', clickCount: 1 })}`,
      ])
}
function show(mode: 'preview' | 'source') {
  return asyncEval<boolean>(`
    if(!leaf){leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}))}
    await leaf.setViewState({type:'markdown', state:{file:${JSON.stringify(NOTE)},mode:${JSON.stringify(mode)},source:false}});
    view=leaf.view;
    app.workspace.setActiveLeaf(leaf,{focus:true});
    if (${JSON.stringify(mode)} === 'source') { view.editor.focus(); view.editor.setCursor({line:view.editor.lineCount()-1,ch:0}); }
    for(let i=0;i<50;i++){if(root().querySelector('.abele-columns')) break; await wait(100)}
    await wait(300);
    return !!root().querySelector('.abele-columns');
  `)
}
interface Layout {
  width: number
  boxes: { x: number; y: number; w: number; h: number }[]
  tableWidth: number
  tableScroll: number
  list: boolean
  code: boolean
  math: boolean
  picture: boolean
  embed: boolean
}
function layout(): Layout {
  return asyncEval<Layout>(`
    const parent=root().querySelector('.abele-columns');
    const columns=[...parent.querySelectorAll(':scope > .callout-content > .abele-column')];
    const table=columns[1].querySelector('table');
    let scroller=table.parentElement;
    while(scroller !== columns[1] && scroller.scrollWidth <= scroller.clientWidth) scroller=scroller.parentElement;
    scroller.scrollLeft=50;
    const tableScroll=scroller.scrollLeft;
    scroller.scrollLeft=0;
    return { width:parent.clientWidth, boxes:columns.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}),
      tableWidth:table?.getBoundingClientRect().width,tableScroll,
      list:!!parent.querySelector('ul'),code:!!parent.querySelector('pre code'),math:!!parent.querySelector('.math'),
      picture:!!parent.querySelector('img'),embed:!!columns[1].querySelector('.markdown-embed-content') };
  `)
}

describe.skipIf(!available)('note columns foundation', () => {
  let size: number[]
  beforeAll(() => {
    if (!onPhone())
      size = evalJson<number[]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)
    asyncEval(`
      app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
      if(app.vault.getAbstractFileByPath(${JSON.stringify(FOLDER)})) throw Error('fixture already exists');
      await app.vault.createFolder(${JSON.stringify(FOLDER)});
      await app.vault.create(${JSON.stringify(FOLDER + '/Sample embed.md')},'Embedded paragraph.');
      await app.vault.create(${JSON.stringify(FOLDER + '/Sample picture.svg')},'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect x="5" y="5" width="110" height="30" fill="none" stroke="currentColor"/></svg>');
      const file=await app.vault.create(${JSON.stringify(NOTE)},${JSON.stringify(BODY)});
      await app.workspace.getLeaf('tab').openFile(file);
      return true;
    `)
  }, 60_000)

  afterAll(async () => {
    if (!onPhone()) {
      await reloadApp('app.emulateMobile(false)')
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]},${size[1]})`
      )
    }
    asyncEval(`
      await app.plugins.enablePlugin('abele');
      for(const l of app.workspace.getLeavesOfType('markdown')) if(l.view.file?.path?.startsWith(${JSON.stringify(FOLDER + '/')})) l.detach();
      const folder=app.vault.getAbstractFileByPath(${JSON.stringify(FOLDER)}); if(folder) await app.vault.delete(folder,true);
      return true;
    `)
  }, 90_000)

  for (const mode of ['preview', 'source'] as const) {
    it(`${mode}: native content and the requested layout`, async () => {
      expect(show(mode)).toBe(true)
      const l = layout()
      await shot(mode)
      console.log(mode, JSON.stringify(l))
      expect(l.boxes).toHaveLength(2)
      if (onPhone()) {
        expect(l.boxes[1].y).toBeGreaterThanOrEqual(l.boxes[0].y + l.boxes[0].h)
        expect(l.boxes[1].x).toBeCloseTo(l.boxes[0].x, 0)
      } else {
        expect(l.boxes[1].y).toBeCloseTo(l.boxes[0].y, 0)
        expect(l.boxes[0].w / l.boxes[1].w).toBeCloseTo(2, 1)
      }
      expect(l.list && l.code && l.math && l.picture && l.embed).toBe(true)
      expect(l.tableScroll).toBeGreaterThan(0)
      await shot(mode)
      asyncEval(
        `root().querySelectorAll('.abele-column')[1].scrollIntoView({block:'center'});await wait(150);return true`
      )
      await shot(mode + '-second')
    })

    it(`${mode}: the second checkbox changes only its own source line`, async () => {
      show(mode)
      const point = asyncEval<{ x: number; y: number }>(`
        const checkbox=root().querySelectorAll('.abele-columns input[type=checkbox]')[1];
        checkbox.scrollIntoView({block:'center'}); await wait(100);
        const r=checkbox.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};
      `)
      click(point.x, point.y)
      const text = asyncEval<string>(`
        let text='';for(let i=0;i<60;i++){text=await app.vault.read(view.file);if(text.includes('> > - [x] Second task')) break;await wait(100)}
        return text;
      `)
      expect(text).toBe(BODY.replace('> > - [ ] Second task', '> > - [x] Second task'))
      asyncEval(
        `if(view.getMode()==='source'){view.editor.setValue(${JSON.stringify(BODY)});await view.save()}else await app.vault.modify(view.file,${JSON.stringify(BODY)}); await wait(400);return true`
      )
    })
  }

  it('a horizontal gesture scrolls only the table without entering source', async () => {
    show('source')
    const point = asyncEval<{ x: number; y: number }>(`
      const scroller=root().querySelector('.abele-column-table');scroller.scrollLeft=0;
      scroller.scrollIntoView({block:'center'});await wait(150);
      const r=scroller.getBoundingClientRect();return {x:r.right-24,y:r.y+16};
    `)
    if (onPhone()) swipe(point.x, point.y, point.x - 180, point.y)
    else
      runCli([
        'dev:cdp',
        'method=Input.dispatchMouseEvent',
        'params=' +
          JSON.stringify({ type: 'mouseWheel', x: point.x, y: point.y, deltaX: 180, deltaY: 0 }),
      ])
    const result = asyncEval<{
      scroll: number
      paragraphX: number
      columnX: number
      rendered: boolean
    }>(`
      await wait(400);const column=root().querySelectorAll('.abele-column')[1];
      return {scroll:column.querySelector('.abele-column-table').scrollLeft,
        paragraphX:column.querySelector('p').getBoundingClientRect().x,columnX:column.getBoundingClientRect().x,
        rendered:!!root().querySelector('.abele-columns')};
    `)
    console.log('horizontal table gesture', JSON.stringify(result))
    expect(result.scroll).toBeGreaterThan(30)
    expect(result.paragraphX).toBeCloseTo(result.columnX, 0)
    expect(result.rendered).toBe(true)
    await shot('table-gesture')
  })

  it('Live Preview expands the whole area, preserves the click line, edits and undoes', async () => {
    show('source')
    const point = asyncEval<{ x: number; y: number }>(`
      const p=[...root().querySelectorAll('.abele-column p')].find(e=>e.textContent.includes('Second column paragraph.'));
      p.scrollIntoView({block:'center'}); await wait(100);const r=p.getBoundingClientRect();return {x:r.x+40,y:r.y+r.height/2};
    `)
    click(point.x, point.y)
    const edit = asyncEval<{ line: string; rendered: boolean; raw: boolean; selected: number }>(`
      await wait(300);const pos=view.editor.getCursor();return {line:view.editor.getLine(pos.line),rendered:!!root().querySelector('.abele-columns'),raw:root().textContent.includes('[!abele-columns|ratio=2:1 mobile=stack]'),selected:view.editor.getSelection().length};
    `)
    console.log('edit transition', JSON.stringify(edit))
    await shot('editing')
    expect(edit.line).toBe('> > Second column paragraph.')
    expect(edit.selected).toBe(0)
    expect(edit.rendered).toBe(false)
    expect(edit.raw).toBe(true)
    await shot('editing')
    asyncEval(
      `view.editor.replaceSelection('sample edit');view.editor.undo();await wait(300);return true`
    )
    expect(asyncEval<string>(`return view.editor.getValue()`)).toBe(BODY)
    expect(show('source')).toBe(true)
  })

  it('identical formatted passages map to the clicked source character with no selection', async () => {
    const duplicate = [
      '> [!abele-columns]',
      '> > [!abele-column]',
      '> > Same **bold** passage.',
      '>',
      '> > [!abele-column]',
      '> > Same **bold** passage.',
      '',
      'After.',
      '',
    ].join('\n')
    show('source')
    asyncEval(
      `view.editor.setValue(${JSON.stringify(duplicate)});view.editor.setCursor({line:8,ch:0});await wait(300);return true`
    )
    const point = asyncEval<{ x: number; y: number }>(`
      const strong=root().querySelectorAll('.abele-column strong')[1];strong.scrollIntoView({block:'center'});await wait(100);
      const range=document.createRange();range.setStart(strong.firstChild,2);range.setEnd(strong.firstChild,3);
      const r=range.getBoundingClientRect();return {x:r.x+0.1,y:r.y+r.height/2};
    `)
    click(point.x, point.y)
    const result = asyncEval<{
      cursor: { line: number; ch: number }
      selected: number
      text: string
    }>(`
      await wait(400);return {cursor:view.editor.getCursor(),selected:view.editor.getSelection().length,text:view.editor.getValue()};
    `)
    expect(result).toEqual({ cursor: { line: 5, ch: 13 }, selected: 0, text: duplicate })
    await shot('duplicate-entry')
    asyncEval(
      `view.editor.setValue(${JSON.stringify(BODY)});view.editor.setCursor({line:view.editor.lineCount()-1,ch:0});await view.save();return true`
    )
  })

  it('expanded source keeps edits, cursor positions and undo before restoring columns', async () => {
    show('source')
    const result = asyncEval<{
      edited: boolean
      undone: boolean
      cursor: number
      expanded: boolean
    }>(`
      view.editor.setCursor({line:20,ch:10});await wait(200);
      const expanded=!root().querySelector('.abele-columns');
      view.editor.replaceSelection('sample edit');await wait(200);
      const edited=view.editor.getValue()===${JSON.stringify(BODY)}.replace('> > Second column paragraph.','> > Secondsample edit column paragraph.');
      view.editor.undo();await wait(200);
      return {expanded,edited,undone:view.editor.getValue()===${JSON.stringify(BODY)},cursor:view.editor.getCursor().line};
    `)
    expect(result).toEqual({ expanded: true, edited: true, undone: true, cursor: 20 })
    await shot('expanded-source')
    expect(show('source')).toBe(true)
  })

  it.runIf(!onPhone())('a narrow pane stacks in source order', async () => {
    show('preview')
    asyncEval(`view.containerEl.style.width='420px';await wait(200);return true`)
    const l = layout()
    console.log('narrow', JSON.stringify(l))
    expect(l.boxes[1].y).toBeGreaterThanOrEqual(l.boxes[0].y + l.boxes[0].h)
    expect(l.boxes[1].x).toBeCloseTo(l.boxes[0].x, 0)
    expect(l.tableScroll).toBeGreaterThan(0)
    await shot('narrow')
    asyncEval(`view.containerEl.style.removeProperty('width');return true`)
  })

  it.runIf(!onPhone())(
    'phone emulation stacks at 390 by 844',
    async () => {
      await reloadApp('app.emulateMobile(true)')
      evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390,844)`)
      await reloadApp()
      for (const mode of ['preview', 'source'] as const) {
        expect(show(mode)).toBe(true)
        const l = layout()
        console.log('emulated', mode, JSON.stringify(l))
        expect(l.boxes[1].y).toBeGreaterThanOrEqual(l.boxes[0].y + l.boxes[0].h)
        expect(l.boxes[1].x).toBeCloseTo(l.boxes[0].x, 0)
        expect(l.tableScroll).toBeGreaterThan(0)
        await shot('mobile-' + mode)
        asyncEval(
          `root().querySelectorAll('.abele-column')[1].scrollIntoView({block:'center'});await wait(150);return true`
        )
        await shot('mobile-' + mode + '-second')
      }
      await reloadApp('app.emulateMobile(false)')
    },
    90_000
  )

  it('alternative markers lack the native shared callout boundary', async () => {
    const alternate = [
      '::columns::',
      '',
      '::left::',
      '',
      'Marker left prose.',
      '',
      '::right::',
      '',
      'Marker right prose.',
      '',
      '::end::',
      '',
      '<!-- abele-columns -->',
      '',
      '<!-- abele-column -->',
      '',
      'Comment left prose.',
      '',
      '<!-- abele-column -->',
      '',
      'Comment right prose.',
      '',
      '<!-- /abele-columns -->',
      '',
    ].join('\n')
    show('preview')
    asyncEval(
      `await app.vault.modify(view.file,${JSON.stringify(alternate)});await wait(500);return true`
    )
    const rendered = asyncEval<{ text: string; callouts: number }>(
      `return {text:root().textContent,callouts:root().querySelectorAll('.callout').length}`
    )
    expect(rendered.text).toContain('::left::')
    expect(rendered.text).toContain('Marker right prose.')
    expect(rendered.text).toContain('Comment left prose.')
    expect(rendered.text).toContain('Comment right prose.')
    expect(rendered.text).not.toContain('<!-- abele-column -->')
    expect(rendered.callouts).toBe(0)
    await shot('alternatives')
    asyncEval(
      `await app.vault.modify(view.file,${JSON.stringify(BODY)});await wait(500);return true`
    )
  })

  it('without the plugin the nested callouts retain every content block', async () => {
    show('preview')
    asyncEval(
      `await app.plugins.disablePlugin('abele');await leaf.setViewState({type:'markdown',state:{file:${JSON.stringify(NOTE)},mode:'source',source:false}});await leaf.setViewState({type:'markdown',state:{file:${JSON.stringify(NOTE)},mode:'preview'}});await wait(700);return true`
    )
    const fallback = asyncEval<{ text: string; count: number }>(
      `return {text:root().textContent,count:root().querySelectorAll('.callout[data-callout="abele-column"]').length}`
    )
    expect(fallback.count).toBe(2)
    for (const text of [
      'First column paragraph.',
      'Second column paragraph.',
      'First task',
      'Second task',
      'const sample = 42',
      'Gamma',
      'Embedded paragraph.',
    ])
      expect(fallback.text).toContain(text)
    await shot('fallback')
    asyncEval(`await app.plugins.enablePlugin('abele');return true`)
  })
})
