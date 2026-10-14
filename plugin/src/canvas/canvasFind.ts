/**
 * Finding things on a canvas: its cards by their words, a note's or a link's name, and its frames
 * and walkthrough steps as its contents. Chosen, the canvas shows that place.
 */
import { FuzzySuggestModal, type App } from 'obsidian'
import type { CanvasGraph, CanvasNode } from './core/model'
import { stepsOf } from './core/steps'

export interface CanvasPlace {
  /** What the list shows. */
  title: string
  /** A card or frame to show and pick, or a step to go to. */
  node?: CanvasNode
  step?: number
}

/** A card's words, or a note's, picture's or link's name, on one line. */
function title(node: CanvasNode): string {
  if (node.type === 'group') return node.label || 'Frame'
  if (node.type === 'text')
    return (
      (node.text ?? '')
        .split('\n')
        .map((l) => l.replace(/^#+\s*/, '').trim())
        .find(Boolean) ?? 'Empty card'
    )
  if (node.type === 'file') return `${node.file ?? ''}${node.subpath ?? ''}`
  return node.url ?? 'Link'
}

/** Every card and frame, by what it says. */
export function canvasPlaces(graph: CanvasGraph): CanvasPlace[] {
  return graph.nodes.map((node) => ({ title: title(node), node }))
}

/** The canvas's frames, then its walkthrough's steps, in their order. */
export function canvasContents(graph: CanvasGraph): CanvasPlace[] {
  let steps: CanvasPlace[] = []
  try {
    steps = stepsOf(graph).map((s, i) => ({
      title: `Step ${i + 1}${s.say ? `: ${s.say.split('\n')[0]}` : ''}`,
      step: i + 1,
    }))
  } catch {
    /* A walkthrough that cannot be read lists no steps; the frames are still there. */
  }
  return [
    ...graph.nodes
      .filter((n) => n.type === 'group')
      .map((node) => ({ title: `Frame: ${title(node)}`, node })),
    ...steps,
  ]
}

export class CanvasPlaceModal extends FuzzySuggestModal<CanvasPlace> {
  constructor(
    app: App,
    private readonly places: CanvasPlace[],
    placeholder: string,
    private readonly go: (place: CanvasPlace) => void
  ) {
    super(app)
    this.setPlaceholder(placeholder)
    this.emptyStateText = 'Nothing on the canvas matches'
  }
  getItems(): CanvasPlace[] {
    return this.places
  }
  getItemText(place: CanvasPlace): string {
    return place.title
  }
  onChooseItem(place: CanvasPlace): void {
    this.go(place)
  }
}
