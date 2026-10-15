/**
 * Stubs to leave out of a shallow mount whose component asks a question through the kit
 * (`confirmDialog`, `promptDialog`, `choiceDialog`). The question is an app of its own, but Vue
 * Test Utils stubs every component created while a shallow mount lives, and keeps one stub per
 * component: without these the dialog's shell, its teleports and its buttons would be stubs and
 * the test could not answer it. A host that has the shell itself leaves it real too: a stub of
 * its own `ObsidianModal` would be the dialog's as well.
 */
export const QUESTION_DIALOG = {
  ObsidianModal: false,
  Button: false,
  ObsidianButton: false,
  teleport: false,
} as const
