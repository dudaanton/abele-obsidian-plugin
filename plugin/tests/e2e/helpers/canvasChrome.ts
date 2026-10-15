/**
 * Pressing the canvas's controls the way a person does, by real input on what is on screen: the
 * tools' row across the tab's top, the zoom and history column, the bar over what is picked and
 * the menus they open. Each action is named by the editor's own label for it, so a test reads as
 * what it does; the driver finds the control that does it now and presses it.
 *
 * The test supplies `run` (an async body evaluated in the app, with `view()` in scope), `press`
 * (real input at an element given as an expression) and `until`.
 */
export interface CanvasChromeDriver {
  run<T>(body: string): T
  press(expression: string): Promise<void>
  /** Real input at a point on the screen. */
  at(point: number[]): Promise<void>
  until(expression: string): Promise<void>
  phone: boolean
}

const q = (selector: string) => `view().contentEl.querySelector(${JSON.stringify(selector)})`
const startsWith = (scope: string, prefix: string) =>
  `[...view().contentEl.querySelectorAll(${JSON.stringify(`${scope} [aria-label]`)})].find(e=>e.getAttribute('aria-label').startsWith(${JSON.stringify(prefix)}))`
export const menuItem = (title: string) =>
  `[...document.querySelectorAll('.menu .menu-item')].find(i=>i.querySelector('.menu-item-title')?.textContent.trim()===${JSON.stringify(title)})`
const tools = (label: string) => q(`.abele-canvas-chrome__tools [aria-label="${label}"]`)
const picked = (label: string) => q(`.abele-canvas-chrome__picked [aria-label="${label}"]`)
const column = (label: string) => q(`.abele-canvas-chrome__view [aria-label="${label}"]`)

/** Each tool: the labels its slot in the row may wear, and its title in a family's menu. */
const TOOLS: Record<string, { tool: string; slot: string[]; title: string }> = {
  'Select canvas objects': { tool: 'select', slot: ['Select (V)'], title: 'Select' },
  'Navigate canvas': {
    tool: 'pan',
    slot: ['Hand: move the canvas (H, or hold Space)'],
    title: 'Hand: move the canvas',
  },
  'Draw with pen': { tool: 'pen', slot: ['Pen (P)', 'Marker (P again)'], title: 'Pen' },
  'Draw with marker': { tool: 'marker', slot: ['Pen (P)', 'Marker (P again)'], title: 'Marker' },
  'Erase whole strokes': {
    tool: 'eraser',
    slot: ['Eraser: whole strokes (E)', 'Eraser: part of a stroke (E again)'],
    title: 'Eraser: whole strokes',
  },
  'Erase part of strokes': {
    tool: 'partial-eraser',
    slot: ['Eraser: whole strokes (E)', 'Eraser: part of a stroke (E again)'],
    title: 'Eraser: part of a stroke',
  },
  'Lasso canvas objects': {
    tool: 'lasso',
    slot: ['Lasso: circle cards and ink (L)'],
    title: 'Lasso: circle cards and ink',
  },
  'Draw frame': {
    tool: 'frame',
    slot: ['Frame: draw around cards (F)'],
    title: 'Frame: draw around cards',
  },
  'Draw connection': {
    tool: 'connect',
    slot: ['Connect two cards (A)', 'Line', 'Arrow'],
    title: 'Connect two cards',
  },
  'Draw free line': {
    tool: 'line',
    slot: ['Connect two cards (A)', 'Line', 'Arrow'],
    title: 'Line',
  },
  'Draw free arrow': {
    tool: 'arrow',
    slot: ['Connect two cards (A)', 'Line', 'Arrow'],
    title: 'Arrow',
  },
}
/** What adds something: its slot's label, and its title in the phone's More tools. */
const ADDS: Record<string, { slot: string; title: string }> = {
  'Add text card': { slot: 'Card (T)', title: 'Card' },
  'Add note or attachment': {
    slot: 'Note or file from the vault (N)',
    title: 'Note or file from the vault',
  },
  'Add link': { slot: 'Web page (W)', title: 'Web page' },
}
/** Glyphs on the bar over what is picked, by the editor's label for what they do. */
const PICKED: Record<string, string> = {
  'Edit card text': 'Edit text',
  'Open selected card': 'Open',
  'Reverse connection arrows': 'Reverse the arrows',
  'Group selected cards': 'Frame these',
  'Group canvas selection': 'Frame these',
  'Ungroup selected group': 'Remove the frame, keep what is inside',
  'Ungroup canvas selection': 'Remove the frame, keep what is inside',
  'Detach selected ink': 'Detach from its card',
  'Attach selected ink': 'Attach to the card under it',
  'Toggle multiple selection': 'Pick several',
  'Toggle lasso multiple selection': 'Pick several',
}
/** Glyphs in the zoom and history column. */
const COLUMN: Record<string, string> = {
  'Undo canvas change': 'Undo',
  'Redo canvas change': 'Redo',
  'Fit diagram': 'Zoom to fit',
  'Show whole diagram': 'Leave the steps and show all',
}
/** What the not-saved dot's menu offers. */
const SAVE: Record<string, string> = {
  'Retry save': 'Retry',
  'Keep text draft': 'Keep the draft',
  'Discard local draft': 'Discard the draft…',
}
/** The editor's old rows that opened a panel of tools: the row shows every tool now. */
const GONE = new Set(['Canvas drawing tools', 'Shapes and connections'])

