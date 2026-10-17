/**
 * Small design catalogue contracts checked in the phone layout: finger-sized targets, one visible
 * dismissal, readable narrow rows, row glyphs inside their hit boxes and native control paint.
 *
 * Each used to be its own file that turned the window into a phone and back, for one probe.
 * They now run inside `phoneLayout.e2e.test.ts`, which is a phone at 390×844 already, so every
 * check here assumes that window and leaves it as it found it. The dismissal and state cues are
 * checked on a desktop too (`DESKTOP_CATALOGUE_CONTRACTS`), before that file becomes a phone.
 */
import { expect } from 'vitest'
import { evalLong } from './obsidianCli'
import { measureDesign } from './designLint'
import { shotDir } from './shots'
import { KIT_COLORS } from '../../../src/constants/colors'
import { designCaptureExpression } from '../../helpers/designCapture'
import { lintDesign, type DesignSnapshot } from '../../helpers/designLint'

const directory = process.env.DESIGN_LINT_OUT_DIR ?? shotDir('design-lint')

type Contract = [name: string, check: () => Promise<void>]

/** One visible way to dismiss each catalogue dialog, and the agent row's disclosure and states. */
async function dismissalAndStateCues(): Promise<void> {
  const result = JSON.parse(
    await evalLong(`(async()=>{
    try {
      const dismiss=[];
      for(const page of ['waiting','comment','confirm','icon-picker']) {
        window.__abeleTest.openDesignCatalogue(page);await new Promise(r=>setTimeout(r,500));
        const modal=document.querySelector('.modal');
        dismiss.push([...modal.querySelectorAll('.modal-close-button,.modal-header-button.mod-raised,button')].filter(el=>{
          const b=el.getBoundingClientRect();return b.width&&b.height&&(el.matches('.modal-close-button,.modal-header-button.mod-raised')||['Cancel','Close'].includes(el.textContent.trim()));
        }).length);
      }
      window.__abeleTest.openDesignCatalogue('waiting');await new Promise(r=>setTimeout(r,300));
      const row=document.querySelector('.abele-list-row'),title=row.querySelector('.abele-list-row__main');
      const before=title.getAttribute('aria-expanded');title.click();await new Promise(r=>setTimeout(r,50));
      const collapsed=title.getAttribute('aria-expanded');title.click();await new Promise(r=>setTimeout(r,50));
      const statuses=[...document.querySelectorAll('.abele-list-row__state')].map(el=>({text:el.textContent.trim(),glyph:!!el.querySelector('svg'),decorative:el.querySelector('.abele-list-row__status-icon').getAttribute('aria-hidden')}));
      return {dismiss,before,collapsed,reopened:title.getAttribute('aria-expanded'),facts:row.querySelector('.abele-meta-line').textContent.trim(),statuses};
    }finally{window.__abeleTest.closeDesignCatalogue()}
  })()`)
  )
  expect(result.dismiss).toEqual([1, 1, 1, 1])
  expect([result.before, result.collapsed, result.reopened]).toEqual(['true', 'false', 'true'])
  expect(result.facts).toBe('Model: Sample model · Folder: Work')
  expect(result.statuses).toEqual([
    { text: 'Waiting for your answer', glyph: true, decorative: 'true' },
    { text: 'Working…', glyph: true, decorative: 'true' },
    { text: 'Connection lost', glyph: true, decorative: 'true' },
  ])
}

/** Checked on a desktop at 1280×800, the window put back afterwards. */
export const DESKTOP_CATALOGUE_CONTRACTS: Contract[] = [
  [
    'keeps one visible modal dismissal and native agent disclosure/state cues on a desktop',
    async () => {
      const size = JSON.parse(
        await evalLong(
          `(async()=>{const win=require('@electron/remote').getCurrentWindow(),size=win.getContentSize();win.setContentSize(1280,800);return JSON.stringify(size)})()`
        )
      ) as [number, number]
      try {
        await dismissalAndStateCues()
      } finally {
        await evalLong(
          `(async()=>{require('@electron/remote').getCurrentWindow().setContentSize(${size[0]},${size[1]});return 'ok'})()`
        )
      }
    },
  ],
]

