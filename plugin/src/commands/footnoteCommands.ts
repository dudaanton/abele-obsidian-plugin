import { Editor, MarkdownView, Notice } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'

const FOOTNOTE_REF_RE = /\[\^(\d+)\]/g
const FOOTNOTE_DEF_RE = /^\[\^(\d+)\]:/

/**
 * Reindex all numeric footnotes so they follow sequential order (1, 2, 3, …)
 * based on the order references appear in the document.
 */
export function reindexFootnotes(editor: Editor) {
  const content = editor.getValue()
  const lines = content.split('\n')

  // Collect references in order of appearance
  const refOrder: string[] = []
  const seenLabels = new Set<string>()

  for (const line of lines) {
    if (FOOTNOTE_DEF_RE.test(line)) continue

    FOOTNOTE_REF_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = FOOTNOTE_REF_RE.exec(line)) !== null) {
      const label = match[1]
      if (!seenLabels.has(label)) {
        seenLabels.add(label)
        refOrder.push(label)
      }
    }
  }

  if (refOrder.length === 0) {
    new Notice('No footnotes found')
    return
  }

  // Build old→new mapping
  const mapping = new Map<string, string>()
  let needsChange = false
  for (let i = 0; i < refOrder.length; i++) {
    const oldLabel = refOrder[i]
    const newLabel = String(i + 1)
    mapping.set(oldLabel, newLabel)
    if (oldLabel !== newLabel) needsChange = true
  }

  if (!needsChange) {
    new Notice('Footnotes are already in order')
    return
  }

  // Use a temporary placeholder to avoid collisions during renaming
  const tempMapping = new Map<string, string>()
  for (const [oldLabel, newLabel] of mapping) {
    tempMapping.set(oldLabel, `__FN_TEMP_${newLabel}__`)
  }

  let result = content

  // First pass: old labels → temp placeholders
  for (const [oldLabel, temp] of tempMapping) {
    result = result.replace(new RegExp(`\\[\\^${escapeRegex(oldLabel)}\\]`, 'g'), `[^${temp}]`)
  }

  // Second pass: temp placeholders → new labels
  for (const [, newLabel] of mapping) {
    const temp = `__FN_TEMP_${newLabel}__`
    result = result.replace(new RegExp(`\\[\\^${escapeRegex(temp)}\\]`, 'g'), `[^${newLabel}]`)
  }

  // Reorder definition blocks to match new numbering
  const resultLines = result.split('\n')
  const defBlocks = extractDefinitionBlocks(resultLines)
  const nonDefLines = removeDefinitionBlocks(resultLines)

  // Sort definitions by their numeric label
  defBlocks.sort((a, b) => {
    const numA = parseInt(a.label, 10)
    const numB = parseInt(b.label, 10)
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB
    return a.label.localeCompare(b.label)
  })

  // Reassemble: non-def content + blank line + sorted definitions
  while (nonDefLines.length > 0 && nonDefLines[nonDefLines.length - 1].trim() === '') {
    nonDefLines.pop()
  }

  const finalLines = [...nonDefLines]
  if (defBlocks.length > 0) {
    finalLines.push('')
    for (const block of defBlocks) {
      finalLines.push(...block.lines)
    }
  }

  const cursor = editor.getCursor()
  editor.setValue(finalLines.join('\n'))
  editor.setCursor({ line: Math.min(cursor.line, finalLines.length - 1), ch: cursor.ch })

  new Notice(`Reindexed ${refOrder.length} footnotes`)
}

/**
 * Remove a footnote by label: deletes all [^label] references in body text
 * and the [^label]: definition block.
 */
export function removeFootnote(label: string): void {
  if (!confirm(`Remove footnote [^${label}]?`)) return

  const { app } = GlobalStore.getInstance()
  const view = app.workspace.getActiveViewOfType(MarkdownView)
  if (!view) return

  const editor = view.editor
  const cursor = editor.getCursor()
  const content = editor.getValue()
  const lines = content.split('\n')

  const escapedLabel = escapeRegex(label)
  const refRe = new RegExp(`\\[\\^${escapedLabel}\\]`, 'g')
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const defMatch = new RegExp(`^\\[\\^${escapedLabel}\\]:\\s*`).exec(lines[i])
    if (defMatch) {
      // Skip the definition and its continuation lines
      i++
      i = skipContinuationLines(lines, i)
      continue
    }

    result.push(lines[i].replace(refRe, ''))
    i++
  }

  editor.setValue(result.join('\n'))
  editor.setCursor({ line: Math.min(cursor.line, result.length - 1), ch: cursor.ch })
  new Notice(`Removed footnote [^${label}]`)
}

// --- helpers ---

/**
 * Skip continuation lines of a footnote definition starting at index i.
 * Returns the index of the first line that is NOT part of the definition.
 */
function skipContinuationLines(lines: string[], i: number): number {
  while (i < lines.length) {
    if (lines[i].trim() === '') {
      // Blank line — peek ahead for indented continuation
      let k = i + 1
      while (k < lines.length && lines[k].trim() === '') k++
      if (k < lines.length && /^(?:\t| {2,})/.test(lines[k])) {
        i = k + 1
        continue
      }
      break
    }
    if (/^(?:\t| {2,})/.test(lines[i])) {
      i++
    } else {
      break
    }
  }
  return i
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface DefinitionBlock {
  label: string
  lines: string[]
  startIndex: number
}

function extractDefinitionBlocks(lines: string[]): DefinitionBlock[] {
  const blocks: DefinitionBlock[] = []
  let i = 0

  while (i < lines.length) {
    const match = FOOTNOTE_DEF_RE.exec(lines[i])
    if (!match) {
      i++
      continue
    }

    const block: DefinitionBlock = {
      label: match[1],
      lines: [lines[i]],
      startIndex: i,
    }
    i++

    // Collect continuation lines
    while (i < lines.length) {
      if (lines[i].trim() === '') {
        let k = i + 1
        while (k < lines.length && lines[k].trim() === '') k++
        if (k < lines.length && /^(?:\t| {2,})/.test(lines[k])) {
          for (let b = i; b <= k; b++) block.lines.push(lines[b])
          i = k + 1
          continue
        }
        break
      }
      if (/^(?:\t| {2,})/.test(lines[i])) {
        block.lines.push(lines[i])
        i++
      } else {
        break
      }
    }

    blocks.push(block)
  }

  return blocks
}

function removeDefinitionBlocks(lines: string[]): string[] {
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    if (FOOTNOTE_DEF_RE.test(lines[i])) {
      i++
      i = skipContinuationLines(lines, i)
      continue
    }
    result.push(lines[i])
    i++
  }

  return result
}
