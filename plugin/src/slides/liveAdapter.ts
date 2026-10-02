import type { App } from 'obsidian'
import { ShellModal } from '@/modal/ShellModal'
import { createApp, shallowReactive } from 'vue'
import ScriptViewComponent from '@/components/ScriptView.vue'
import { ScriptService } from '@/scripting/ScriptService'
import { showFormModal } from '@/scripting/formModal'
import { scriptParams, findScriptByName } from '@/scripting/runScript'
import type { View, ViewHost } from '@/scripting/view/View'
import type { ScriptViewModel } from '@/views/ScriptView'
import type { BlockRenderer, Deck, ScriptBlock } from './core/model'

const pendingDecisions = new WeakMap<App, Map<string, Promise<boolean>>>()

/** The decision is local to this device and vault, and bound to the deck path. */
export function networkDecision(app: App, path: string): Promise<boolean> {
  const key = `abele-slide-network:${path}`
  const saved = app.loadLocalStorage(key)
  if (typeof saved === 'boolean') return Promise.resolve(saved)
  let pending = pendingDecisions.get(app)
  if (!pending) {
    pending = new Map()
    pendingDecisions.set(app, pending)
  }
  const existing = pending.get(key)
  if (existing) return existing
  const decision = new Promise<boolean>((resolve) => {
    class NetworkDialog extends ShellModal {
      private answered = false
      constructor(app: App) {
        super(app, { title: 'Allow network for this presentation?', footer: true })
      }
      onOpen(): void {
        this.bodyEl.createEl('p', {
          text: 'Interactive HTML can send data to websites, including by navigating inside its frame. Without permission only static HTML is shown, with scripts disabled. The frame cannot read the vault or Obsidian.',
        })
        const answer = (allowed: boolean) => {
          this.answered = true
          app.saveLocalStorage(key, allowed)
          resolve(allowed)
          this.close()
        }
        this.addButton('Keep offline', () => answer(false))
        this.addButton('Allow network', () => answer(true), { cta: true })
      }
      onClose(): void {
        if (!this.answered) {
          app.saveLocalStorage(key, false)
          resolve(false)
        }
      }
    }
    new NetworkDialog(app).open()
  }).finally(() => pending!.delete(key))
  pending.set(key, decision)
  return decision
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
      const created = new Set<View>()
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
        created(view) {
          if (signal.aborted) void view.dispose()
          else created.add(view)
        },
        async open(opened) {
          signal.throwIfAborted()
          if (view) throw new Error('Only one view can open on a slide')
          view = opened
          opened.leafId = model.id
          model.view = opened
          mounted = createApp(ScriptViewComponent, { model })
          mountEl = target.ownerDocument.win.createDiv()
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
        for (const view of created) void view.dispose()
        created.clear()
        view = null
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
                const el = target.ownerDocument.win.createDiv()
                target.append(el)
                const release = await markdown.render(
                  { type: 'markdown', source: fields[0].text ?? '' },
                  el
                )
                if (signal.aborted) {
                  release()
                  el.remove()
                } else
                  shown.push(() => {
                    release()
                    el.remove()
                  })
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
