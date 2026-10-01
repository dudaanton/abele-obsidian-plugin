/** Checklist semantics, independent of the editor, storage and task-note model. */
export const CHECKBOX_STATES = [
  { marker: ' ', label: 'Open', icon: 'square', done: false, open: true },
  { marker: '/', label: 'In progress', icon: 'slash', done: false, open: true },
  { marker: 'x', label: 'Done', icon: 'check', done: true, open: false },
  { marker: '-', label: 'Cancelled', icon: 'minus', done: false, open: false },
  { marker: '>', label: 'Forwarded', icon: 'arrow-right', done: false, open: true },
  { marker: '<', label: 'Scheduled', icon: 'calendar', done: false, open: true },
  { marker: '?', label: 'Question', icon: 'help-circle', done: false, open: true },
  { marker: '!', label: 'Important', icon: 'circle-alert', done: false, open: true },
] as const

export type CheckboxMarker = (typeof CHECKBOX_STATES)[number]['marker']

export function checkboxState(marker: string) {
  return CHECKBOX_STATES.find((state) => state.marker === marker.toLowerCase())
}

export function nextCheckboxState(marker: string): CheckboxMarker {
  const index = CHECKBOX_STATES.findIndex((state) => state === checkboxState(marker))
  return CHECKBOX_STATES[(index + 1) % CHECKBOX_STATES.length].marker
}
