/** Presentation-only native picker. It never pins or executes, so it changes no settings. */
export const SELECTION_PICKER_OPEN = `
  const selectionPicker = new window.__abeleTest.SelectionScriptPicker(app,
    Array.from({length: 40}, (_, i) => ({path: 'Scripts/sample-' + i + '.js', code: '', commandId: '',
      meta: {name: 'Sample selection script ' + i + ' with a long descriptive name',
        description: 'A sample source-neutral script with additional context for the selected words.', params: []}})),
    () => {}, 'chat')
  selectionPicker.open()
  if (!await until(() => document.querySelector('.abele-selection-script-choice'), 5000)) throw Error('Selection script picker did not open')
  await wait(300)
  const selectionPrompt = document.querySelector('.abele-selection-script-choice').closest('.prompt')
  if (!selectionPrompt) throw Error('Native selection prompt is missing')
`
export const SELECTION_PICKER_CLOSE = `selectionPicker.close(); await wait(300)`
