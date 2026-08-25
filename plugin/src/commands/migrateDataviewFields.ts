import { GlobalStore } from '@/stores/GlobalStore'
import { TFile } from 'obsidian'
import { dump, load } from 'js-yaml'

/**
 * One `[key:: value]` occurrence.
 *
 * Written without lookbehind, which iOS does not support before 16.4 and which Obsidian's
 * guidelines therefore rule out. The two conditions lookbehind used to express are handled
 * differently:
 *
 *   - "not part of a `[[wiki link]]`" — the character before the bracket is checked in
 *     `isFieldStart` rather than in the pattern, because a pattern that consumed it would
 *     miss the second of two fields written back to back.
 *   - "the key does not end in a space" — spelled out as "allowed characters, the last of
 *     which is not a space".
 */
const INLINE_FIELD_RE = /\[([^[\]:]*[^[\]: ]):: ([^\]]*)\](?!\])/g

/** True unless the `[` at `index` is the second bracket of a `[[wiki link]]`. */
function isFieldStart(content: string, index: number): boolean {
  return index === 0 || content[index - 1] !== '['
}

interface FieldOccurrence {
  key: string
  value: string
}

export interface MigrateDataviewFieldsResult {
  migratedPaths: string[]
  skippedPaths: string[]
}

export function parseInlineFields(content: string): FieldOccurrence[] {
  const fields: FieldOccurrence[] = []
  for (const match of content.matchAll(INLINE_FIELD_RE)) {
    if (!isFieldStart(content, match.index)) continue
    fields.push({ key: match[1].trim(), value: match[2].trim() })
  }
  return fields
}

/** Removes the same occurrences `parseInlineFields` reports, leaving the rest untouched. */
export function stripInlineFields(content: string): string {
  return content.replace(INLINE_FIELD_RE, (whole, _key, _value, index: number) =>
    isFieldStart(content, index) ? '' : whole
  )
}

function hasFrontmatter(content: string): { start: number; end: number; yaml: string } | null {
  if (!content.startsWith('---')) return null
  const closeIdx = content.indexOf('\n---', 3)
  if (closeIdx === -1) return null
  return {
    start: 0,
    end: closeIdx + 4,
    yaml: content.slice(4, closeIdx),
  }
}

function coerceValue(raw: string): any {
  if (raw === '') return null
  if (raw === 'true') return true
  if (raw === 'false') return false
  const num = Number(raw)
  if (!isNaN(num) && raw !== '') return num
  return raw
}

export async function migrateDataviewFields(dryRun = false): Promise<MigrateDataviewFieldsResult> {
  const { app } = GlobalStore.getInstance()
  const files = app.vault.getMarkdownFiles()

  const migratedPaths: string[] = []
  const skippedPaths: string[] = []

  for (const file of files) {
    const content = await app.vault.read(file)
    const fields = parseInlineFields(content)
    if (!fields.length) continue

    const keyCounts = new Map<string, number>()
    for (const f of fields) {
      keyCounts.set(f.key, (keyCounts.get(f.key) || 0) + 1)
    }

    const hasDuplicates = [...keyCounts.values()].some((c) => c > 1)
    if (hasDuplicates) {
      skippedPaths.push(file.path)
      continue
    }

    const fm = hasFrontmatter(content)
    let existingFm: Record<string, any> = {}
    let bodyContent = content

    if (fm) {
      try {
        existingFm = (load(fm.yaml) as Record<string, any>) || {}
      } catch {
        skippedPaths.push(file.path)
        continue
      }
      bodyContent = content.slice(fm.end)
    }

    let hasConflict = false
    for (const f of fields) {
      if (f.key in existingFm) {
        hasConflict = true
        break
      }
    }

    if (hasConflict) {
      skippedPaths.push(file.path)
      continue
    }

    migratedPaths.push(file.path)

    if (dryRun) continue

    for (const f of fields) {
      existingFm[f.key] = coerceValue(f.value)
    }

    let newBody = stripInlineFields(bodyContent)
    newBody = newBody.replace(/\n{3,}/g, '\n\n')
    newBody = newBody
      .split('\n')
      .map((line) => (line.trim() === '' ? '' : line))
      .join('\n')

    const newYaml = dump(existingFm, { quotingType: "'", lineWidth: -1 })
    const newContent = `---\n${newYaml}---${newBody}`

    await app.vault.modify(file, newContent)
  }

  const reportPath = 'dataview-migration-report.md'
  const sections: string[] = [
    dryRun ? '# Dataview Fields Migration — Dry Run\n' : '# Dataview Fields Migration — Report\n',
  ]

  if (migratedPaths.length) {
    sections.push(
      `## ${dryRun ? 'Will migrate' : 'Migrated'} (${migratedPaths.length})\n\n` +
        migratedPaths.map((p) => `- [[${p.replace(/\.md$/, '')}]]`).join('\n')
    )
  }

  if (skippedPaths.length) {
    sections.push(
      `## Skipped (${skippedPaths.length})\n\n` +
        skippedPaths.map((p) => `- [[${p.replace(/\.md$/, '')}]]`).join('\n')
    )
  }

  const reportContent = sections.join('\n\n') + '\n'
  const existing = app.vault.getAbstractFileByPath(reportPath)
  if (existing instanceof TFile) {
    await app.vault.modify(existing, reportContent)
  } else {
    await app.vault.create(reportPath, reportContent)
  }

  return { migratedPaths, skippedPaths }
}
