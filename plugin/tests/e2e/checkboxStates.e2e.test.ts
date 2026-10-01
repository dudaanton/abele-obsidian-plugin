import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalJson, evalRaw, reloadApp } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { WAIT_PRELUDE } from './helpers/wait'
import { onPhone, targets } from './helpers/target'

targets('desktop', 'phone')
const NOTE = 'sample-checkbox-states.md'
const BODY =
  'Sample checklist\n\n- [ ] Open\n- [/] In progress\n- [x] Done\n- [-] Cancelled\n- [>] Forwarded\n- [<] Scheduled\n- [?] Question\n- [!] Important\n\n```md\n- [ ] Code example\n```\n'
const asyncEval = <T>(body: string): T => {
  const raw = evalRaw(
    `(async () => { ${WAIT_PRELUDE} ${body} })().then(value => JSON.stringify(value))`
  )
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(`Checkbox eval failed: ${raw}`)
  }
}
let layout: unknown

beforeAll(() => {
  layout = evalJson('app.workspace.getLayout()')
  asyncEval(
    `const f = await app.vault.create(${JSON.stringify(NOTE)}, ${JSON.stringify(BODY)}); await app.workspace.getLeaf(false).openFile(f); return true;`
  )
})
afterAll(() => {
  asyncEval(
    `document.querySelectorAll('.menu').forEach(el => el.remove()); const f = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}); if (f) await app.vault.delete(f); await app.workspace.changeLayout(${JSON.stringify(layout)}); return true;`
  )
})

function mode(value: 'source' | 'preview') {
  asyncEval(
    `const leaf = app.workspace.getMostRecentLeaf(); await leaf.setViewState({type:'markdown', state:{file:${JSON.stringify(NOTE)}, mode:${JSON.stringify(value)}, source:false}}); if (!await until(() => leaf.view.contentEl.querySelector(${JSON.stringify(value === 'source' ? '.cm-content input[data-task="/"]' : '.markdown-preview-view li[data-task="/"] input')}))) throw new Error('Checkbox surface did not render: ${value}'); return true;`
  )
}

for (const surface of ['source', 'preview'] as const) {
  describe(`inline checkboxes in ${surface}`, () => {
    it('draws six distinct alternate icons, not six completed checkmarks', () => {
      mode(surface)
      const masks = evalJson<string[]>(
        `(() => { const root = app.workspace.getMostRecentLeaf().view.contentEl.querySelector(${JSON.stringify(surface === 'source' ? '.cm-content' : '.markdown-preview-view')}); return Array.from(root.querySelectorAll('input.task-list-item-checkbox')).map(el => getComputedStyle(el, '::after').maskImage); })()`
      )
      expect(masks).toHaveLength(8)
      const alternate = [1, 3, 4, 5, 6, 7].map((i) => masks[i])
      expect(alternate.every((mask) => mask.includes('data:image/svg+xml'))).toBe(true)
      expect(new Set(alternate).size).toBe(6)
    })
    it('offers all states on the checkbox context menu and writes only the selected marker', () => {
      mode(surface)
      const labels = asyncEval<string[]>(
        `const root = app.workspace.getMostRecentLeaf().view.contentEl.querySelector(${JSON.stringify(surface === 'source' ? '.cm-content' : '.markdown-preview-view')}); const input = root.querySelectorAll('input.task-list-item-checkbox')[1]; input.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:80, clientY:180})); await until(() => document.querySelector('.menu')); return Array.from(document.querySelectorAll('.menu-item-title')).map(el => el.textContent);`
      )
      expect(labels).toEqual([
        'Open',
        'In progress',
        'Done',
        'Cancelled',
        'Forwarded',
        'Scheduled',
        'Question',
        'Important',
      ])
      const written = asyncEval<string>(
        `Array.from(document.querySelectorAll('.menu-item')).find(el => el.textContent.includes('Important')).click(); const f = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}); const text = await until(async () => { const text = await app.vault.read(f); return text.includes('- [!] In progress') ? text : null }); await app.vault.modify(f, ${JSON.stringify(BODY)}); return text;`
      )
      expect(written).toBe(BODY.replace('- [/] In progress', '- [!] In progress'))
    })
  })
}

