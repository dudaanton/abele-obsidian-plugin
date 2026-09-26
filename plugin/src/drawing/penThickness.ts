/**
 * How thick the pen draws on a drawing, kept: every drawing and picture drawn on opens with the
 * thickness last chosen on its bar, on this device or another. It lives in the reader's settings
 * beside the PDF pen's, which carry it to other devices, and is chosen apart from it.
 */
import { AbeleConfig } from '@/services/AbeleConfig'
import { readerSettingsFrom } from '@/reader/settings'
import type { Thickness } from './model'

export function keptDrawingThickness(): Thickness {
  return readerSettingsFrom(AbeleConfig.getInstance().reader).drawingInkThickness
}

export function keepDrawingThickness(thickness: Thickness): void {
  const config = AbeleConfig.getInstance()
  if (readerSettingsFrom(config.reader).drawingInkThickness === thickness) return
  config.reader = readerSettingsFrom({ ...config.reader, drawingInkThickness: thickness })
  void config.saveSettings()
}
