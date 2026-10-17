/**
 * What the map says when it has nothing, or not everything, to draw: one plate at the top of
 * the map with what is the matter and the one thing that helps. A place that cannot be drawn is
 * never put at 0, 0; the notes it leaves out are a count in the corner, listed on a press.
 */

export type MapProblem =
  | 'no-property'
  | 'no-records'
  | 'filtered'
  | 'searched'
  | 'no-coordinates'
  | 'offline'
  | 'no-webgl'
  | 'lost-context'
  | 'conflict'

export type MapPlate = {
  icon: string
  title: string
  text: string
  action?: string
  variant?: 'empty' | 'no-matches' | 'error'
}

export function plateFor(
  problem: MapProblem | null,
  ctx: { phone: boolean; query?: string; notes: number }
): MapPlate | null {
  switch (problem) {
    case 'no-property':
      return {
        icon: 'map-pin',
        title: 'Where are the coordinates?',
        text: "Pick the property or formula that holds each place's coordinates.",
        action: 'Configure view',
      }
    case 'no-records':
      return {
        icon: 'map',
        title: 'No notes in this base yet',
        text: ctx.phone
          ? 'Press and hold the map to add a place there.'
          : 'Right-click the map to add a place there.',
      }
    case 'filtered':
      return {
        icon: 'list-filter',
        title: 'No place matches the filters',
        text: 'The filters leave nothing to show.',
        action: 'Filters',
        variant: 'no-matches',
      }
    case 'searched':
      return {
        icon: 'search-x',
        title: 'Nothing found',
        text: `No place in this base matches “${ctx.query ?? ''}”.`,
        variant: 'no-matches',
      }
    case 'no-coordinates':
      return {
        icon: 'map-pin-off',
        title:
          ctx.notes === 1
            ? 'The note has no coordinates'
            : `None of ${ctx.notes} notes has coordinates`,
        text: 'Add coordinates to a note, or pick another property in the view settings.',
        action: 'Show the notes',
      }
    case 'offline':
      return {
        icon: 'wifi-off',
        title: 'The map could not load',
        text: 'No connection to the map server. The places are still here.',
        action: 'Try again',
        variant: 'error',
      }
    case 'no-webgl':
      return {
        icon: 'monitor-x',
        title: 'This device cannot draw maps',
        text: 'Graphics acceleration is off or unavailable here.',
        action: 'Show as a list',
        variant: 'error',
      }
    case 'lost-context':
      return {
        icon: 'monitor-x',
        title: 'The map stopped drawing',
        text: 'The graphics card let go of it, often after sleep.',
        action: 'Draw again',
        variant: 'error',
      }
    case 'conflict':
      return {
        icon: 'puzzle',
        title: 'Obsidian Maps draws this view',
        text: 'Both plugins offer the Map view. Turn Obsidian Maps off to use this one. Your bases stay as they are.',
        variant: 'error',
      }
    default:
      return null
  }
}
