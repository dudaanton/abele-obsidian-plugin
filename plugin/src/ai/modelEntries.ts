import type { AiModelConfig, AiProvider } from './types'

/** Stored choices name an entry; the API request still uses its model id. */
export function modelEntryKey(model: AiModelConfig): string {
  return model.entryId || model.id
}

export function findModelEntry(
  models: AiModelConfig[],
  reference: string
): AiModelConfig | undefined {
  return (
    models.find((model) => model.entryId === reference) ??
    models.find((model) => model.id === reference)
  )
}

/** Deterministic for old settings independently opened on multiple devices. */
export function migrateModelEntries(providers: AiProvider[]): boolean {
  let changed = false
  for (const provider of providers) {
    const used = new Set(provider.models.map((model) => model.entryId).filter(Boolean))
    for (const [index, model] of provider.models.entries()) {
      if (model.entryId) continue
      let key = `model-entry-${index}-${model.id}`
      while (used.has(key) || provider.models.some((entry) => entry.id === key)) key += '-'
      model.entryId = key
      used.add(key)
      changed = true
    }
  }
  return changed
}

/** Canonical picker value, including choices stored by older versions. */
export function modelChoiceKey(
  providers: AiProvider[],
  providerId: string,
  reference: string
): string {
  for (const provider of providers) {
    if (providerId && provider.id !== providerId) continue
    const model = findModelEntry(provider.models, reference)
    if (model) return `${provider.id}::${modelEntryKey(model)}`
  }
  return reference ? `${providerId}::${reference}` : ''
}
