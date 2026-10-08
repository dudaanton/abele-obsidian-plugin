import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalRaw, isObsidianRunning, hasTestApi, runCli } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { tap, longPress, screenshot } from './helpers/phone'
import { shotDir } from './helpers/shots'
import { createColumns } from '../../src/columns/operations'

targets('desktop', 'phone')
const NOTE = 'Sample column safety.md'
const SHOTS = shotDir('column-safety')
const available = isObsidianRunning() && hasTestApi()
const prelude = `const wait=ms=>new Promise(r=>setTimeout(r,ms));const leaf=app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path===${JSON.stringify(NOTE)});const view=leaf?.view;const root=()=>view.getMode()==='preview'?view.previewMode.containerEl:view.editor.cm.dom;`
const evaluate = <T>(code: string): T =>
  JSON.parse(evalRaw(`(async()=>JSON.stringify(await(async()=>{${prelude}${code}})()))()`)) as T
function show(text: string, mode = 'source') {
  evaluate(
    `await app.vault.modify(view.file,${JSON.stringify(text)});await leaf.setViewState({type:'markdown',state:{file:${JSON.stringify(NOTE)},mode:${JSON.stringify(mode)},source:false}});if(${JSON.stringify(mode)}==='source'){view.editor.setValue(${JSON.stringify(text)});view.editor.setCursor({line:view.editor.lineCount()-1,ch:0})}await wait(500);return true`
  )
}
async function shot(name: string) {
  const path = SHOTS + '/' + name + '.png'
  if (onPhone()) screenshot(path)
  else
    evaluate(
      `require('fs').writeFileSync(${JSON.stringify(path)},(await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG());return true`
    )
}
function click(point: { x: number; y: number }, right = false) {
  if (onPhone()) {
    if (right) longPress(point.x, point.y)
    else tap(point.x, point.y)
  } else
    for (const type of ['mousePressed', 'mouseReleased'])
      runCli([
        'dev:cdp',
        'method=Input.dispatchMouseEvent',
        'params=' +
          JSON.stringify({ type, ...point, button: right ? 'right' : 'left', clickCount: 1 }),
      ])
}
function point(selector: string, offset?: number) {
  return evaluate<{ x: number; y: number }>(`
  const element=root().querySelector(${JSON.stringify(selector)});element.scrollIntoView({block:'center'});await wait(150);
  let r=element.getBoundingClientRect();if(${offset !== undefined}){const range=document.createRange();range.setStart(element.lastChild,${offset ?? 0});range.setEnd(element.lastChild,${(offset ?? 0) + 1});r=range.getBoundingClientRect()}
  return {x:r.x+(${offset !== undefined}?.1:Math.min(30,r.width/2)),y:r.y+r.height/2};`)
}
function menu(title: string) {
  return evaluate<boolean>(
    `const item=[...document.querySelectorAll('.menu-item')].find(e=>e.querySelector('.menu-item-title')?.textContent===${JSON.stringify(title)});if(!item)return false;item.click();await wait(250);return true`
  )
}
const textInFrame = (body: string) => createColumns(body, 'two') + '\n\nAfter.\n'

