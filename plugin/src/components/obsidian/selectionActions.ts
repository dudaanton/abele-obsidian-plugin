import { t } from '@/i18n'
/** One glyph of the selection bar: what it is called by its host, how it looks, what it says. */
export interface SelectionAction {
  id: string
  icon: string
  tooltip: string
}

// What every view of code or a file offers for selected words, in this order, so the same glyph
// stands in the same place wherever text is selected.
export const ASK: SelectionAction = {
  id: 'ask',
  icon: 'message-circle-plus',
  get tooltip() {
    return t('kit.askSelection')
  },
}
export const ADD: SelectionAction = {
  id: 'add',
  icon: 'message-square-plus',
  get tooltip() {
    return t('kit.addSelection')
  },
}
export const NOTE: SelectionAction = {
  id: 'note',
  icon: 'file-input',
  get tooltip() {
    return t('kit.noteSelection')
  },
}
export const LINK: SelectionAction = {
  id: 'link',
  icon: 'link',
  get tooltip() {
    return t('kit.linkSelection')
  },
}

export const CODE: SelectionAction = {
  id: 'code',
  icon: 'file-code',
  get tooltip() {
    return t('streamB.insertWithCode.7226b2')
  },
}
