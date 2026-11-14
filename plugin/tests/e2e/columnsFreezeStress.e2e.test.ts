import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createColumns } from '../../src/columns/operations'
import { COLUMN_FLIGHT_FLAG } from '../../src/columns/flight'
import { COLUMNS_FIXTURE_PREFIX, columnsFixtureCleanup } from './helpers/columnsFixture'
import { evalRaw } from './helpers/obsidianCli'
import { tap } from './helpers/phone'
import { onPhone, requested, targets } from './helpers/target'

targets('phone')

const arm = process.env.ABELE_COLUMNS_STRESS
// Keep requested() visible to the batch's opt-in scanner. The two recording arms also opt in.
const enabled = requested('ABELE_COLUMNS_STRESS') || arm === 'off' || arm === 'on'
const RUN = randomUUID()
const EMBED = `Sample embed ${RUN}`
const PICTURE = `Sample picture ${RUN}.svg`
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
  `> > ![[${PICTURE}]]`,
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
  `> > ![[${EMBED}]]`,
  '',
  'After the columns.',
  '',
].join('\n')
const STEP_MS = 8_000
const BATCH_MS = 140_000
const batches = Array.from({ length: 10 }, (_, batch) => batch * 10 + 1)
// Same generated nested fixture as columnSafety, including the rejected annotation.
const nested =
  createColumns(
    createColumns('First', 'two').replace('\n', '\n> <!-- annotation -->\n') +
      '\n\n' +
      createColumns('Second', 'two'),
    'two'
  ) + '\n\nAfter.\n'
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
const settle = `await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);await wait(50);`

