import type { CataloguePage } from '../../../src/testing/designCatalogue'

/** A remaining defect must be explicit; it.fails rejects an unexpected repair as well. */
export const DESIGN_CASES: { page: CataloguePage; bug?: string }[] = [
  { page: 'index' },
  { page: 'rows' },
  { page: 'states' },
  { page: 'details' },
  { page: 'swatches' },
  { page: 'images' },
  { page: 'events' },
  { page: 'artifact' },
  { page: 'comment' },
  { page: 'comment-thread' },
  { page: 'waiting' },
  { page: 'controls' },
  { page: 'navigation' },
  { page: 'previews' },
  { page: 'specialized' },
  { page: 'icon-picker' },
  { page: 'confirm' },
]
