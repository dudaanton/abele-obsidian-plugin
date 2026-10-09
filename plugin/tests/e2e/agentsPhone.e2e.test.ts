import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'
const SHOTS = shotDir('abele-phone')

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
describe.skipIf(!available)('agents dialog on a narrow screen', () => {
  it('keeps search unfocused and rows within the dialog, with no approval shortcuts', async () => {
    const result = JSON.parse(
      await evalLong(
        `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms))
      window.__abeleTest.openDialog('agents')
      try {
        for (let i = 0; i < 50 && !document.querySelector('.abele-agents'); i++) await wait(100)
        await wait(300)
        const root = document.querySelector('.abele-agents')
        if (!root) throw new Error('Agents dialog did not open')
        const box = root.getBoundingClientRect()
        const buttons = [...root.querySelectorAll('button')]
        if (window.__e2eHost) await window.__e2eHost.shot(${JSON.stringify(`${SHOTS}/agents-real.png`)})
        return {
          searchFocused: document.activeElement === root.querySelector('input'),
          sections: [...root.querySelectorAll('h3')].map(e => e.textContent),
          rows: root.querySelectorAll('.abele-agents__open').length,
          overflow: buttons.some(e => { const r = e.getBoundingClientRect(); return r.left < box.left - 1 || r.right > box.right + 1 }),
          seen: buttons.some(e => e.textContent === 'Просмотрено'),
          dismissals: buttons.filter(e => e.textContent === 'Убрать').length,
          approvals: buttons.some(e => /approve|allow|разрешить/i.test(e.textContent)),
          namedIcons: buttons.every(e => e.classList.contains('clickable-icon') && e.getAttribute('aria-label') && e.querySelector('svg')),
          touchTargets: !app.isMobile || buttons.every(e => { const r = e.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 }),
          keyboardRows: [...root.querySelectorAll('.abele-agents__open')].every(e => e.getAttribute('role') === 'button' && e.getAttribute('tabindex') === '0'),
          collapsedDetails: [...root.querySelectorAll('details')].every(e => !e.open),
        }
      } finally {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
      }
    })()`,
        15000
      )
    ) as {
      searchFocused: boolean
      sections: string[]
      rows: number
      overflow: boolean
      seen: boolean
      dismissals: number
      approvals: boolean
      namedIcons: boolean
      touchTargets: boolean
      keyboardRows: boolean
      collapsedDetails: boolean
    }
    expect(result.searchFocused).toBe(false)
    expect(result.sections).toEqual(['Нужно твоё действие', 'Работают', 'Связь и доставка'])
    expect(result.rows).toBe(4)
    expect(result.overflow).toBe(false)
    expect(result.seen).toBe(true)
    expect(result.dismissals).toBe(3)
    expect(result.approvals).toBe(false)
    expect(result.namedIcons).toBe(true)
    expect(result.touchTargets).toBe(true)
    expect(result.keyboardRows).toBe(true)
    expect(result.collapsedDetails).toBe(true)
  })
  it('sizes an empty list to content rather than reserving the screen height', async () => {
    const result = JSON.parse(
      await evalLong(
        `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms))
      window.__abeleTest.openDialog('agents')
      try {
        for (let i = 0; i < 50 && !document.querySelector('.abele-agents'); i++) await wait(100)
        const root = document.querySelector('.abele-agents')
        if (!root) throw new Error('Agents dialog did not open')
        const source = root.__vueParentComponent.parent.props.source
        source.rows.value = []
        source.incomplete.value = false
        await wait(300)
        const modal = root.closest('.modal')
        const box = modal.getBoundingClientRect()
        return { height: box.height, viewport: innerHeight, emptySections: root.querySelectorAll('.abele-agents__empty').length, clipped: root.scrollWidth > root.clientWidth }
      } finally {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
      }
    })()`,
        15000
      )
    ) as { height: number; viewport: number; emptySections: number; clipped: boolean }
    expect(result.height).toBeGreaterThan(0)
    expect(result.height).toBeLessThan(result.viewport * 0.75)
    expect(result.emptySections).toBe(3)
    expect(result.clipped).toBe(false)
  })
  it('offers twenty explicit close choices without horizontal overflow', async () => {
    const result = JSON.parse(
      await evalLong(
        `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms))
      window.__abeleTest.openDialog('agents-tabs')
      try {
        for (let i = 0; i < 50 && !document.querySelector('.abele-agents-tabs'); i++) await wait(100)
        await wait(300)
        const root = document.querySelector('.abele-agents-tabs')
        if (!root) throw new Error('Tab choice did not open')
        const box = root.getBoundingClientRect()
        const buttons = [...root.querySelectorAll('button')]
        if (window.__e2eHost) await window.__e2eHost.shot(${JSON.stringify(`${SHOTS}/agents-tabs-real.png`)})
        return { choices: buttons.length, overflow: buttons.some(e => { const r = e.getBoundingClientRect(); return r.left < box.left - 1 || r.right > box.right + 1 }) }
      } finally {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
      }
    })()`,
        15000
      )
    ) as { choices: number; overflow: boolean }
    expect(result.choices).toBe(20)
    expect(result.overflow).toBe(false)
  })
})