/** Checked in the phone layout at 390×844. */
export const PHONE_CATALOGUE_CONTRACTS: Contract[] = [
  [
    'keeps nested source history readable in a narrow native row',
    async () => {
      const result = JSON.parse(
        await evalLong(`(async()=>{
      try {
        window.__abeleTest.openDesignCatalogue('artifact'); await new Promise(r=>setTimeout(r,150));
        document.querySelector('.abele-disclosure__control').click(); await new Promise(r=>setTimeout(r,150));
        const titles=[...document.querySelectorAll('.abele-event-list .abele-list-row__title-text')];
        return titles.map(el=>el.getBoundingClientRect().width);
      } finally {window.__abeleTest.closeDesignCatalogue()}
    })()`)
      ) as number[]
      expect(result.length).toBeGreaterThanOrEqual(2)
      expect(result.every((width) => width >= 80)).toBe(true)
    },
  ],
  [
    'pads a native phone checkbox hit area without resizing its painted toggle',
    async () => {
      const size = JSON.parse(
        await evalLong(
          `(async()=>{try{window.__abeleTest.openDesignCatalogue('controls');await new Promise(r=>setTimeout(r,150));const el=document.querySelector('.abele-design-catalogue [role="checkbox"]'),paint=el.querySelector('.abele-checkbox__paint')||el;return {hit:el.getBoundingClientRect().height,paint:paint.getBoundingClientRect().height}}finally{window.__abeleTest.closeDesignCatalogue()}})()`
        )
      )
      expect(size.hit).toBeGreaterThanOrEqual(44)
      expect(size.paint).toBe(30)
    },
  ],
  [
    'keeps legacy phone navigation hit boxes at least 44px without enlarging their glyphs',
    async () => {
      const result = JSON.parse(
        await evalLong(
          `(async()=>{try{window.__abeleTest.openDesignCatalogue('navigation');await new Promise(r=>setTimeout(r,150));return [...document.querySelectorAll('.abele-tabs__tab, .abele-breadcrumbs__item, .abele-fold-heading.is-collapsible, .abele-tree-item__self.is-clickable')].map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,glyph:el.querySelector('svg')?.getBoundingClientRect().width}));}finally{window.__abeleTest.closeDesignCatalogue()}})()`
        )
      ) as { width: number; height: number; glyph?: number }[]
      expect(result.length).toBeGreaterThanOrEqual(7)
      expect(result.every((r) => r.width >= 44 && r.height >= 44)).toBe(true)
      expect(result.filter((r) => r.glyph).every((r) => r.glyph! <= 20)).toBe(true)
    },
  ],
  [
    'keeps one visible modal dismissal and native agent disclosure/state cues on a phone',
    dismissalAndStateCues,
  ],
  [
    'preserves native control paint and rejects a changed search inset rather than waiving native controls',
    async () => {
      const result = JSON.parse(
        await evalLong(`(async()=>{
      try {
        window.__abeleTest.openDesignCatalogue('swatches');await new Promise(r=>setTimeout(r,300));
        const choices=[...document.querySelectorAll('.abele-swatch-picker__choice')].map(el=>({hit:el.getBoundingClientRect().height,padding:getComputedStyle(el).padding}));
        const underlinePadding=getComputedStyle(document.querySelector('.abele-swatch-picker__underline')).padding;
        window.__abeleTest.openDesignCatalogue('controls');await new Promise(r=>setTimeout(r,300));
        const slider=document.querySelector('input[type="range"]'),dropdown=document.querySelector('.abele-obsidian-dropdown');
        const geometry={slider:slider.getBoundingClientRect().height,track:getComputedStyle(slider,'::-webkit-slider-runnable-track').height,radius:parseFloat(getComputedStyle(slider).borderTopLeftRadius),overflow:dropdown.scrollWidth-dropdown.clientWidth};
        const input=document.querySelector('.abele-design-catalogue .search-input-container input');
        if(!input)throw Error('Catalogue search input is missing');
        const beforePadding=parseFloat(getComputedStyle(input).paddingLeft);
        input.style.paddingLeft=(beforePadding+5)+'px';
        if(parseFloat(getComputedStyle(input).paddingLeft)!==beforePadding+5)throw Error('Catalogue search padding fault was not applied');
        const snapshot=${designCaptureExpression('.abele-design-catalogue')};
        return {choices,underlinePadding,geometry,snapshot};
      }finally{window.__abeleTest.closeDesignCatalogue()}
    })()`)
      ) as {
        choices: { hit: number; padding: string }[]
        underlinePadding: string
        geometry: { slider: number; track: string; radius: number; overflow: number }
        snapshot: DesignSnapshot
      }
      expect(result.choices).toHaveLength(KIT_COLORS.length + 6)
      expect(result.choices.every((choice) => choice.hit >= 44 && choice.padding === '4px')).toBe(
        true
      )
      expect(result.underlinePadding).toBe('4px')
      expect(result.geometry.slider).toBeGreaterThanOrEqual(44)
      expect(result.geometry.track).toBe('6px')
      expect(result.geometry.radius).toBe(parseFloat(result.geometry.track) / 2)
      expect(result.geometry.overflow).toBeLessThanOrEqual(1)
      expect(
        lintDesign(result.snapshot).some(
          (violation) =>
            violation.rule === 'native-parity' && violation.message.startsWith('padding.3:')
        )
      ).toBe(true)
    },
  ],
  ['keeps row glyphs on the title line inside phone-sized action hit boxes', rowGlyphsInHitBoxes],
]

