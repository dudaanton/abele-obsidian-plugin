import { App, Modal, Setting } from 'obsidian'
import { createApp, shallowReactive } from 'vue'
import ScriptViewComponent from '@/components/ScriptView.vue'
import { ScriptService } from '@/scripting/ScriptService'
import { showFormModal } from '@/scripting/formModal'
import { scriptParams, findScriptByName } from '@/scripting/runScript'
import type { View, ViewHost } from '@/scripting/view/View'
import type { ScriptViewModel } from '@/views/ScriptView'
import type { BlockRenderer, Deck, ScriptBlock } from './core/model'

/** The decision is local to this device and vault, and bound to the deck path. */
function networkDecision(app: App, path: string): Promise<boolean> {
  const key = `abele-slide-network:${path}`
  const saved = app.loadLocalStorage(key)
  if (typeof saved === 'boolean') return Promise.resolve(saved)
  return new Promise((resolve) => {
    class NetworkDialog extends Modal {
      private answered = false
      onOpen(): void {
        this.setTitle('Allow network for this presentation?')
        this.contentEl.createEl('p', {
          text: 'Live HTML frames may load HTTPS pages and send data to them. They still cannot read the vault or Obsidian.',
        })
        const answer = (allowed: boolean) => {
          this.answered = true
          app.saveLocalStorage(key, allowed)
          resolve(allowed)
          this.close()
        }
        new Setting(this.contentEl)
          .addButton((button) => button.setButtonText('Keep offline').onClick(() => answer(false)))
          .addButton((button) =>
            button
              .setButtonText('Allow HTTPS')
              .setCta()
              .onClick(() => answer(true))
          )
      }
      onClose(): void {
        if (!this.answered) resolve(false)
      }
    }
    new NetworkDialog(app).open()
  })
}

/** Adapter for the script view kit: mount it into the slide, not a new workspace tab. */
export function liveRenderer(app: App, path: () => string, markdown: BlockRenderer): BlockRenderer {
  return {
    ...markdown,
    async allowNetwork(deck: Deck) {
      if (deck.settings.properties.htmlNetwork !== true) return false
      return networkDecision(app, path())
    },
    async script(block: ScriptBlock, target: HTMLElement, signal: AbortSignal) {
      await ScriptService.getInstance().ready
      signal.throwIfAborted()
      const script = findScriptByName(block.name)
      if (!script || script.meta.lint || script.meta.interceptor)
        throw new Error(`Script not found: ${block.name}`)
      let view: View | null = null
      const shown: (() => void)[] = []
      let mounted: ReturnType<typeof createApp> | null = null
      let mountEl: HTMLElement | null = null
      const model: ScriptViewModel = shallowReactive({
        id: `slide-${Math.random().toString(36).slice(2)}`,
        el: target,
        view: null,
        saved: null,
        status: { kind: 'live' },
        runAgain: () => {},
      })
      const host: ViewHost = {
        async open(opened) {
          signal.throwIfAborted()
          if (view) throw new Error('Only one view can open on a slide')
          view = opened
          opened.leafId = model.id
          model.view = opened
          mounted = createApp(ScriptViewComponent, { model })
          mountEl = target.ownerDocument.createElement('div')
          target.append(mountEl)
          mounted.mount(mountEl)
          await opened.emit('focus')
        },
        close() {
          void dispose()
        },
      }
      const dispose = () => {
        shown.splice(0).forEach((release) => release())
        mounted?.unmount()
        mounted = null
        mountEl?.remove()
        mountEl = null
        if (view) {
          void view.dispose()
          view = null
        }
      }
      signal.addEventListener('abort', dispose, { once: true })
      try {
        const result = await ScriptService.getInstance().execute(
          script.path,
          scriptParams(script, block.params),
          {
            source: 'note',
            signal,
            viewHost: host,
            formHandler: async (fields, runId, formSignal) => {
              if (fields.length === 1 && fields[0].type === 'markdown') {
                const el = target.ownerDocument.createElement('div')
                target.append(el)
                const release = await markdown.render({ type: 'markdown', source: fields[0].text ?? '' }, el)
                if (signal.aborted) { release(); el.remove() }
                else shown.push(() => { release(); el.remove() })
                return null
              }
              return showFormModal(fields, runId, formSignal)
            },
          }
        )
        signal.throwIfAborted()
        if (result.trim() && !view) target.textContent = result
      } catch (error) {
        dispose()
        throw error
      }
      return Object.assign(dispose, { interactive: !!view || shown.length > 0 })
    },
  }
}
