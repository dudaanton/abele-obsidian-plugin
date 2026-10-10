import { computed, reactive, ref, type Ref } from 'vue'
import { nanoid } from 'nanoid'
import type { AbeleConfig } from '@/services/AbeleConfig'
import { secrets as secretStore } from '@/secrets/SecretStore'
import { keyFor } from '@/secrets/destinations'
import { OpenAIClient, type RemoteModel } from '@/ai/client'
import type { AiProvider, AiModelConfig } from '@/ai/types'

export type AskSettingsRemoval = (title: string, message: string, run: () => void) => void
interface ProviderModelsOptions {
  config: AbeleConfig
  providers: Ref<AiProvider[]>
  auxiliaryModelId: Ref<string>
  save: () => void
  askRemoval: AskSettingsRemoval
}

/** Provider/model edits keep the general tab's existing save and confirmation boundary. */
export function useAiProviderModels(options: ProviderModelsOptions) {
  const { config, providers, auxiliaryModelId, save, askRemoval } = options
  const DEFAULT_CONTEXT_WINDOW = 128000
  const DEFAULT_MAX_TOKENS = 4096
  const client = new OpenAIClient()
  const remoteModels = reactive<Record<string, RemoteModel[]>>({})
  const fetchingModels = ref<number | null>(null)
  const fetchError = reactive<Record<string, string>>({})
  const modelFilter = reactive<Record<string, string>>({})

  const filteredRemoteModels = (providerId: string): RemoteModel[] => {
    const all = remoteModels[providerId] || []
    const filter = (modelFilter[providerId] || '').toLowerCase()
    if (!filter) return all
    return all.filter(
      (m) => m.id.toLowerCase().includes(filter) || m.owned_by?.toLowerCase().includes(filter)
    )
  }

  const auxModelKey = computed(() => {
    if (!auxiliaryModelId.value) return ''
    const choice = auxiliaryModelId.value
    const [providerId, modelId] = choice.includes('::') ? choice.split('::') : ['', choice]
    for (const p of providers.value) {
      if ((!providerId || p.id === providerId) && p.models.some((m) => m.id === modelId)) {
        return `${p.id}::${modelId}`
      }
    }
    return ''
  })

  const modelOptions = computed(() => {
    const options: { value: string; display: string }[] = []
    for (const p of providers.value) {
      for (const m of p.models) {
        options.push({
          value: `${p.id}::${m.id}`,
          display: `${p.name} / ${m.name || m.id}`,
        })
      }
    }
    return options
  })

  const addProvider = () => {
    const id = nanoid(8)
    providers.value.push({
      id,
      name: '',
      baseUrl: '',
      apiKeyId: `abele-provider-${id.toLowerCase().replace(/[^a-z0-9-]/g, '')}`,
      models: [],
    })
    save()
  }

  const askRemoveProvider = (idx: number) => {
    const provider = providers.value[idx]
    askRemoval(
      'Remove provider',
      `Remove ${provider.name || 'this provider'} and its ${provider.models.length} model(s)? ` +
        'Agents pointing at those models will have no model until one is chosen again.',
      () => removeProvider(idx)
    )
  }

  const removeProvider = (idx: number) => {
    const provider = providers.value[idx]
    if (provider.apiKeyId?.startsWith('abele-')) {
      // deleteSecret exists at runtime but is missing from obsidian.d.ts (as of 1.12.3)
      secretStore().remove(provider.apiKeyId)
    }
    providers.value.splice(idx, 1)
    delete remoteModels[provider.id]
    delete fetchError[provider.id]
    save()
  }

  const updateProvider = (idx: number, field: keyof AiProvider, value: string) => {
    ;(providers.value[idx] as unknown as Record<string, unknown>)[field] = value
    save()
  }

  const fetchModels = async (pIdx: number) => {
    const provider = providers.value[pIdx]
    if (!provider.baseUrl || !provider.apiKeyId) return
    const apiKey = secretStore().get(provider.apiKeyId)
    if (!apiKey) return

    fetchingModels.value = pIdx
    delete fetchError[provider.id]

    try {
      const models = await client.fetchModels(
        provider.baseUrl,
        keyFor(provider.apiKeyId, provider.baseUrl, config),
        provider.clientName
      )
      remoteModels[provider.id] = models
    } catch (err: unknown) {
      fetchError[provider.id] = err instanceof Error ? err.message : String(err)
    } finally {
      fetchingModels.value = null
    }
  }

  const isModelAdded = (pIdx: number, modelId: string): boolean => {
    return providers.value[pIdx].models.some((m) => m.id === modelId)
  }

  const toggleRemoteModel = (pIdx: number, modelId: string) => {
    const provider = providers.value[pIdx]
    const existingIdx = provider.models.findIndex((m) => m.id === modelId)

    if (existingIdx !== -1) {
      provider.models.splice(existingIdx, 1)
    } else {
      provider.models.push({
        id: modelId,
        name: '',
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: DEFAULT_MAX_TOKENS,
        supportsReasoning: false,
      })
    }
    save()
  }

  const editingModel = ref<{
    pIdx: number
    mIdx: number
    model: AiModelConfig
    isNew: boolean
  } | null>(null)

  const addModel = (providerIdx: number) => {
    const model: AiModelConfig = {
      id: '',
      name: '',
      contextWindow: 128000,
      maxTokens: 4096,
      supportsReasoning: false,
    }
    editingModel.value = {
      pIdx: providerIdx,
      mIdx: providers.value[providerIdx].models.length,
      model,
      isNew: true,
    }
  }

  const openModelEdit = (pIdx: number, mIdx: number) => {
    editingModel.value = {
      pIdx,
      mIdx,
      model: { ...providers.value[pIdx].models[mIdx] },
      isNew: false,
    }
  }

  const onModelSave = (pIdx: number, mIdx: number, model: AiModelConfig) => {
    const models = providers.value[pIdx].models
    if (mIdx >= models.length) {
      models.push(model)
    } else {
      models[mIdx] = model
    }
    save()
  }

  // The edit modal asks before it emits, so there is no second question here.
  const removeModel = (pIdx: number, mIdx: number) => {
    providers.value[pIdx].models.splice(mIdx, 1)
    editingModel.value = null
    save()
  }

  const formatTokens = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
    return String(n)
  }

  const selectAuxModel = (key: string) => {
    auxiliaryModelId.value = key
    save()
  }

  return {
    remoteModels,
    fetchingModels,
    fetchError,
    modelFilter,
    filteredRemoteModels,
    auxModelKey,
    modelOptions,
    addProvider,
    askRemoveProvider,
    updateProvider,
    fetchModels,
    isModelAdded,
    toggleRemoteModel,
    editingModel,
    addModel,
    openModelEdit,
    onModelSave,
    removeModel,
    formatTokens,
    selectAuxModel,
  }
}
