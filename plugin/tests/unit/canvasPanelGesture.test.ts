import { expect, it, vi } from 'vitest'
import { cards, setup } from '../helpers/canvasEditorHarness'

it('activates a panel on a clean press and carries its card when that press moves', () => {
  const graph = cards()
  graph.nodes[0] = { ...graph.nodes[0], type: 'file', file: 'sample.md' }
  const s = setup(graph)
  s.viewer.setCamera({ x: 0, y: 0, zoom: 1 })
  s.editor.controls.useTool('select')
  const body = document.createElement('div')
  body.className = 'abele-canvas-card_panels'
  const button = document.createElement('button')
  body.append(button)
  s.viewer.stage.append(body)
  const click = vi.fn()
  button.addEventListener('click', click)
  const send = (target: HTMLElement, type: string, x: number, pointerType = 'mouse') =>
    target.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        pointerType,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: x,
        clientY: 70,
        bubbles: true,
        cancelable: true,
      })
    )
  send(button, 'pointerdown', 100)
  send(s.viewer.stage, 'pointerup', 100)
  expect(click).toHaveBeenCalledTimes(1)
  send(button, 'pointerdown', 100)
  send(s.viewer.stage, 'pointermove', 160)
  send(s.viewer.stage, 'pointerup', 160)
  expect(click).toHaveBeenCalledTimes(1)
  expect(s.document.session.graph.nodes[0].x).toBe(60)
  Object.defineProperties(body, { scrollHeight: { value: 800 }, clientHeight: { value: 100 } })
  vi.spyOn(s.viewer, 'scroller').mockReturnValue(body)
  send(button, 'pointerdown', 160, 'touch')
  send(s.viewer.stage, 'pointermove', 220, 'touch')
  send(s.viewer.stage, 'pointerup', 220, 'touch')
  expect(s.document.session.graph.nodes[0].x).toBe(120)
  expect(body.scrollTop).toBe(0)
  expect(click).toHaveBeenCalledTimes(1)
  s.editor.controls.useTool('pen')
  send(button, 'pointerdown', 160)
  send(s.viewer.stage, 'pointerup', 160)
  expect(click).toHaveBeenCalledTimes(1)
})
