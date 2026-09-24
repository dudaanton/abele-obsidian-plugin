/**
 * Descriptions of the file tools that the settings also carry as defaults.
 *
 * Kept apart from the tools so `types.ts` can hold them as defaults without importing the tools
 * and everything behind them. A tool and the settings default must say the same thing: a saved
 * default is what an agent is actually shown.
 */

/** `read` as agents have it: numbered by default. */
export const READ_DESCRIPTION =
  'Read a file. Only files within the current workspace scope are accessible.\n\n' +
  'Every line comes numbered — the number, a tab, then the line — counted from 1 over the whole file, ' +
  'frontmatter included. The numbers are not part of the file: never copy them into edit or write. ' +
  'start_line/end_line read a window; line_numbers: false gives the file as it is.\n\n' +
  'Point the person at lines with a link using these numbers: [[path/Note#L10-L12|what is there]] ' +
  '(#L10 for one line) opens the note with those lines selected.'

/** What `edit` and `write` add, so text copied out of a numbered read is not written back with its numbers. */
export const NUMBERS_NOT_TEXT =
  ' Line numbers from read are not part of the file: leave them out of the text.'

export const EDIT_DESCRIPTION =
  'Edit a file by replacing an exact string match with new content. File must be in workspace scope.' +
  NUMBERS_NOT_TEXT

/**
 * Defaults these tools shipped with before, as settings saved them. A saved description equal to
 * one of these was never written by the person, so the current default takes its place.
 */
export const RETIRED_DESCRIPTIONS: Record<string, string[]> = {
  read: [
    'Read the content of a file. Only files within the current workspace scope are accessible.',
  ],
  edit: [
    'Edit a file by replacing an exact string match with new content. File must be in workspace scope.',
  ],
}
