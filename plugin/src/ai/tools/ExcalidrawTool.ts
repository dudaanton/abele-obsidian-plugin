/**
 * `canvas_import_excalidraw`: the agent makes Excalidraw drawings into Abele canvases — one, or
 * every drawing within the chat's reach. Each canvas is a new file beside its drawing; the drawing
 * is only read. The reply is the report: per drawing, the canvas made, what did not carry over,
 * or why it was skipped or failed.
 */
import { TFile } from 'obsidian'
import type { AgentTool } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { appOf, scopeOf } from '../toolContext'
import { isExcalidrawFile, ObsidianExcalidrawVault } from '@/canvas/excalidrawAdapter'
import { migrateOne, reportText, summarize, type FileReport } from '@/canvas/excalidraw/migrate'

export const IMPORT_EXCALIDRAW = 'canvas_import_excalidraw'

export function createImportExcalidrawTool(): AgentTool {
  return {
    name: IMPORT_EXCALIDRAW,
    label: 'Migrate Excalidraw drawings',
    category: 'Canvas',
    description:
      'Migrate Excalidraw drawings (.excalidraw.md, notes with `excalidraw-plugin` frontmatter, .excalidraw) into Abele canvases. Give `path` for one drawing, or `all: true` for every drawing in scope. Each drawing gets a new .canvas beside it (a free name, never overwriting); the drawing itself is never changed. Links and embeds to it in notes and canvases across the vault are updated, with a count and any errors in the report. Drawings that already have a canvas are skipped unless `force`. Shapes become shaped cards, bound arrows connectors, other arrows/lines free lines, pencil strokes ink, frames groups, pictures/embeds file or link cards. The reply lists per drawing the canvas made and what did not carry over (sketchy look, fills, fonts, rotation, grouping, curves, …). Own Ask mode.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'One drawing, relative to the vault root' },
        all: { type: 'boolean', description: 'Every Excalidraw drawing in scope' },
        force: {
          type: 'boolean',
          description: 'Make another canvas even for a drawing migrated before',
        },
      },
      additionalProperties: false,
    },
    execute: async (_id, params, signal, ctx) => {
      const { app } = GlobalStore.getInstance()
      const scope = scopeOf(ctx)
      const vault = new ObsidianExcalidrawVault(app, appOf(ctx))
      const path = typeof params.path === 'string' ? params.path.trim() : ''
      if (!path && params.all !== true) throw new Error('Give `path`, or `all: true`.')
      if (path && params.all === true) throw new Error('Give `path` or `all`, not both.')
      let sources: string[]
      if (path) {
        const file = app.vault.getAbstractFileByPath(path)
        if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`)
        if (!isExcalidrawFile(app, file)) throw new Error(`Not an Excalidraw drawing: ${path}`)
        if (!scope.isInScope(path))
          throw new Error(`Access denied: ${path} is outside this chat's scope`)
        sources = [path]
      } else sources = (await vault.drawings()).filter((p) => scope.isInScope(p))
      const known = await vault.migrated()
      const files: FileReport[] = []
      for (const source of sources) {
        signal?.throwIfAborted()
        const report = await migrateOne(vault, source, { known, force: params.force === true })
        if (report.status === 'migrated' && report.target) scope.addFile(report.target)
        files.push(report)
      }
      const report = summarize(files)
      return {
        content: [
          {
            type: 'text',
            text: sources.length ? reportText(report) : 'No Excalidraw drawings in scope.',
          },
        ],
        details: { report },
      }
    },
  }
}
