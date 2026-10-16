import { h, shallowRef } from 'vue'
import {
  MarkdownRenderChild,
  MarkdownRenderer,
  type App,
  type MarkdownPostProcessorContext,
} from 'obsidian'
import type { EditorView } from '@codemirror/view'
import { mountKit } from '@/components/obsidian/mount'
import ExternalFileEmbed from '@/components/external/ExternalFileEmbed.vue'
import { tokenOffloadsOf, type TokenOffloadCoordinator } from '../tokenOffloadCoordinator'
import { pathCoordinatorOf } from '../pathCoordinator'
import { externalLinkPath } from './fileAccess'
import { ExternalPresentation } from './presentation'
import { externalPreview } from './preview'
import { openExternalFile } from './opening'

const claimed = new WeakSet<HTMLElement>()
function embeddedPath(
  app: App,
  el: HTMLElement,
  source: string,
  manager: TokenOffloadCoordinator
): string | null {
  const link = (el.getAttribute('src') ?? '').split('#')[0].split('|')[0]
  const path = externalLinkPath(app, link, source)
  return path && manager.isOffloaded(path) ? path : null
}

/** Own only this embed's DOM, never the note or its editor document. */
export function mountExternalEmbed(
  app: App,
  el: HTMLElement,
  source: string,
  manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault)),
  open = (path: string): void => void openExternalFile(app, path),
  owner?: MarkdownRenderChild
): () => void {
  const path = embeddedPath(app, el, source, manager)
  if (!path || claimed.has(el)) return (): void => {}
  claimed.add(el)
  const component = owner ?? new MarkdownRenderChild(el)
  if (!owner) component.load()
  const original = Array.from(el.childNodes)
  const wasLoaded = el.classList.contains('is-loaded')
  // The replacement is the completed embed; native loading cannot finish for an absent file.
  el.classList.add('is-loaded')
  const raw = el.getAttribute('src') ?? path
  const width = el.getAttribute('width')
  const height = el.getAttribute('height')
  const size = width ? width + (height ? 'x' + height : '') : ''
  const markdown = `![[${raw}${size && !raw.includes('|') ? '|' + size : ''}]]`
  const box = el.ownerDocument.win.createSpan()
  // Native embed click handlers must not interpret a preview press as an open/download.
  box.addEventListener('click', (event) => event.stopPropagation())
  el.replaceChildren(box)
  const presentation = new ExternalPresentation(manager, path, undefined, (key) =>
    externalPreview(app, key)
  )
  const value = shallowRef(presentation.value)
  let live = true,
    native = false
  const mounted = mountKit(
    box,
    {
      render: () =>
        h(ExternalFileEmbed, {
          file: value.value.file,
          state: value.value.state,
          progress: value.value.progress,
          onOpen: () => open(path),
          onDownload: (): void => void presentation.download(),
          onRetry: (): void => void presentation.download(),
        }),
    },
    null,
    { owner: component }
  )
  const sync = () => {
    value.value = presentation.value
    if (!live || !value.value.hydrated || native || !app.vault.getFileByPath(path)) return
    native = true
    mounted.unmount()
    el.replaceChildren()
    // Re-render this one embed through Obsidian after the original exists again.
    const rendered = el.ownerDocument.win.createDiv()
    void MarkdownRenderer.render(app, markdown, rendered, source, component)
      .then(() => {
        // Live preview can reuse this element for another link during a slow renderer.
        if (live && el.getAttribute('src') === raw) el.replaceChildren(rendered)
      })
      .catch((error) => {
        console.debug('[abele-sync] native embed could not be restored', error)
        if (live && el.getAttribute('src') === raw)
          el.textContent = 'Downloaded; reopen this embed to display it.'
      })
  }
  const off = presentation.subscribe(sync)
  const created = app.vault.on('create', sync)
  const renamed = app.vault.on('rename', sync)
  const refresh = (): void => void presentation.refresh()
  el.ownerDocument.defaultView?.addEventListener('online', refresh)
  el.ownerDocument.defaultView?.addEventListener('offline', refresh)
  void presentation.refresh()
  return () => {
    live = false
    off()
    app.vault.offref(created)
    app.vault.offref(renamed)
    presentation.dispose()
    el.ownerDocument.defaultView?.removeEventListener('online', refresh)
    el.ownerDocument.defaultView?.removeEventListener('offline', refresh)
    if (!native) {
      mounted.unmount()
      el.replaceChildren(...original)
      if (!wasLoaded) el.classList.remove('is-loaded')
    }
    claimed.delete(el)
    if (!owner) component.unload()
  }
}

class ExternalEmbedChild extends MarkdownRenderChild {
  constructor(
    private app: App,
    el: HTMLElement,
    private source: string
  ) {
    super(el)
  }
  onload(): void {
    this.register(
      mountExternalEmbed(this.app, this.containerEl, this.source, undefined, undefined, this)
    )
  }
}
export function externalEmbedProcessor(app: App) {
  return (el: HTMLElement, context: MarkdownPostProcessorContext): void => {
    const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
    const elements = el.matches('.internal-embed[src]')
      ? [el]
      : Array.from(el.querySelectorAll<HTMLElement>('.internal-embed[src]'))
    for (const embed of elements)
      if (!claimed.has(embed) && embeddedPath(app, embed, context.sourcePath, manager))
        context.addChild(new ExternalEmbedChild(app, embed, context.sourcePath))
  }
}

/** Native live-preview widgets do not all pass through Markdown post-processors. */
export function externalEmbedsInEditor(app: App, source: (view: EditorView) => string) {
  return (view: EditorView) => {
    const shown = new Map<HTMLElement, { src: string; off: () => void }>()
    const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
    let frame = 0
    const scan = () => {
      frame = 0
      for (const [el, child] of shown)
        if (!view.contentDOM.contains(el) || child.src !== el.getAttribute('src')) {
          child.off()
          shown.delete(el)
        }
      for (const el of Array.from(
        view.contentDOM.querySelectorAll<HTMLElement>('.internal-embed[src]')
      ))
        if (
          !shown.has(el) &&
          !claimed.has(el) &&
          !el.closest('.abele-external-embed') &&
          embeddedPath(app, el, source(view), manager)
        )
          shown.set(el, {
            src: el.getAttribute('src') ?? '',
            off: mountExternalEmbed(app, el, source(view)),
          })
    }
    const schedule = () => {
      if (!frame) frame = view.dom.win.requestAnimationFrame(scan)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(view.contentDOM, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src'],
    })
    const off = manager.subscribe(schedule)
    schedule()
    return {
      update: schedule,
      destroy: () => {
        observer.disconnect()
        off()
        if (frame) view.dom.win.cancelAnimationFrame(frame)
        for (const child of shown.values()) child.off()
        shown.clear()
      },
    }
  }
}
