import { isPrintMode } from './printMode'
import { t } from '@/i18n'

const jobs = new WeakMap<Document, Set<Promise<unknown>>>()

/** Work started by a render child must finish before the host's PDF promise resolves. */
export function trackPrintTask(el: HTMLElement, task: Promise<unknown>): void {
  if (!isPrintMode(el)) return
  let pending = jobs.get(el.ownerDocument)
  if (!pending) jobs.set(el.ownerDocument, (pending = new Set()))
  pending.add(task)
}

export async function printReady(el: HTMLElement): Promise<void> {
  // Markdown children start their first render in a mount microtask.
  await Promise.resolve()
  const pending = jobs.get(el.ownerDocument)
  while (pending?.size) {
    const batch = Array.from(pending)
    batch.forEach((task) => pending.delete(task))
    await Promise.all(batch)
  }
  await el.ownerDocument.fonts?.ready
  await Promise.all(
    Array.from(el.querySelectorAll('img')).map(async (image) => {
      image.loading = 'eager'
      if (!image.decode) return
      const win = el.ownerDocument.defaultView ?? window
      let timer: number | undefined
      try {
        await Promise.race([
          image.decode(),
          new Promise((_, reject) => {
            timer = win.setTimeout(() => reject(new Error('Image timeout')), 15000)
          }),
        ])
      } catch {
        const fallback = el.ownerDocument.win.createSpan()
        fallback.textContent = `${t('kit.imageMissing')}: ${image.alt || image.getAttribute('src') || ''}`
        image.replaceWith(fallback)
      } finally {
        win.clearTimeout(timer)
      }
    })
  )
}
