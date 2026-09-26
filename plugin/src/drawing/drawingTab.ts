/**
 * What every tab that is drawn in shares — a drawing's own and a picture drawn on: its keys, and
 * the bar over it with the menus its buttons open. The tab adds the rest of its "more" menu.
 */
import { Menu, type Scope } from 'obsidian'
import { createApp, type App as VueApp } from 'vue'
import DrawingBar from '@/components/drawing/DrawingBar.vue'
import type { DrawingSession } from './DrawingSession'
import { THICKNESSES, type DrawingModel } from './model'
import { SHAPE_KINDS, type ShapeKind } from './items'
import { keepDrawingThickness } from './penThickness'

/**
 * Esc, undo, redo and delete. While text is typed on the drawing its keys are the field's: Esc
 * closes it (the field's own handler), and undo and delete work in the text.
 */
export function drawingKeys(
  scope: Scope,
  model: DrawingModel,
  session: () => DrawingSession | null
): void {
  const typing = () => !!session()?.pick.typing
  scope.register([], 'Escape', () => {
    if (typing() || !model.on) return true
    if (model.picked) session()?.pick.set([])
    else session()?.stop()
    return false
  })
  scope.register(['Mod'], 'z', () => {
    if (typing()) return true
    session()?.undo()
    return false
  })
  scope.register(['Mod', 'Shift'], 'z', () => {
    if (typing()) return true
    session()?.redo()
    return false
  })
  for (const key of ['Delete', 'Backspace'])
    scope.register([], key, () => {
      if (typing() || !model.picked) return true
      session()?.deletePicked()
      return false
    })
}

/** The bar, mounted over a drawing, its buttons wired to the session. */
export function mountDrawingBar(
  el: HTMLElement,
  model: DrawingModel,
  session: () => DrawingSession | null,
  more: (e: MouseEvent) => void
): VueApp {
  const app = createApp(DrawingBar, {
    model,
    onToggle: () => session()?.toggle(),
    onTool: (tool: DrawingModel['tool']) => session()?.setTool(tool),
    onShape: (e: MouseEvent) => shapeMenu(e, model, session()),
    onDelete: () => session()?.deletePicked(),
    onColor: (color: DrawingModel['penColor']) => session()?.setColor(color),
    onThickness: (e: MouseEvent) => thicknessMenu(e, model, session()),
    onFinger: (on: boolean) => session()?.setFinger(on),
    onUndo: () => session()?.undo(),
    onRedo: () => session()?.redo(),
    onZoom: (e: MouseEvent) => zoomMenu(e, session()),
    onMore: more,
  })
  app.mount(el)
  return app
}

/** Fine, medium or bold, kept for every drawing from now on. */
function thicknessMenu(e: MouseEvent, model: DrawingModel, session: DrawingSession | null): void {
  const menu = new Menu()
  for (const t of THICKNESSES)
    menu.addItem((item) =>
      item
        .setTitle(t[0].toUpperCase() + t.slice(1))
        .setChecked(model.thickness === t)
        .onClick(() => {
          session?.setThickness(t)
          keepDrawingThickness(t)
        })
    )
  menu.showAtMouseEvent(e)
}

/** The shape tool: taken up, or — when it is in hand already — which shape it draws. */
function shapeMenu(e: MouseEvent, model: DrawingModel, session: DrawingSession | null): void {
  if (model.tool !== 'shape') {
    session?.setTool('shape')
    return
  }
  const menu = new Menu()
  const names: Record<ShapeKind, [string, string]> = {
    rect: ['Box', 'square'],
    ellipse: ['Ellipse', 'circle'],
    line: ['Line', 'minus'],
    arrow: ['Arrow', 'move-up-right'],
  }
  for (const kind of SHAPE_KINDS)
    menu.addItem((item) =>
      item
        .setTitle(names[kind][0])
        .setIcon(names[kind][1])
        .setChecked(model.shape === kind)
        .onClick(() => session?.setShape(kind))
    )
  menu.showAtMouseEvent(e)
}

function zoomMenu(e: MouseEvent, session: DrawingSession | null): void {
  const menu = new Menu()
  menu.addItem((item) =>
    item
      .setTitle('Zoom in')
      .setIcon('zoom-in')
      .onClick(() => session?.zoomBy(1.25))
  )
  menu.addItem((item) =>
    item
      .setTitle('Zoom out')
      .setIcon('zoom-out')
      .onClick(() => session?.zoomBy(0.8))
  )
  menu.addItem((item) =>
    item
      .setTitle('Actual size')
      .setIcon('scan')
      .onClick(() => session?.actualSize())
  )
  menu.addItem((item) =>
    item
      .setTitle('Show the whole drawing')
      .setIcon('maximize')
      .onClick(() => {
        const backdrop = session?.backdrop
        if (backdrop) session?.show(backdrop.rect)
        else session?.fit()
      })
  )
  menu.showAtMouseEvent(e)
}