it('edits nested and quoted reading-view items at their actual source lines', () => {
  mode('source')
  const body = BODY + '\n- [/] Parent\n  - [?] Nested item\n\n> - [>] Quoted item\n'
  asyncEval(
    `const view = app.workspace.getMostRecentLeaf().view; view.editor.setValue(${JSON.stringify(body)}); await view.save(); return true;`
  )
  mode('preview')
  const result = asyncEval<string>(`
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)});
    const names = ['Nested item', 'Quoted item'];
    const findInput = (text) => {
      const root = app.workspace.getMostRecentLeaf().view.contentEl.querySelector('.markdown-preview-view');
      const li = Array.from(root?.querySelectorAll('li.task-list-item') ?? []).find(el => el.textContent.trim() === text);
      const input = li?.querySelector(':scope > input');
      return input?.isConnected ? input : null;
    };
    if (!await until(() => names.every(text => findInput(text)))) throw new Error('New nested and quoted rows did not render');
    for (const text of names) {
      const input = await until(() => findInput(text));
      if (!input) throw new Error('Connected checkbox missing for ' + text);
      const section = app.workspace.getMostRecentLeaf().view.previewMode.renderer.getSectionInfo(input);
      const mapping = JSON.stringify({row:text, dataLine:input.dataset.line, lineStart:section?.lineStart, lineEnd:section?.lineEnd});
      const previous = new Set(document.querySelectorAll('.menu'));
      input.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:80, clientY:180}));
      const menu = await until(() => Array.from(document.querySelectorAll('.menu')).find(el => !previous.has(el)));
      if (!menu) throw new Error('Fresh state menu did not open: ' + mapping);
      const item = Array.from(menu.querySelectorAll('.menu-item')).find(el => el.textContent.includes('Scheduled'));
      if (!item) throw new Error('Scheduled choice missing for ' + text);
      item.click();
      if (!await until(async () => (await app.vault.read(f)).includes('[<] ' + text))) throw new Error('wrong source line: ' + mapping + '; file=' + await app.vault.read(f));
      if (!await until(() => findInput(text)?.parentElement.dataset.task === '<')) throw new Error('Updated row did not render for ' + text);
    }
    const text = await app.vault.read(f);
    await app.vault.modify(f, ${JSON.stringify(BODY)});
    return text;
  `)
  expect(result).toBe(
    body.replace('[?] Nested item', '[<] Nested item').replace('[>] Quoted item', '[<] Quoted item')
  )
})

it('cycles the current line with undo and refuses fenced code', () => {
  mode('source')
  const result = asyncEval<{ cycled: string; undone: string; code: boolean }>(`
    const view = app.workspace.getMostRecentLeaf().view;
    const editor = view.editor;
    editor.setValue(${JSON.stringify(BODY)});
    editor.setCursor({line:3, ch:8});
    app.commands.executeCommandById('abele:cycle-checkbox-state');
    const cycled = editor.getValue();
    editor.undo();
    const undone = editor.getValue();
    editor.setCursor({line:12, ch:8});
    const code = app.commands.commands['abele:cycle-checkbox-state'].editorCheckCallback(true, editor, view);
    editor.setCursor({line:0, ch:0});
    await view.save();
    return {cycled, undone, code};
  `)
  expect(result.cycled).toBe(BODY.replace('- [/] In progress', '- [x] In progress'))
  expect(result.undone).toBe(BODY)
  expect(result.code).toBe(false)
})

it('keeps a normal reading-view click native', () => {
  mode('preview')
  const text = asyncEval<string>(`
    const view = app.workspace.getMostRecentLeaf().view;
    view.contentEl.querySelector('.markdown-preview-view li[data-task="/"] input').click();
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)});
    const text = await until(async () => { const value = await app.vault.read(f); return value !== ${JSON.stringify(BODY)} && value; });
    await app.vault.modify(f, ${JSON.stringify(BODY)});
    return text;
  `)
  expect(text).toBe(BODY.replace('- [/] In progress', '- [ ] In progress'))
})

it('fits the state menu and all icons at phone width after a hold', async () => {
  const shots = shotDir('checkboxes')
  if (!onPhone()) {
    await reloadApp('app.emulateMobile(true)')
    evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390, 844)`)
    await reloadApp()
  }
  try {
    for (const surface of ['source', 'preview'] as const) {
      mode(surface)
      const result = asyncEval<{ labels: string[]; fits: boolean; masks: number }>(`
        const view = app.workspace.getMostRecentLeaf().view;
        const root = view.contentEl.querySelector(${JSON.stringify(surface === 'source' ? '.cm-content' : '.markdown-preview-view')});
        const inputs = Array.from(root.querySelectorAll('input.task-list-item-checkbox'));
        const input = inputs[1];
        const r = input.getBoundingClientRect();
        input.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, pointerType:'touch', pointerId:1, clientX:r.x+r.width/2, clientY:r.y+r.height/2}));
        await wait(650);
        input.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, pointerType:'touch', pointerId:1}));
        const menu = await until(() => document.querySelector('.menu'));
        if (!menu) throw new Error('hold did not open the state menu');
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const labels = Array.from(menu.querySelectorAll('.menu-item-title')).map(el => el.textContent);
        const fits = !!await until(() => { const bounds = menu.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight; });
        const masks = new Set([1,3,4,5,6,7].map(i => getComputedStyle(inputs[i], '::after').maskImage)).size;
        ${onPhone() ? '' : `require('fs').writeFileSync(${JSON.stringify(shots + '/' + surface + '.png')}, (await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());`}
        Array.from(menu.querySelectorAll('.menu-item')).find(el => el.textContent.includes('In progress')).click();
        return {labels, fits, masks};
      `)
      expect(result.labels).toEqual([
        'Open',
        'In progress',
        'Done',
        'Cancelled',
        'Forwarded',
        'Scheduled',
        'Question',
        'Important',
      ])
      expect(result.fits).toBe(true)
      expect(result.masks).toBe(6)
    }
  } finally {
    if (!onPhone()) await reloadApp('app.emulateMobile(false)')
  }
}, 120_000)
