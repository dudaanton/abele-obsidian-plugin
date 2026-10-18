import { Notice, TFile, type Plugin } from 'obsidian'
import { t } from '@/i18n'
import { convertDrawings } from './conversion'

export function registerDrawingConversion(plugin: Plugin): void {
  let running = false
  plugin.addCommand({
    id: 'convert-drawings-to-canvases',
    name: t('commands.convert-drawings-to-canvases'),
    callback: async () => {
      if (running) return
      running = true
      try {
        const { vault } = plugin.app
        const results = await convertDrawings({
          paths: () => vault.getFiles().map((file) => file.path),
          exists: (path) => !!vault.getAbstractFileByPath(path),
          read: async (path) => {
            const file = vault.getAbstractFileByPath(path)
            if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`)
            return vault.read(file)
          },
          create: async (path, text) => {
            await vault.create(path, text)
          },
        })
        console.debug('[Abele] drawing conversion', results)
        new Notice(
          t('drawing.conversion-result', {
            converted: results.filter((r) => r.status === 'converted').length,
            existing: results.filter((r) => r.status === 'existing').length,
            failed: results.filter((r) => r.status === 'failed').length,
          }),
          10000
        )
      } catch (error) {
        console.error('[Abele] drawing conversion failed', error)
        new Notice(String(error))
      } finally {
        running = false
      }
    },
  })
}