describe.skipIf(!available)('column source and menu safety', () => {
  beforeAll(() =>
    evaluate(
      `if(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}))throw Error('fixture exists');const file=await app.vault.create(${JSON.stringify(NOTE)},'Start.');await app.workspace.getLeaf('tab').openFile(file);app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse();return true`
    )
  )
  afterAll(() =>
    evaluate(
      `document.querySelectorAll('.menu').forEach(menu=>menu.remove());for(const l of app.workspace.getLeavesOfType('markdown'))if(l.view.file?.path===${JSON.stringify(NOTE)}){await l.view.save();l.detach()}const f=app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)});if(f)await app.vault.delete(f);return true`
    )
  )

  it('does not offer mutating commands on parent prose or quoted code examples', () => {
    for (const text of [
      '> [!abele-columns]\n> Unassigned lead\n> > [!abele-column]\n> > Left\n>\n> > [!abele-column]\n> > Right\n\nAfter.',
      '> ```md\n' + createColumns('Code sample', 'two') + '\n> ```\n\nAfter.',
    ]) {
      show(text)
      const result = evaluate<{ options: boolean; remove: boolean; text: string }>(
        `view.editor.setCursor({line:3,ch:4});app.workspace.activeEditor=view;return {options:app.commands.commands['abele:column-options'].editorCheckCallback(true,view.editor,view),remove:app.commands.commands['abele:remove-columns'].editorCheckCallback(true,view.editor,view),text:view.editor.getValue()}`
      )
      expect(result.options).toBe(false)
      expect(result.remove).toBe(false)
      expect(result.text).toBe(text)
    }
  })
  it('the nested toolbar edits only its own proportions', async () => {
    const text = textInFrame(createColumns('Inner passage', 'two'))
    for (const mode of ['preview', 'source']) {
      show(text, mode)
      click(point('.abele-columns .abele-columns .abele-columns-controls button'))
      evaluate(`await wait(200);return true`)
      expect(menu('Proportions 2:1')).toBe(true)
      const result = evaluate<string>(
        `if(view.getMode()==='source')await view.save();return await app.vault.read(view.file)`
      )
      expect(result.split('\n')[0]).toBe(text.split('\n')[0])
      expect(result).toContain('> > > [!abele-columns|ratio=2:1')
      await shot('nested-' + mode)
    }
  })
  it('a rejected first nested frame cannot redirect its button to the second frame', async () => {
    const first = createColumns('First', 'two').replace('\n', '\n> <!-- annotation -->\n'),
      second = createColumns('Second', 'two')
    const text = textInFrame(first + '\n\n' + second)
    for (const mode of ['preview', 'source']) {
      show(text, mode)
      click(point('.abele-columns .abele-columns:first-of-type .abele-columns-controls button'))
      const unchanged = evaluate<{ menus: number; text: string }>(
        `await wait(300);return {menus:document.querySelectorAll('.menu').length,text:view.getMode()==='source'?view.editor.getValue():await app.vault.read(view.file)}`
      )
      expect(unchanged.menus).toBe(0)
      expect(unchanged.text).toBe(text)
      const at = evaluate<{ x: number; y: number }>(
        `const buttons=root().querySelectorAll('.abele-columns .abele-columns .abele-columns-controls button');const button=buttons[1];button.scrollIntoView({block:'center'});await wait(100);const r=button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}`
      )
      click(at)
      evaluate(`await wait(200);return true`)
      expect(menu('Proportions 2:1')).toBe(true)
      const updated = evaluate<string>(
        `if(view.getMode()==='source')await view.save();return await app.vault.read(view.file)`
      )
      const frames = [...updated.matchAll(/\[!abele-columns\|ratio=([^ ]+)/g)].map((m) => m[1])
      expect(frames).toEqual(['1:1', '1:1', '2:1'])
      expect(updated).toContain('<!-- annotation -->')
      await shot('range-identity-' + mode)
    }
  })

  it('a caret before a trailing link stays before that link', async () => {
    show(textInFrame('Before [[Sample]]'))
    const at = evaluate<{ x: number; y: number }>(
      `const p=root().querySelector('.abele-column p');p.scrollIntoView({block:'center'});await wait(100);const range=document.createRange();range.setStart(p.firstChild,5);range.setEnd(p.firstChild,6);const r=range.getBoundingClientRect();return {x:r.right-.1,y:r.y+r.height/2}`
    )
    click(at)
    const result = evaluate<{ line: string; ch: number; selected: number }>(
      `await wait(300);const pos=view.editor.getCursor();return {line:view.editor.getLine(pos.line),ch:pos.ch,selected:view.editor.getSelection().length}`
    )
    expect(result).toEqual({ line: '> > Before [[Sample]]', ch: 10, selected: 0 })
    await shot('trailing-link-caret')
  })

  it('cursor commands never fall outward from a rejected nested quote', () => {
    const inner = createColumns('Inner', 'two').replace('\n', '\n> <!-- annotation -->\n'),
      text = textInFrame(inner)
    show(text)
    const result = evaluate<{ options: boolean; remove: boolean; text: string }>(
      `const lines=view.editor.getValue().split('\\n');view.editor.setCursor({line:lines.findIndex(line=>line.includes('Inner')),ch:8});app.workspace.activeEditor=view;return {options:app.commands.commands['abele:column-options'].editorCheckCallback(true,view.editor,view),remove:app.commands.commands['abele:remove-columns'].editorCheckCallback(false,view.editor,view),text:view.editor.getValue()}`
    )
    expect(result).toEqual({ options: false, remove: false, text })
  })
  it('refuses lazy continuation ranges from both the button and the cursor', async () => {
    const text =
      '> [!abele-columns]\n> > [!abele-column]\n> > Left\n>\n> > [!abele-column]\n> > Right\ncontinued\n\nAfter.'
    for (const mode of ['preview', 'source']) {
      show(text, mode)
      click(point('.abele-columns-controls button'))
      const result = evaluate<{ menu: boolean; text: string }>(
        `await wait(200);return {menu:!!document.querySelector('.menu'),text:view.getMode()==='source'?view.editor.getValue():await app.vault.read(view.file)}`
      )
      expect(result).toEqual({ menu: false, text })
      if (mode === 'source') {
        const offered = evaluate<boolean>(
          `view.editor.setCursor({line:5,ch:8});app.workspace.activeEditor=view;return app.commands.commands['abele:remove-columns'].editorCheckCallback(false,view.editor,view)`
        )
        expect(offered).toBe(false)
        expect(evaluate<string>(`return view.editor.getValue()`)).toBe(text)
      }
    }
    await shot('lazy-range-refused')
  })
  it('refuses existing quote nodes reordered after a menu established their ranges', async () => {
    const text = textInFrame(
      createColumns('First', 'two') + '\n\n' + createColumns('Second', 'two')
    )
    for (const mode of ['preview', 'source']) {
      show(text, mode)
      evaluate<{ x: number; y: number }>(
        `const frames=root().querySelectorAll('.abele-columns .abele-columns');const first=frames[0];first.querySelector('.abele-columns-controls button').click();await wait(200);return {x:0,y:0}`
      )
      expect(
        evaluate<string[]>(
          `return [...document.querySelectorAll('.menu-item-title')].map(e=>e.textContent)`
        )
      ).toContain('Add column')
      evaluate(`document.body.click();await wait(100);return true`)
      const result = evaluate<{ menu: boolean; text: string; before: string[]; after: string[] }>(
        `const frames=root().querySelectorAll('.abele-columns .abele-columns'),first=frames[0],second=frames[1];const before=[first.dataset.abeleFrameFrom,first.dataset.abeleFrameTo,second.dataset.abeleFrameFrom,second.dataset.abeleFrameTo];first.before(second);second.querySelector('.abele-columns-controls button').click();await wait(200);return {menu:!!document.querySelector('.menu'),text:view.getMode()==='source'?view.editor.getValue():await app.vault.read(view.file),before,after:[first.dataset.abeleFrameFrom,first.dataset.abeleFrameTo,second.dataset.abeleFrameFrom,second.dataset.abeleFrameTo]}`
      )
      expect(result.menu).toBe(false)
      expect(result.text).toBe(text)
      expect(result.after).toEqual(result.before)
    }
    await shot('reordered-range-refused')
  })

  it('uppercase rejected frame nodes do not redirect cursor commands to the outer frame', () => {
    const inner = createColumns('Inner', 'two').replace('[!abele-columns', '[!ABELE-COLUMNS'),
      text = textInFrame(inner)
    show(text)
    const result = evaluate<{ options: boolean; remove: boolean; text: string }>(
      `const lines=view.editor.getValue().split('\\n');view.editor.setCursor({line:lines.findIndex(line=>line.includes('Inner')),ch:8});app.workspace.activeEditor=view;return {options:app.commands.commands['abele:column-options'].editorCheckCallback(true,view.editor,view),remove:app.commands.commands['abele:remove-columns'].editorCheckCallback(false,view.editor,view),text:view.editor.getValue()}`
    )
    expect(result).toEqual({ options: false, remove: false, text })
  })
  it('cursor commands refuse list-contained frames and foreign quote barriers', async () => {
    const inner = createColumns('Nested passage', 'two')
    for (const body of [
      ...['ABELE-COLUMNS', 'abele-columns'].map(
        (type) =>
          '- > [!' +
          type +
          ']\n  > > [!abele-column]\n  > > Nested passage\n  >\n  > > [!abele-column]\n  > > Nested sibling'
      ),
      '- > [!note] Annotation\n  > Nested passage',
      '- > Ordinary quote\n  > Nested passage',
      '1. List lead\n\n' +
        inner
          .split('\n')
          .map((line) => '   ' + line)
          .join('\n'),
    ]) {
      const text = textInFrame(body)
      show(text)
      const result = evaluate<{ options: boolean; remove: boolean; text: string }>(
        `const lines=view.editor.getValue().split('\\n'),line=lines.findIndex(line=>line.includes('Nested passage'));view.editor.setCursor({line,ch:lines[line].indexOf('Nested passage')});app.workspace.activeEditor=view;return {options:app.commands.commands['abele:column-options'].editorCheckCallback(true,view.editor,view),remove:app.commands.commands['abele:remove-columns'].editorCheckCallback(false,view.editor,view),text:view.editor.getValue()}`
      )
      expect(result).toEqual({ options: false, remove: false, text })
    }
    await shot('list-quote-barriers-refused')
  })
  it('wrapper quotes cannot hide list ancestry from controls or cursor commands', async () => {
    for (const depth of [1, 3]) {
      let wrapped = createColumns('Nested passage', 'two')
      for (let i = 0; i < depth; i++)
        wrapped =
          '> Wrapper passage\n>\n' +
          wrapped
            .split('\n')
            .map((line) => '> ' + line)
            .join('\n')
      const text =
        '- List lead\n\n' +
        wrapped
          .split('\n')
          .map((line) => '  ' + line)
          .join('\n') +
        '\n\nAfter.'
      for (const mode of ['preview', 'source']) {
        show(text, mode)
        if (mode === 'preview') click(point('.abele-columns-controls button'))
        else {
          const controls = evaluate<number>(
            `return root().querySelectorAll('.abele-columns-controls button').length`
          )
          expect(controls).toBe(0)
        }
        const result = evaluate<{ menu: boolean; text: string }>(
          `await wait(200);return {menu:!!document.querySelector('.menu'),text:view.getMode()==='source'?view.editor.getValue():await app.vault.read(view.file)}`
        )
        expect(result).toEqual({ menu: false, text })
        if (mode === 'source') {
          const commands = evaluate<{ options: boolean; remove: boolean; text: string }>(
            `const lines=view.editor.getValue().split('\\n'),line=lines.findIndex(line=>line.includes('Nested passage'));view.editor.setCursor({line,ch:lines[line].indexOf('Nested passage')});app.workspace.activeEditor=view;return {options:app.commands.commands['abele:column-options'].editorCheckCallback(true,view.editor,view),remove:app.commands.commands['abele:remove-columns'].editorCheckCallback(false,view.editor,view),text:view.editor.getValue()}`
          )
          expect(commands).toEqual({ options: false, remove: false, text })
        }
        await shot('list-ancestry-' + depth + '-' + mode)
      }
    }
  })
  it('a later post-processor cannot reassign a frame before the first menu lookup', async () => {
    const text = textInFrame(
      createColumns('First', 'two') + '\n\n' + createColumns('Second', 'two')
    )
    evaluate(
      `window.__columnReorder=false;window.__columnReorderProcessor=app.plugins.plugins.abele.registerMarkdownPostProcessor((el,ctx)=>{if(!window.__columnReorder||ctx.sourcePath!==${JSON.stringify(NOTE)})return;const frames=el.querySelectorAll('.abele-columns .abele-columns');if(frames.length>=2){frames[0].before(frames[1]);window.__columnReorders++}},100);return true`
    )
    try {
      for (const mode of ['preview', 'source']) {
        evaluate(`window.__columnReorders=0;window.__columnReorder=true;return true`)
        show(text, mode)
        const reordered = evaluate<boolean>(
          `const frames=root().querySelectorAll('.abele-columns .abele-columns');return window.__columnReorders>0&&frames[0].textContent.includes('Second')`
        )
        expect(reordered).toBe(true)
        const result = evaluate<{ menu: boolean; text: string }>(
          `const frames=root().querySelectorAll('.abele-columns .abele-columns'),second=[...frames].find(frame=>frame.textContent.includes('Second'));second.querySelector('.abele-columns-controls button').click();await wait(200);return {menu:!!document.querySelector('.menu'),text:view.getMode()==='source'?view.editor.getValue():await app.vault.read(view.file)}`
        )
        expect(result).toEqual({ menu: false, text })
        await shot('render-time-identity-' + mode)
      }
    } finally {
      evaluate(
        `window.__columnReorder=false;window.__abeleTest.rendering.MarkdownPreviewRenderer.unregisterPostProcessor(window.__columnReorderProcessor);delete window.__columnReorderProcessor;return true`
      )
    }
  })

  it('highlight markers do not shift the caret before following prose', async () => {
    const text = textInFrame('A ==B== C')
    show(text)
    // The final text node is " C". Hit its C at the leading edge, not a markup delimiter.
    click(point('.abele-column p', 1))
    const result = evaluate<{ line: string; ch: number; selected: number; rendered: boolean }>(
      `await wait(300);const pos=view.editor.getCursor();return {line:view.editor.getLine(pos.line),ch:pos.ch,selected:view.editor.getSelection().length,rendered:!!root().querySelector('.abele-columns')}`
    )
    expect(result).toEqual({ line: '> > A ==B== C', ch: 12, selected: 0, rendered: false })
    await shot('highlight-entry')
  })
  it('inline math does not disable entry into the following ordinary paragraph', async () => {
    const text = textInFrame('Result $x$.\n\nEdit here.')
    show(text)
    click(point('.abele-column p:nth-of-type(2)'))
    const result = evaluate<{ line: string; selected: number; rendered: boolean }>(
      `await wait(300);return {line:view.editor.getLine(view.editor.getCursor().line),selected:view.editor.getSelection().length,rendered:!!root().querySelector('.abele-columns')}`
    )
    expect(result).toEqual({ line: '> > Edit here.', selected: 0, rendered: false })
    await shot('inline-math-entry')
  })
  it('links retain their native context menu rather than column operations', async () => {
    show(textInFrame('A [[Sample column safety|sample link]].'), 'preview')
    click(point('.abele-column a.internal-link'), true)
    const titles = evaluate<string[]>(
      `await wait(500);return [...document.querySelectorAll('.menu-item-title')].map(e=>e.textContent)`
    )
    expect(titles.some((title) => /new tab/i.test(title))).toBe(true)
    expect(titles).not.toContain('Add column')
    expect(titles).not.toContain('Remove columns')
    await shot('link-menu')
    evaluate(`document.body.click();return true`)
  })
})
