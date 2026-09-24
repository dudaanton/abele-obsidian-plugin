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

/**
 * The read guard, told to the tools it stands in front of, so the refusal is not the first an
 * agent hears of it. See `readGuard.ts`.
 */
export const READ_FIRST_EDIT =
  ' Read the file first: an existing file this conversation has not read, or that changed since' +
  ' it was read, is refused with "File must be read first" and left unchanged — read it again,' +
  ' then retry. Reading only some lines is enough.'

/** `write` replaces everything, so part of the file is not enough. */
export const READ_FIRST_WRITE =
  ' An existing file must have been read in full in this conversation, and not changed since;' +
  ' otherwise the call is refused with "File must be read first" and nothing is written.'

export const EDIT_DESCRIPTION =
  'Edit a file by replacing an exact string match with new content. File must be in workspace scope.' +
  NUMBERS_NOT_TEXT +
  READ_FIRST_EDIT
