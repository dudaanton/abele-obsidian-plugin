/** Descriptions the file tools share: `read` as agents have it, and what edit and write add. */

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
