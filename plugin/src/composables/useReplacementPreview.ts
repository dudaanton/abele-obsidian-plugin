import { ref } from 'vue'
import { stringifyYaml, type TFile } from 'obsidian'
import { ReplacementAction } from '@/entities/ReplacementAction'
import type { Criterion } from '@/entities/Criterion'
import { GlobalStore } from '@/stores/GlobalStore'
import { getNoteBody } from '@/helpers/notesUtils'
import {
  applyReplacementPreview,
  replacementFrontmatter,
  type ReplacementPreview,
} from '@/helpers/bulkReplacement'
import { confirmAction } from '@/modal/confirm'

/** Both entry points preview the same source snapshot and apply the same checked writes. */
export function useReplacementPreview() {
  const replacements = ref<ReplacementAction[]>([new ReplacementAction()])
  const searchResults = ref<ReplacementPreview[]>([])
  const addReplacement = () => replacements.value.push(new ReplacementAction())
  const removeReplacement = (id: string) => {
    replacements.value = replacements.value.filter((replacement) => replacement.id !== id)
  }

  async function previewFiles(files: TFile[], criteria: Criterion[] = []) {
    const { app } = GlobalStore.getInstance()
    searchResults.value = []
    for (const note of files) {
      const validCriteria = criteria.filter((criterion) => criterion.isValid())
      const name = note.name.replace(/\.md$/, '')
      if (
        validCriteria.some(
          (criterion) =>
            (criterion.type === 'path' && !criterion.checkPathCriterion(note.path)) ||
            (criterion.type === 'name' && !criterion.checkPathCriterion(name))
        )
      )
        continue
      const sourceText = await app.vault.read(note)
      const sourceMtime = note.stat.mtime
      const frontmatter = replacementFrontmatter(sourceText)
      let content: string | null = null
      const matches = validCriteria.every((criterion) => {
        if (criterion.type === 'property')
          return !!frontmatter && criterion.checkPropertyCriterion(frontmatter)
        if (criterion.type === 'content') {
          content = getNoteBody(sourceText)
          return criterion.checkContentCriterion(content)
        }
        return true
      })
      if (!matches) continue
      const value: ReplacementPreview = {
        sourceText,
        sourceMtime,
        oldPath: note.path,
        newPath: note.path,
        oldFrontmatter: frontmatter,
        newFrontmatter: frontmatter,
        oldRaw: '',
        newRaw: '',
        oldContent: content,
        newContent: content,
      }
      for (const replacement of replacements.value.filter((replacement) => replacement.isValid())) {
        value.newFrontmatter = replacement.applyPropertyReplacement(value.newFrontmatter)
        value.newFrontmatter = replacement.applyPropertyContentReplacement(value.newFrontmatter)
        value.newPath = replacement.applyPathReplacement(value.newPath)
        if (replacement.type === 'replace-in-content') {
          if (value.oldContent === null) {
            value.oldContent = getNoteBody(sourceText)
            value.newContent = value.oldContent
          }
          value.newContent = replacement.applyContentReplacement(value.newContent)
        }
      }
      value.oldRaw = `path: ${value.oldPath}\n---\n${stringifyYaml(value.oldFrontmatter ?? {})}\n${value.oldContent ?? ''}`
      value.newRaw = `path: ${value.newPath}\n---\n${stringifyYaml(value.newFrontmatter ?? {})}\n${value.newContent ?? ''}`
      searchResults.value.push(value)
    }
  }

  const replaceOne = (result: ReplacementPreview) =>
    applyReplacementPreview(GlobalStore.getInstance().app, result)
  const replace = async () => {
    const results = [...searchResults.value]
    if (
      await confirmAction(GlobalStore.getInstance().app, {
        title: 'Apply changes',
        message: `Are you sure you want to apply the changes to ${results.length} notes?`,
        confirmText: 'Apply changes',
        confirmTooltip: 'Apply the previewed changes to these notes',
      })
    ) {
      for (const result of results) await replaceOne(result)
    }
  }
  const removeSearchResult = (result: ReplacementPreview) => {
    searchResults.value = searchResults.value.filter((candidate) => candidate !== result)
  }
  return {
    replacements,
    searchResults,
    addReplacement,
    removeReplacement,
    previewFiles,
    replaceOne,
    replace,
    removeSearchResult,
  }
}