export function canvasChrome(d: CanvasChromeDriver) {
  const shown = (expression: string) =>
    d.run<boolean>(
      `const el=${expression};if(!el)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'`
    )
  const menuOpen = () => d.run<boolean>(`return !!document.querySelector('.menu')`)
  const closeMenu = () =>
    d.run(
      `document.querySelector('.menu')&&document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true`
    )
  async function menu(opener: string, title: string) {
    if (menuOpen()) closeMenu()
    await d.press(opener)
    await d.until(menuItem(title))
    await d.press(menuItem(title))
  }
  /** The tool in hand becomes `label`'s, by its slot, its family's menu or More tools. */
  async function tool(label: string) {
    const t = TOOLS[label]
    for (let i = 0; i < 5; i++) {
      if (d.run<string>(`return view().editor.controls.tool()`) === t.tool) return
      if (menuOpen() && d.run<boolean>(`return !!${menuItem(t.title)}`)) {
        await d.press(menuItem(t.title))
        continue
      }
      if (menuOpen()) closeMenu()
      const slot = t.slot.find((s) => shown(tools(s)))
      if (slot) await d.press(tools(slot))
      else await menu(tools('More tools'), t.title)
    }
    await d.until(`view().editor.controls.tool()===${JSON.stringify(t.tool)}`)
  }
  /** A place on the canvas with nothing on it and no control over it, on the screen. */
  function emptySpot(): number[] {
    return d.run<number[]>(`
      const v=view().viewer,s=v.stage.getBoundingClientRect(),c=v.camera,g=v.graph
      for(let fy=0.9;fy>0.2;fy-=0.1)for(let fx=0.1;fx<0.95;fx+=0.1){
        const x=Math.round(s.left+s.width*fx),y=Math.round(s.top+s.height*fy),wx=c.x+(x-s.left)/c.zoom,wy=c.y+(y-s.top)/c.zoom
        const hit=document.elementFromPoint(x,y)
        if(!hit||!v.stage.contains(hit)||hit.closest('.abele-canvas-chrome,[data-frame-id]'))continue
        if(g.nodes.some(n=>wx>=n.x-20&&wx<=n.x+n.width+20&&wy>=n.y-20&&wy<=n.y+n.height+20))continue
        return [x,y]}
      return null`)
  }
  return {
    emptySpot,
    at: d.at,
    tool,
    /** Presses whatever does `label` now; `allowDisabled` presses it even while it may not run. */
    async click(label: string, allowDisabled = false) {
      if (GONE.has(label)) return
      if (TOOLS[label]) return tool(label)
      if (ADDS[label]) {
        const a = ADDS[label]
        if (shown(tools(a.slot))) return d.press(tools(a.slot))
        return menu(tools('More tools'), a.title)
      }
      if (label === 'Add canvas shape')
        return d.press(startsWith('.abele-canvas-chrome__tools', 'Shape: '))
      if (PICKED[label]) {
        await d.until(
          allowDisabled
            ? picked(PICKED[label])
            : `${picked(PICKED[label])}&&!${picked(PICKED[label])}.disabled`
        )
        return d.press(picked(PICKED[label]))
      }
      if (label === 'Fit diagram' && d.phone) {
        // A phone's column keeps only undo and redo: two fingers zoom there.
        d.run(`view().viewer.fit(false);return true`)
        return
      }
      if (COLUMN[label]) {
        await d.until(
          `${column(COLUMN[label])}&&!${column(COLUMN[label])}.classList.contains('is-disabled')`
        )
        return d.press(column(COLUMN[label]))
      }
      if (label === 'Play walkthrough')
        return d.press(
          startsWith('.abele-canvas-chrome__view', 'Go through the canvas step by step')
        )
      if (SAVE[label]) return menu(q('.abele-canvas-chrome__save'), SAVE[label])
      if (label === 'Recolor canvas selection') {
        // The colour the pen draws with is the one the picked things take.
        const colour = d.run<string>(`return view().editor.controls.value('ink-color')`)
        const names = ['No colour', 'Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Purple']
        return menu(picked('Colour'), names[Number(colour || 0)])
      }
      if (label === 'Delete selected card' || label === 'Delete canvas selection') {
        if (menuOpen()) closeMenu()
        await d.press(picked('More'))
        await d.until(`document.querySelector('.menu')`)
        const item = d.run<string>(
          `return ['Delete','Remove from canvas'].find(t=>[...document.querySelectorAll('.menu .menu-item-title')].some(i=>i.textContent.trim()===t))`
        )
        return d.press(menuItem(item))
      }
      if (label === 'Save text') return d.at(emptySpot())
      throw new Error(`No control on the canvas does "${label}"`)
    },
  }
}
