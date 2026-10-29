import { MarkdownRenderChild, type MarkdownPostProcessorContext } from 'obsidian'
import { h, nextTick, provide, reactive } from 'vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { mountKit } from '@/components/obsidian/mount'
import { isPrintMode, PRINT_MODE, PRINT_TASKS } from './printMode'
import { printReady, trackPrintTask } from './printReady'
import { GlobalStore } from '@/stores/GlobalStore'
import { renderPrintBases } from '@/bases/PrintView'

const handled = new WeakSet<HTMLElement>()

/** Export renders the entire note once, with no source sections or editor widgets. */
export async function printNoteChrome(
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext
): Promise<void> {
  if (
    !isPrintMode(el) ||
    !el.parentElement?.classList.contains('print') ||
    !el.matches('.markdown-rendered') ||
    handled.has(el)
  )
    return
  handled.add(el)
  // The host appends our returned promise only after this function returns. Snapshot its
  // existing processor promises now, so the final pass never waits on itself.
  const pending =
    (ctx as MarkdownPostProcessorContext & { promises?: Promise<unknown>[] }).promises?.slice() ??
    []
  await Promise.all(pending)
  await renderPrintBases(el)
  if (AbeleConfig.getInstance().pdfIncludeHeaderFooter) {
    const [{ Header }, { Footer }, { default: HeaderView }, { default: FooterView }] =
      await Promise.all([
        import('@/entities/Header'),
        import('@/entities/Footer'),
        import('@/components/Header.vue'),
        import('@/components/Footer.vue'),
      ])
    const header = reactive(new Header({ id: 'pdf-header', filePath: ctx.sourcePath }))
    const footer = reactive(new Footer({ id: 'pdf-footer', filePath: ctx.sourcePath }))
    const owner = new MarkdownRenderChild(el)
    owner.register(() => {
      header.cleanup()
      footer.cleanup()
    })
    ctx.addChild(owner)
    await Promise.all([header.load(), footer.load()])
    const relations = footer.noteRelations
    await Promise.all(
      [
        ...relations.notes.values(),
        ...relations.tasks.values(),
        ...relations.logs.values(),
        ...relations.transactions.values(),
        ...relations.timeEntries.values(),
      ].map((entry) => entry.load())
    )
    for (const [component, props, position] of [
      [HeaderView, { header }, 'header'],
      [FooterView, { footer }, 'footer'],
    ] as const) {
      const host = el.ownerDocument.win.createDiv()
      host.className = `abele-print-chrome abele-print-${position}`
      if (position === 'header') el.prepend(host)
      else el.append(host)
      mountKit(
        host,
        {
          setup() {
            provide(PRINT_MODE, true)
            provide(PRINT_TASKS, (task) => trackPrintTask(host, task))
            return () => h(component, props)
          },
        },
        null,
        { owner }
      )
      if (position === 'header') {
        const { app } = GlobalStore.getInstance()
        const file = app.vault.getFileByPath(ctx.sourcePath)
        const metadata = file && app.metadataCache.getFileCache(file)?.frontmatter
        if (metadata?.type === 'task') {
          const list = host.appendChild(el.ownerDocument.win.createEl('dl'))
          const config = AbeleConfig.getInstance()
          for (const key of new Set([
            'date',
            'dateTime',
            'due',
            'dueTime',
            'completed',
            'recurrence',
            config.taskPriorityProperty || 'priority',
            config.taskLabelProperty || 'labels',
          ])) {
            if (metadata[key] === undefined) continue
            list.appendChild(el.ownerDocument.win.createEl('dt')).textContent = key
            list.appendChild(el.ownerDocument.win.createEl('dd')).textContent = String(
              metadata[key]
            )
          }
        }
      }
    }
    await nextTick()
  }
  await printReady(el)
}
