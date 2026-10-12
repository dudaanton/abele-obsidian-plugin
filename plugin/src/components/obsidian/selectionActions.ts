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
  tooltip: 'Ask the agent about this in a new chat',
}
export const ADD: SelectionAction = {
  id: 'add',
  icon: 'message-square-plus',
  tooltip: 'Add to the open chat',
}
export const NOTE: SelectionAction = {
  id: 'note',
  icon: 'file-input',
  tooltip: 'Insert into the note you were last in',
}
export const LINK: SelectionAction = {
  id: 'link',
  icon: 'link',
  tooltip: 'Copy a link to these lines',
}
