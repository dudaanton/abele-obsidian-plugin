import { streamCTitle } from '@/i18n/streamCLabels'

import { t } from '@/i18n'
/**
 * What every tab that is drawn in shares — a drawing's own and a picture drawn on: its keys, and
 * the bar over it with the menus its buttons open. The tab adds the rest of its "more" menu.
 */
import { Menu, type Scope } from 'obsidian'
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
  session: () => DrawingSession | null,
  history?: { undo(): void; redo(): void }
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
    if (history) history.undo()
    else session()?.undo()
    return false
  })
  scope.register(['Mod', 'Shift'], 'z', () => {
    if (typing()) return true
    if (history) history.redo()
    else session()?.redo()
    return false
  })
  for (const key of ['Delete', 'Backspace'])
    scope.register([], key, () => {
      if (typing() || !model.picked) return true
      session()?.deletePicked()
      return false
    })
}

/** Fine, medium or bold, kept for every drawing from now on. */
export function thicknessMenu(
  e: MouseEvent,
  model: DrawingModel,
  session: DrawingSession | null
): void {
  const menu = new Menu()
  for (const t of THICKNESSES)
    menu.addItem((item) =>
      item
        .setTitle(streamCTitle(t))
        .setChecked(model.thickness === t)
        .onClick(() => {
          session?.setThickness(t)
          keepDrawingThickness(t)
        })
    )
  menu.showAtMouseEvent(e)
}

/** The shape tool: taken up, or — when it is in hand already — which shape it draws. */
export function shapeMenu(
  e: MouseEvent,
  model: DrawingModel,
  session: DrawingSession | null
): void {
  if (model.tool !== 'shape') {
    session?.setTool('shape')
    return
  }
  const menu = new Menu()
  const names: Record<ShapeKind, [string, string]> = {
    rect: [t('streamC.512fd3c6042cd1d9'), 'square'],
    ellipse: [t('streamC.cb1ee8cb964f2362'), 'circle'],
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

export function zoomMenu(e: MouseEvent, session: DrawingSession | null, fit?: () => void): void {
  const menu = new Menu()
  menu.addItem((item) =>
    item
      .setTitle(t('streamC.0e47f09a748fa132'))
      .setIcon('zoom-in')
      .onClick(() => session?.zoomBy(1.25))
  )
  menu.addItem((item) =>
    item
      .setTitle(t('streamC.bc7b631a689b45ca'))
      .setIcon('zoom-out')
      .onClick(() => session?.zoomBy(0.8))
  )
  menu.addItem((item) =>
    item
      .setTitle(t('streamC.74cdbe70e394d004'))
      .setIcon('scan')
      .onClick(() => session?.actualSize())
  )
  menu.addItem((item) =>
    item
      .setTitle(t('streamC.b7d4ff614fbde816'))
      .setIcon('maximize')
      .onClick(() => {
        if (fit) {
          fit()
          return
        }
        const backdrop = session?.backdrop
        if (backdrop) session?.show(backdrop.rect)
        else session?.fit()
      })
  )
  menu.showAtMouseEvent(e)
}