function fixture(label: string, initial: string) {
  const folder = COLUMNS_FIXTURE_PREFIX + RUN + ' ' + label
  const note = folder + '/Sample.md'
  let owned = false
  let unresponsive = false
  let priorFlag: string | null = null
  let flagOwned = false
  let deadline = 0
  const prelude = `const wait=ms=>new Promise(r=>setTimeout(r,ms));const leaf=app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path===${JSON.stringify(note)});const view=leaf?.view;const root=()=>view.getMode()==='preview'?view.previewMode.containerEl:view.editor.cm.dom;`
  function step<T = boolean>(iteration: number, name: string, code: string): T {
    const phase = `${label} arm=${arm} iteration=${iteration} step=${name}`
    console.info('[columns-freeze-stress] ' + phase)
    if (deadline && Date.now() >= deadline) throw new Error(phase + ': batch exceeded 140s')
    let raw: string
    try {
      // The transport bounds each attempt; its one cached-reply retry never replays the action.
      raw = evalRaw(`(async()=>JSON.stringify(await(async()=>{${prelude}${code}})()))()`, STEP_MS)
    } catch (error) {
      unresponsive = true
      throw new Error(
        phase + ': eval did not answer (8s per attempt, transport grace/retry): ' + String(error)
      )
    }
    if (raw.startsWith('Error:')) throw new Error(phase + ': ' + raw)
    try {
      return JSON.parse(raw) as T
    } catch {
      throw new Error(phase + ': invalid eval response: ' + raw.slice(0, 300))
    }
  }
  function gesture(iteration: number, name: string, point: { x: number; y: number }) {
    console.info(`[columns-freeze-stress] ${label} arm=${arm} iteration=${iteration} step=${name}`)
    tap(point.x, point.y)
  }
  function show(mode: 'preview' | 'source') {
    step(
      0,
      'write ' + mode,
      `await app.vault.modify(view.file,${JSON.stringify(initial)});return true`
    )
    step(
      0,
      'open ' + mode,
      `await leaf.setViewState({type:'markdown',state:{file:${JSON.stringify(note)},mode:${JSON.stringify(mode)},source:false}});return true`
    )
    if (mode === 'source') {
      step(0, 'replace source', `view.editor.setValue(${JSON.stringify(initial)});return true`)
      step(
        0,
        'move caret',
        `view.editor.setCursor({line:view.editor.lineCount()-1,ch:0});return true`
      )
    }
    step(0, 'settle ' + mode, `await wait(500);return true`)
  }
  beforeAll(() => {
    expect(onPhone()).toBe(true)
    expect(['off', 'on']).toContain(arm)
    step(0, 'create fixture', `await app.vault.createFolder(${JSON.stringify(folder)});return true`)
    owned = true
    step(
      0,
      'open fixture',
      `await app.vault.create(${JSON.stringify(folder + '/' + EMBED + '.md')},'Embedded paragraph.');await app.vault.create(${JSON.stringify(folder + '/' + PICTURE)},'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect x="5" y="5" width="110" height="30" fill="none" stroke="currentColor"/></svg>');const file=await app.vault.create(${JSON.stringify(note)},${JSON.stringify(initial)});await app.workspace.getLeaf('tab').openFile(file);app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse();return true`
    )
    priorFlag = step<string | null>(
      0,
      'read recorder flag',
      `return localStorage.getItem(${JSON.stringify(COLUMN_FLIGHT_FLAG)})`
    )
    flagOwned = true
    step(
      0,
      'select recorder arm',
      `${arm === 'on' ? `localStorage.setItem(${JSON.stringify(COLUMN_FLIGHT_FLAG)},String(performance.timeOrigin))` : `localStorage.removeItem(${JSON.stringify(COLUMN_FLIGHT_FLAG)})`};window.dispatchEvent(new StorageEvent('storage',{key:${JSON.stringify(COLUMN_FLIGHT_FLAG)}}));return true`
    )
  })
  beforeEach(() => {
    if (unresponsive)
      throw new Error('Phone stopped answering; preserve the flight buffer and stop this file')
    deadline = Date.now() + BATCH_MS
  })
  afterAll(() => {
    deadline = 0
    // A dead page cannot clean up. Preserve its last buffer instead of sending more evaluations.
    if (unresponsive) return
    try {
      if (owned)
        step(
          0,
          'cleanup fixture',
          `document.querySelectorAll('.menu').forEach(menu=>menu.remove());${columnsFixtureCleanup(folder)}`
        )
    } finally {
      if (flagOwned && !unresponsive)
        step(
          0,
          'restore recorder flag',
          `${priorFlag === null ? `localStorage.removeItem(${JSON.stringify(COLUMN_FLIGHT_FLAG)})` : `localStorage.setItem(${JSON.stringify(COLUMN_FLIGHT_FLAG)},${JSON.stringify(priorFlag)})`};window.dispatchEvent(new StorageEvent('storage',{key:${JSON.stringify(COLUMN_FLIGHT_FLAG)}}));return true`
        )
    }
  })
  return { step, gesture, show }
}