/** The catalogue's rows beside Obsidian's own Backlinks rows, linted against them. */
async function rowGlyphsInHitBoxes(): Promise<void> {
  const layout = JSON.parse(await evalLong('JSON.stringify(app.workspace.getLayout())')) as unknown
  const owned: string[] = []
  try {
    for (const [path, text] of [
      ['sample-phone-row-target.md', 'Sample row target.'],
      ['sample-phone-row-source.md', '[[sample-phone-row-target]]'],
    ]) {
      expect(
        await evalLong(`(async () => {
          const path = ${JSON.stringify(path)}
          if (app.vault.getAbstractFileByPath(path)) throw Error('Row fixture already exists')
          await app.vault.create(path, ${JSON.stringify(text)})
          return 'created'
        })()`)
      ).toBe('created')
      owned.push(path)
    }
    expect(
      await evalLong(`(async () => {
        const leaf = app.workspace.getLeaf('tab')
        await leaf.setViewState({ type: 'backlink', state: { file: 'sample-phone-row-target.md' }, active: true })
        app.workspace.leftSplit.collapse()
        app.workspace.rightSplit.collapse()
        const deadline = Date.now() + 10000
        while (!leaf.view.containerEl.querySelector('.search-result-file-title')) {
          if (Date.now() > deadline) throw Error('Native row reference did not render')
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        window.__abeleTest.openDesignCatalogue('rows', 'disclosed')
        await new Promise(resolve => setTimeout(resolve, 500))
        await document.fonts.ready
        return 'opened'
      })()`)
    ).toBe('opened')
    const report = await measureDesign(
      '.abele-design-catalogue',
      `${directory}/phone-rows`,
      {
        nativeSelector:
          '.backlink-pane > .tree-item-self, .backlink-pane .search-result-file-title',
      },
      { requireNative: true }
    )
    expect(report.snapshot.viewport).toEqual({ width: 390, height: 844 })
    expect(report.snapshot.mobile).toBe(true)
    expect(report.violations, `See ${report.directory}/annotated.png and report.json`).toEqual([])
    const actions = report.snapshot.elements.filter(
      (element) =>
        element.role === 'control' &&
        !!element.row &&
        (element.selector.includes('abele-obsidian-icon') ||
          element.selector.includes('abele-disclosure__control'))
    )
    expect(actions.length).toBeGreaterThan(0)
    for (const action of actions) {
      expect(action.rect.width, action.selector).toBeGreaterThanOrEqual(44)
      expect(action.rect.height, action.selector).toBeGreaterThanOrEqual(44)
    }
  } finally {
    await evalLong(`(async () => {
      window.__abeleTest.closeDesignCatalogue()
      await app.workspace.changeLayout(${JSON.stringify(layout)})
      for (const path of ${JSON.stringify(owned)}) {
        const file = app.vault.getAbstractFileByPath(path)
        if (file) await app.vault.delete(file)
      }
      return 'restored'
    })()`)
  }
}
