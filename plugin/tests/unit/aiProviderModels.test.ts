import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useAiProviderModels } from '@/composables/useAiProviderModels'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { AiProvider } from '@/ai/types'

const provider = (): AiProvider => ({
  id: 'sample',
  name: 'Sample',
  baseUrl: '',
  apiKeyId: '',
  models: [],
})

describe('provider model editing', () => {
  it('does not mutate a model until its separate edit is saved', () => {
    const providers = ref([provider()])
    providers.value[0].models.push({
      id: 'model',
      name: 'Before',
      contextWindow: 128000,
      maxTokens: 4096,
      supportsReasoning: false,
    })
    const save = vi.fn()
    const models = useAiProviderModels({
      config: AbeleConfig.getInstance(),
      providers,
      auxiliaryModelId: ref(''),
      save,
      askRemoval: vi.fn(),
    })
    models.openModelEdit(0, 0)
    models.editingModel.value!.model.name = 'After'
    expect(providers.value[0].models[0].name).toBe('Before')
    expect(save).not.toHaveBeenCalled()
    models.onModelSave(0, 0, models.editingModel.value!.model)
    expect(providers.value[0].models[0].name).toBe('After')
    expect(save).toHaveBeenCalledOnce()
  })

  it('adds and removes remote choices with the existing model defaults', () => {
    const providers = ref([provider()])
    const save = vi.fn()
    const models = useAiProviderModels({
      config: AbeleConfig.getInstance(),
      providers,
      auxiliaryModelId: ref(''),
      save,
      askRemoval: vi.fn(),
    })
    models.toggleRemoteModel(0, 'remote')
    expect(providers.value[0].models).toEqual([
      {
        id: 'remote',
        name: '',
        contextWindow: 128000,
        maxTokens: 4096,
        supportsReasoning: false,
      },
    ])
    models.toggleRemoteModel(0, 'remote')
    expect(providers.value[0].models).toEqual([])
    expect(save).toHaveBeenCalledTimes(2)
  })
})
