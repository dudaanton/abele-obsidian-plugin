import { t } from '@/i18n'
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
        title: t('maps.noProperty'),
        text: t('maps.pickProperty'),
        action: t('maps.configure'),
      }
    case 'no-records':
      return {
        icon: 'map',
        title: t('maps.noRecords'),
        text: ctx.phone ? t('maps.hold') : t('maps.rightClick'),
      }
    case 'filtered':
      return {
        icon: 'list-filter',
        title: t('maps.filtered'),
        text: t('maps.filtersEmpty'),
        variant: 'no-matches',
      }
    case 'searched':
      return {
        icon: 'search-x',
        title: t('maps.nothing'),
        text: t('maps.searchEmpty', { query: ctx.query ?? '' }),
        variant: 'no-matches',
      }
    case 'no-coordinates':
      return {
        icon: 'map-pin-off',
        title: t('maps.noneCoordinates', { count: ctx.notes }),
        text: t('maps.addCoordinates'),
        action: t('maps.showNotes'),
      }
    case 'offline':
      return {
        icon: 'wifi-off',
        title: t('maps.loadFailed'),
        text: t('maps.offline'),
        action: t('maps.retry'),
        variant: 'error',
      }
    case 'no-webgl':
      return {
        icon: 'monitor-x',
        title: t('maps.noWebgl'),
        text: t('maps.graphics'),

        variant: 'error',
      }
    case 'lost-context':
      return {
        icon: 'monitor-x',
        title: t('maps.stopped'),
        text: t('maps.lostContext'),
        action: t('maps.drawAgain'),
        variant: 'error',
      }
    default:
      return null
  }
}