describe.runIf(enabled)('columns freeze: rejected first nested frame source replacement', () => {
  const f = fixture('nested', nested)
  it('retains rejected-button identity through preview and source transitions', () => {
    for (const mode of ['preview', 'source'] as const) {
      f.show(mode)
      const point = f.step<{ x: number; y: number }>(
        0,
        'locate rejected toolbar',
        `const button=root().querySelector('.abele-columns .abele-columns:first-of-type .abele-columns-controls button');button.scrollIntoView({block:'center'});await wait(150);const r=button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}`
      )
      f.gesture(0, 'tap rejected toolbar', point)
      expect(
        f.step(
          0,
          'assert rejected toolbar',
          `await wait(300);return {menus:document.querySelectorAll('.menu').length,text:view.getMode()==='source'?view.editor.getValue():await app.vault.read(view.file)}`
        )
      ).toEqual({ menus: 0, text: nested })
      const second = f.step<{ x: number; y: number }>(
        0,
        'locate second toolbar',
        `const button=root().querySelectorAll('.abele-columns .abele-columns .abele-columns-controls button')[1];button.scrollIntoView({block:'center'});await wait(100);const r=button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}`
      )
      f.gesture(0, 'tap second toolbar', second)
      expect(
        f.step(
          0,
          'choose proportions',
          `await wait(200);const item=[...document.querySelectorAll('.menu-item')].find(e=>e.querySelector('.menu-item-title')?.textContent==='Proportions 2:1');if(!item)return false;item.click();await wait(250);return true`
        )
      ).toBe(true)
      const updated = f.step<string>(
        0,
        'assert second frame edit',
        `if(view.getMode()==='source')await view.save();return await app.vault.read(view.file)`
      )
      expect([...updated.matchAll(/\[!abele-columns\|ratio=([^ ]+)/g)].map((m) => m[1])).toEqual([
        '1:1',
        '1:1',
        '2:1',
      ])
      expect(updated).toContain('<!-- annotation -->')
    }
  })
  it.each(batches)('replaces source for iterations %i through the next nine', async (start) => {
    for (let iteration = start; iteration < start + 10; iteration++) {
      f.step(
        iteration,
        'replace editor source',
        `view.editor.setValue(${JSON.stringify(nested)});return true`
      )
      expect(
        f.step(
          iteration,
          'move caret and assert source',
          `view.editor.setCursor({line:${iteration % 2}?view.editor.lineCount()-1:0,ch:0});${settle}return {text:view.editor.getValue(),selected:view.editor.getSelection().length}`
        )
      ).toEqual({ text: nested, selected: 0 })
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  })
})

describe.runIf(enabled)(
  'columns freeze: focused passage and duplicate formatted replacement',
  () => {
    const f = fixture('focused', BODY)
    beforeAll(() => f.show('source'))
    it.each(batches)('enters passages for iterations %i through the next nine', async (start) => {
      for (let iteration = start; iteration < start + 10; iteration++) {
        f.step(
          iteration,
          'replace large source',
          `view.editor.setValue(${JSON.stringify(BODY)});return true`
        )
        const passage = f.step<{ x: number; y: number }>(
          iteration,
          'focus and locate passage',
          `view.editor.setCursor({line:view.editor.lineCount()-1,ch:0});view.editor.focus();await wait(300);const p=[...root().querySelectorAll('.abele-column p')].find(e=>e.textContent.includes('Second column paragraph.'));p.scrollIntoView({block:'center'});await wait(100);const keyboard=parseFloat(getComputedStyle(document.body).getPropertyValue('--keyboard-height'))||0;const bottom=Math.min(innerHeight-keyboard,window.visualViewport?.height??innerHeight);const desired=Math.max(140,Math.min(240,bottom-100));const before=p.getBoundingClientRect();view.editor.cm.scrollDOM.scrollTop+=before.y+before.height/2-desired;await wait(200);const r=p.getBoundingClientRect();return {x:r.x+40,y:r.y+r.height/2}`
        )
        f.gesture(iteration, 'tap focused passage', passage)
        expect(
          f.step(
            iteration,
            'assert focused passage',
            `await wait(300);return {line:view.editor.getLine(view.editor.getCursor().line),selected:view.editor.getSelection().length,rendered:!!root().querySelector('.abele-columns'),focused:view.editor.cm.hasFocus}`
          )
        ).toEqual({
          line: '> > Second column paragraph.',
          selected: 0,
          rendered: false,
          focused: true,
        })
        f.step(
          iteration,
          'replace duplicate source',
          `view.editor.setValue(${JSON.stringify(duplicate)});return true`
        )
        const point = f.step<{ x: number; y: number }>(
          iteration,
          'move caret and locate duplicate',
          `view.editor.setCursor({line:8,ch:0});${settle}await wait(300);const strong=root().querySelectorAll('.abele-column strong')[1];strong.scrollIntoView({block:'center'});await wait(100);const range=document.createRange();range.setStart(strong.firstChild,2);range.setEnd(strong.firstChild,3);const r=range.getBoundingClientRect();return {x:r.x+0.1,y:r.y+r.height/2}`
        )
        f.gesture(iteration, 'tap duplicate passage', point)
        expect(
          f.step(
            iteration,
            'assert duplicate passage',
            `await wait(400);return {cursor:view.editor.getCursor(),selected:view.editor.getSelection().length,text:view.editor.getValue()}`
          )
        ).toEqual({ cursor: { line: 5, ch: 13 }, selected: 0, text: duplicate })
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    })
  }
)
