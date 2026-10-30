import { TFile } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { TemplateService } from '@/templates/TemplateService'
import { readFileContent } from '@/helpers/vaultUtils'
import { runAfterSync } from '@/helpers/runAfterSync'
import { handleProtocolAction } from '@/helpers/protocolHandler'
import { handleLinkAction } from '@/helpers/linkHandler'
import type { Plugin } from 'obsidian'
import { registerNodeCodeLinks } from '@/node/registerCodeLinks'

/** Startup section; called at its original lifecycle position. */
export function registerLinks(plugin: Plugin) {
  registerNodeCodeLinks(plugin)
  // Register protocol handler for obsidian://abele
  // Routes to link handler when "name" param is present, otherwise to protocol action
  plugin.registerObsidianProtocolHandler('abele', (params) => {
    const exec = () => {
      if (params.name) {
        void handleLinkAction(plugin.app, params)
      } else {
        void handleProtocolAction(plugin.app, params)
      }
    }

    // Check if the link opts out of sync waiting
    if (params.name) {
      const link = AbeleConfig.getInstance().links.find((l) => l.name === params.name)
      if (link && !link.waitForSync) {
        exec()
        return
      }
    }

    runAfterSync(plugin.app, exec)
  })

  // Register default template hook only after workspace is ready
  plugin.app.workspace.onLayoutReady(() => {
    plugin.registerEvent(
      plugin.app.vault.on('create', async (file) => {
        if (!(file instanceof TFile)) return
        if (file.extension !== 'md') return

        // Check if path is excluded
        if (AbeleConfig.getInstance().isPathExcludedFromDefaultTemplate(file.path)) return

        // Journals have their own templates
        if (AbeleConfig.getInstance().journals.some((j) => j.checkIfNotePathIsJournal(file.path)))
          return

        // Wait for 1 second to ensure there is no content being added (e.g., from Obsidian Web Clipper)
        await new Promise((res) => window.setTimeout(res, 1000))

        // Check if file is empty
        const content = await readFileContent(file)
        if (content.trim() !== '') return

        // Apply default template
        await TemplateService.getInstance().applyDefaultTemplate(file, true)
      })
    )
  })
}
