/**
 * Whether a mermaid block is the plugin's to draw.
 *
 * Two conditions, and the second is Obsidian's. Since 1.13 Obsidian asks, once per vault,
 * whether diagrams may be shown at all — "Only allow if you trust this vault's contents" — and
 * until the answer is yes it shows the source under that question. The viewer never draws past
 * that question: an untrusted vault keeps Obsidian's guard exactly as Obsidian draws it, and
 * the moment the person allows diagrams (in the guard or in Settings → Editor) the viewer takes
 * over. Obsidian keeps the answer in the vault's local storage under this key.
 *
 * An Obsidian from before the question never has the key set, so there the plugin leaves
 * diagrams to Obsidian rather than guess that no question was ever needed.
 */
import type { App } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'

export const MERMAID_TRUST_KEY = 'mermaid-vault-trust'

export function vaultTrustsMermaid(app: App): boolean {
  return app.loadLocalStorage(MERMAID_TRUST_KEY) === true
}

export function mermaidViewerActive(app: App): boolean {
  return AbeleConfig.getInstance().mermaidViewer && vaultTrustsMermaid(app)
}
