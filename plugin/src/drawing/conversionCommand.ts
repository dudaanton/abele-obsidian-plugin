import { Notice, type Plugin } from 'obsidian'
import { nanoid } from 'nanoid'
import { t } from '@/i18n'
import { vaultDisk } from '@/sync/vaultPathLinks'
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
        const disk = vaultDisk(vault)
        const results = await convertDrawings({
          paths: () => vault.getFiles().map((file) => file.path),
          exists: (path) => !!vault.getAbstractFileByPath(path),
          read: (path) => disk.read(path),
          create: async (path, text) => {
            if (await disk.exists(path)) throw new Error(`File already exists: ${path}`)
            const folder = path.slice(0, path.lastIndexOf('/') + 1)
            const temporary = `${folder}.abele-drawing-${nanoid()}.tmp`
            try {
              await disk.write(temporary, text)
              // Obsidian's adapter rename refuses occupied destinations, including a file
              // created after the absence check. Never replace a drawing or another canvas.
              await disk.rename(temporary, path)
            } finally {
              if (await disk.exists(temporary)) await disk.remove(temporary)
            }
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
