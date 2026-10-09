import { it, expect } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { KIT_COLORS } from '../../src/constants/colors'
import { designCaptureExpression } from '../helpers/designCapture'
import { lintDesign, type DesignSnapshot } from '../helpers/designLint'

targets('desktop')
const unavailable = !isObsidianRunning() || !hasTestApi()

it.skipIf(unavailable)(
  'keeps one visible modal dismissal and native agent disclosure/state cues on both layouts',
  async () => {
    try {
      for (const phone of [false, true]) {
        await reloadApp(`app.emulateMobile(${phone})`)
        const result = JSON.parse(
          await evalLong(`(async()=>{
        const win=require('@electron/remote').getCurrentWindow(),size=win.getContentSize();
        win.setContentSize(${phone ? '390,844' : '1280,800'});
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
        }finally{window.__abeleTest.closeDesignCatalogue();win.setContentSize(...size)}
      })()`)
        )
        expect(result.dismiss).toEqual([1, 1, 1, 1])
        expect([result.before, result.collapsed, result.reopened]).toEqual([
          'true',
          'false',
          'true',
        ])
        expect(result.facts).toBe('Model: Sample model · Folder: Work')
        expect(result.statuses).toEqual([
          { text: 'Waiting for your answer', glyph: true, decorative: 'true' },
          { text: 'Working…', glyph: true, decorative: 'true' },
          { text: 'Connection lost', glyph: true, decorative: 'true' },
        ])
      }
    } finally {
      await reloadApp('app.emulateMobile(false)')
    }
  }
)

it.skipIf(unavailable)(
  'preserves native control paint and rejects a changed search inset rather than waiving native controls',
  async () => {
    await reloadApp('app.emulateMobile(true)')
    try {
      const result = JSON.parse(
        await evalLong(`(async()=>{
      const win=require('@electron/remote').getCurrentWindow(),size=win.getContentSize();win.setContentSize(390,844);
      try {
        window.__abeleTest.openDesignCatalogue('swatches');await new Promise(r=>setTimeout(r,300));
        const choices=[...document.querySelectorAll('.abele-swatch-picker__choice')].map(el=>({hit:el.getBoundingClientRect().height,padding:getComputedStyle(el).padding}));
        const underlinePadding=getComputedStyle(document.querySelector('.abele-swatch-picker__underline')).padding;
        window.__abeleTest.openDesignCatalogue('controls');await new Promise(r=>setTimeout(r,300));
        const slider=document.querySelector('input[type="range"]'),dropdown=document.querySelector('.abele-obsidian-dropdown');
        const geometry={slider:slider.getBoundingClientRect().height,track:getComputedStyle(slider,'::-webkit-slider-runnable-track').height,overflow:dropdown.scrollWidth-dropdown.clientWidth};
        const input=document.querySelector('.search-input-container input');input.style.paddingLeft=(parseFloat(getComputedStyle(input).paddingLeft)+5)+'px';
        const snapshot=${designCaptureExpression('.abele-design-catalogue')};
        return {choices,underlinePadding,geometry,snapshot};
      }finally{window.__abeleTest.closeDesignCatalogue();win.setContentSize(...size)}
    })()`)
      ) as {
        choices: { hit: number; padding: string }[]
        underlinePadding: string
        geometry: { slider: number; track: string; overflow: number }
        snapshot: DesignSnapshot
      }
      expect(result.choices).toHaveLength(KIT_COLORS.length + 6)
      expect(result.choices.every((choice) => choice.hit >= 44 && choice.padding === '4px')).toBe(
        true
      )
      expect(result.underlinePadding).toBe('4px')
      expect(result.geometry.slider).toBeGreaterThanOrEqual(44)
      expect(result.geometry.track).toBe('6px')
      expect(result.geometry.overflow).toBeLessThanOrEqual(1)
      expect(
        lintDesign(result.snapshot).some(
          (violation) =>
            violation.rule === 'native-parity' && violation.message.startsWith('padding.3:')
        )
      ).toBe(true)
    } finally {
      await reloadApp('app.emulateMobile(false)')
    }
  }
)
