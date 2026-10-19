import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildProseEpub } from '../fixtures/books/proseBook'
import {
  enterPhone,
  evalLong,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { WAIT_PRELUDE } from './helpers/wait'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const folder = `Sample zen touch ${randomUUID()}`
const shots = shotDir('zen-top-touch')
const command = `app.commands.executeCommandById(Object.keys(app.commands.commands).find(id => id.endsWith(':toggle-zen-mode')))`
const run = async <T>(body: string): Promise<T> =>
  JSON.parse(await evalLong(`(async () => { ${WAIT_PRELUDE}; ${body} })()`)) as T
let layout: unknown
let reader: unknown

beforeAll(async () => {
  if (!available) return
  layout = await run('return app.workspace.getLayout()')
  reader = await run('return window.__abeleTest.AbeleConfig.getInstance().reader')
  await enterPhone(390, 844)
  const data = Buffer.from(buildProseEpub()).toString('base64')
  await run(`
    window.__abeleTest.reader.zen.set(false);
    if (document.body.classList.contains('abele-zen')) ${command};
    await app.vault.createFolder(${JSON.stringify(folder)});
    await app.vault.create(${JSON.stringify(folder + '/Sample.md')}, '# Sample page\\n\\nWords at the start of a page.');
    const bytes = Uint8Array.from(atob(${JSON.stringify(data)}), c => c.charCodeAt(0));
    await app.vault.createBinary(${JSON.stringify(folder + '/Sample.epub')}, bytes.buffer);
    const cfg = window.__abeleTest.AbeleConfig.getInstance();
    cfg.reader = { ...cfg.reader, margin: 'narrow' };
    await cfg.saveSettings();
    return true;
  `)
})

afterAll(async () => {
  if (!available) return
  try {
    await run(`
      window.__abeleTest.reader.zen.set(false);
      if (document.body.classList.contains('abele-zen')) ${command};
      const leaves = [];
      app.workspace.iterateAllLeaves(leaf => {
        if (leaf.view.file?.path?.startsWith(${JSON.stringify(folder + '/')})) leaves.push(leaf);
      });
      for (const leaf of leaves) leaf.detach();
      const dir = app.vault.getAbstractFileByPath(${JSON.stringify(folder)});
      if (dir) await app.vault.delete(dir, true);
      const cfg = window.__abeleTest.AbeleConfig.getInstance();
      cfg.reader = ${JSON.stringify(reader)};
      await cfg.saveSettings();
      return true;
    `)
  } finally {
    if (!onPhone()) await reloadApp('app.emulateMobile(false)')
    if (layout)
      await run(`await app.workspace.changeLayout(${JSON.stringify(layout)}); return true`)
  }
})

describe.runIf(available)('first line touch in phone zen', () => {
  for (const book of [true, false]) {
    it(`lets the ${book ? 'book' : 'markdown'} receive touches through the hidden header`, async () => {
      const result = await run<{
        hit: string
        reachesText: boolean
        headerPointer: string
        afterPointer: string
        revealedPointer: string
        selected: string
      }>(`
        const leaf = app.workspace.getLeaf('tab');
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(folder + (book ? '/Sample.epub' : '/Sample.md'))});
        if (${book}) await leaf.setViewState({ type: 'abele-book', state: { file: file.path }, active: true });
        else await leaf.openFile(file, { state: { mode: 'preview' } });
        app.workspace.setActiveLeaf(leaf, { focus: true });
        const view = leaf.view;
        if (!await until(() => ${book ? "view.model?.status === 'ready' && view.engine?.renderer?.getContents()[0]?.doc?.fonts.status === 'loaded'" : "view.containerEl.querySelector('.markdown-preview-view h1')"}))
          throw new Error('page not ready');
        if (${book}) {
          view.model.panel = false;
          // A prose page starts with text at the top, without a chapter title's margin.
          const before = view.engine.lastLocation?.cfi;
          await view.engine.next();
          if (!await until(() => view.engine.lastLocation?.cfi !== before)) throw new Error('page did not turn');
          window.__abeleTest.reader.zen.set(true);
        }
        else { ${command}; }
        const header = view.containerEl.querySelector('.view-header');
        if (!await until(() => getComputedStyle(header).opacity === '0' &&
          !view.containerEl.getAnimations({subtree:true}).some(a => a.playState === 'running')))
          throw new Error('header did not hide');
        // Hit-test the first visible text rectangle, through each shadow root to the iframe.
        const doc = ${book ? 'view.engine.renderer.getContents()[0].doc' : 'document'};
        const root = ${book ? 'doc.body' : "view.containerEl.querySelector('.markdown-preview-view')"};
        const frame = ${book ? 'doc.defaultView.frameElement' : 'null'};
        const offset = frame?.getBoundingClientRect() ?? {left:0, top:0};
        const page = ${book ? "view.contentEl.querySelector('.abele-book-reader__stage')" : 'root'}.getBoundingClientRect();
        const walker = doc.createTreeWalker(root, 4);
        const candidates = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent.trim()) continue;
          const range = doc.createRange(); range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            const x = offset.left + rect.left + rect.width / 2;
            const y = offset.top + rect.top + rect.height / 2;
            if (rect.width && x >= page.left && x <= page.right && y >= page.top && y <= page.bottom)
              candidates.push({x, y, range:range.cloneRange()});
          }
        }
        candidates.sort((a,b) => a.y-b.y || a.x-b.x);
        const first = candidates[0];
        if (!first) throw new Error('no visible text');
        // The renderer uses closed shadow roots. Reach them through the known iframe rather
        // than mistaking the public engine host for a touch interceptor.
        const roots = new Map();
        for (let root = frame?.getRootNode(); root?.host; root = root.host.getRootNode())
          roots.set(root.host, root);
        let hit = document.elementFromPoint(first.x, first.y);
        while (hit && (hit.shadowRoot || roots.has(hit))) {
          const inner = (hit.shadowRoot || roots.get(hit)).elementFromPoint(first.x, first.y);
          if (!inner || inner === hit) break;
          hit = inner;
        }
        const reachesText = ${book ? 'hit === frame' : 'root.contains(hit)'};
        const headerPointer = getComputedStyle(header).pointerEvents;
        const afterPointer = getComputedStyle(header, '::after').pointerEvents;
        const selection = doc.getSelection();
        selection.removeAllRanges();
        if (window.__e2eHost) {
          await window.__e2eHost.longPress(first.x, first.y);
          if (!await until(() => selection.toString().trim().length > 0))
            throw new Error('long press did not select first-line text');
        } else {
          // Select only this line, not the rest of its paragraph on later pages.
          const range = first.range.cloneRange(), node = range.startContainer;
          let start = -1, end = 0;
          for (let i = 0; i < node.length; i++) {
            range.setStart(node, i); range.setEnd(node, i + 1);
            const r = range.getBoundingClientRect();
            if (r.width && r.top + offset.top <= first.y && r.bottom + offset.top >= first.y &&
                r.left + offset.left >= page.left && r.right + offset.left <= page.right) {
              if (start < 0) start = i;
              end = i + 1;
            }
          }
          if (start < 0) throw new Error('first line has no letters');
          range.setStart(node, start); range.setEnd(node, end);
          selection.addRange(range);
        }
        const selected = selection.toString();
        if (${book} && !await until(() => view.model.selection)) throw new Error('reader did not receive selection');
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (window.__e2eHost) await window.__e2eHost.shot(${JSON.stringify(shots + '/' + (book ? 'book' : 'markdown') + '-first-line.png')});
        else {
          const fs = require('fs'); fs.mkdirSync(${JSON.stringify(shots)}, {recursive:true});
          const image = await require('@electron/remote').getCurrentWebContents().capturePage();
          fs.writeFileSync(${JSON.stringify(shots + '/' + (book ? 'book' : 'markdown') + '-first-line.png')}, image.toPNG());
        }
        selection.removeAllRanges();
        // The existing reveal mechanism must restore interactive controls.
        if (${book}) view.zenChrome.middleTap();
        else view.containerEl.querySelector('.abele-zen__top').click();
        if (!await until(() => getComputedStyle(header).opacity === '1')) throw new Error('peek did not reveal header');
        const revealedPointer = getComputedStyle(header).pointerEvents;
        if (${book}) window.__abeleTest.reader.zen.set(false);
        else { ${command}; }
        leaf.detach();
        return {hit:hit?.className || hit?.tagName, reachesText, headerPointer, afterPointer, revealedPointer, selected};
      `)
      expect(result.reachesText, JSON.stringify(result)).toBe(true)
      expect(result.headerPointer).toBe('none')
      expect(result.afterPointer).toBe('none')
      expect(result.revealedPointer).toBe('auto')
      expect(result.selected.length).toBeGreaterThan(0)
    }, 120_000)
  }
})
