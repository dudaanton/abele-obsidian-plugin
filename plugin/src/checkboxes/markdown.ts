import { checkboxState, type CheckboxMarker } from './states'

/** One list-item prefix; callers establish that this is Markdown, not a code block. */
export function checkboxOnLine(line: string) {
  const match = /^([\t >]*(?:[-*+]|\d+[.)])[\t ]+\[)([ /xX><?!-])\](?=[\t \r]|$)/.exec(line)
  if (!match) return null
  return { from: match[1].length, state: checkboxState(match[2]) }
}

export function changeCheckbox(line: string, marker: CheckboxMarker): string {
  const box = checkboxOnLine(line)
  return box ? line.slice(0, box.from) + marker + line.slice(box.from + 1) : line
}
