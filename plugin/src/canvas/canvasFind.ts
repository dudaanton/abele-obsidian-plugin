import { t } from '@/i18n'
/**
 * A canvas's contents: its frames and walkthrough steps, by name. Chosen, the canvas shows that
 * place.
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
  if (node.type === 'group') return node.label || t('streamC.d0b50e064a4f8d94')
  if (node.type === 'text')
    return (
      (node.text ?? '')
        .split('\n')
        .map((l) => l.replace(/^#+\s*/, '').trim())
        .find(Boolean) ?? t('streamC.5b7e33435ad5d064')
    )
  if (node.type === 'file') return `${node.file ?? ''}${node.subpath ?? ''}`
  return node.url ?? t('streamC.a6a32dbc5618ea39')
}

/** The canvas's frames, then its walkthrough's steps, in their order. */
export function canvasContents(graph: CanvasGraph): CanvasPlace[] {
  let steps: CanvasPlace[] = []
  try {
    steps = stepsOf(graph).map((s, i) => ({
      title: t('streamC.59ea4a5d3ad331f3', {
        v1: String(i + 1),
        v2: String(s.say ? `: ${s.say.split('\n')[0]}` : ''),
      }),
      step: i + 1,
    }))
  } catch {
    /* A walkthrough that cannot be read lists no steps; the frames are still there. */
  }
  return [
    ...graph.nodes
      .filter((n) => n.type === 'group')
      .map((node) => ({ title: t('streamC.fd70fc0d384f857e', { v1: String(title(node)) }), node })),
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
    this.emptyStateText = t('streamC.2434aa8341aa7904')
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
