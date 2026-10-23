import type { NodeLspDocument, LspLocation } from './NodeLspDocument'
import type { CodeNav } from '@/github/search/navAddon'
import { beginCodeSurface } from '@/github/search/codeSurface'

export interface LspContext {
  document: NodeLspDocument
  text?: () => string
  navigate(locations: LspLocation[], origin?: { line: number; character: number }): void
  closeNavigation?(): void
}
const contexts = new WeakMap<Element, LspContext>()
export function provideLsp(root: HTMLElement, context: LspContext): () => void {
  contexts.set(root, context)
  root.classList.add('abele-lsp-root')
  root.ownerDocument.dispatchEvent(new Event('abele-lsp-context'))
  return () => {
    contexts.delete(root)
    root.classList.remove('abele-lsp-root')
  }
}
export function lspFor(el: Element): LspContext | undefined {
  const root = el.closest('.abele-lsp-root')
  return root ? contexts.get(root) : undefined
}
export function lspNavigation(el: Element, fallback: CodeNav | null): CodeNav | null {
  const context = lspFor(el)
  if (!context?.document.supported) return fallback
  const query = async (
    kind: 'definition' | 'references',
    name: string,
    path: string,
    position?: { line: number; character: number }
  ) => {
    const current = beginCodeSurface(el.ownerDocument, () => context.closeNavigation?.())
    const hits = position ? await context.document.query(kind, position, context.text?.()) : []
    if (!current() || lspFor(el) !== context) return
    if (hits.length) context.navigate(hits, position)
    else if (kind === 'definition') await fallback?.goToDefinition(name, path, position)
    else fallback?.findReferences(name, position)
  }
  return {
    pathOf: () => context.document.path,
    goToDefinition: (name, path, position) => query('definition', name, path, position),
    findReferences: (name, position) => {
      void query('references', name, context.document.path, position)
    },
  }
}
