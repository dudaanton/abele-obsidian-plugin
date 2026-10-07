import { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'

/** Seed real bytes alongside a hand-built discovery entry; execution never uses cached code. */
export function scriptSource(path: string, source: string): void {
  const vault = GlobalStore.getInstance().app.vault
  const file = vault.getAbstractFileByPath(path)
  // The in-memory vault mutates synchronously before these promises resolve.
  if (file instanceof TFile) void vault.modify(file, source)
  else void vault.create(path, source)
}
