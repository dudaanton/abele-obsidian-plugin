/** Pele escapes labels and ignores callbacks; only the drawing preference gates it. */
import type { App } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'

export function mermaidViewerActive(_app: App): boolean {
  return AbeleConfig.getInstance().mermaidViewer
}
