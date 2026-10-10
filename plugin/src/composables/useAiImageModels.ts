import { computed, ref, type Ref } from 'vue'
import type { AbeleConfig } from '@/services/AbeleConfig'
import { collectEntries } from '@/transfer/entries'
import { secrets as secretStore } from '@/secrets/SecretStore'
import { voiceKeyId, type VoiceSettings } from '@/ai/transcriptionSettings'
import type { ImageProvider, ImageModelConfig2 } from '@/ai/types'
import type { AskSettingsRemoval } from './useAiProviderModels'

interface ImageModelsOptions {
  config: AbeleConfig
  imageProviders: Ref<ImageProvider[]>
  defaultImageModel: Ref<string>
  imgSecretInputs: Record<string, string>
  voice: Ref<VoiceSettings>
  save: () => void
  askRemoval: AskSettingsRemoval
}

export function useAiImageModels(options: ImageModelsOptions) {
  const { config, imageProviders, defaultImageModel, imgSecretInputs, voice, save, askRemoval } =
    options
  const imgEndpointDefault = (apiType: string) => {
    const defaults: Record<string, string> = {
      openai: 'https://api.openai.com/v1/images/generations',
      openrouter: 'https://openrouter.ai/api/v1/chat/completions',
    }
    return defaults[apiType] || ''
  }

  const imageModelOptions = computed(() => {
    const options: { value: string; display: string }[] = []
    for (const p of imageProviders.value) {
      for (const m of p.models) {
        options.push({
          value: `${p.id}::${m.id}`,
          display: `${p.name} / ${m.name || m.id}`,
        })
      }
    }
    return options
  })

  const addImageProvider = () => {
    const id = `img-${Date.now()}`
    imageProviders.value.push({
      id,
      name: '',
      apiType: 'openai',
      endpoint: '',
      apiKeyId: '',
      models: [],
    })
    save()
  }

  const removeImageProvider = (idx: number) => {
    const provider = imageProviders.value[idx]
    imageProviders.value.splice(idx, 1)
    save()
    // Imported configurations can deliberately share a key across services. Only a key
    // with no remaining setting references belongs exclusively to the removed provider.
    const keyId = provider?.apiKeyId
    const used =
      keyId &&
      (voiceKeyId(voice.value) === keyId ||
        collectEntries(config.exportSettings()).some((entry) => entry.secretIds?.includes(keyId)))
    if (keyId && !used) secretStore().remove(keyId)
  }

  const askRemoveImageProvider = (idx: number) => {
    const provider = imageProviders.value[idx]
    askRemoval(
      'Remove provider',
      `Remove ${provider.name || provider.id || 'this provider'} and its ` +
        `${provider.models.length} model(s)? This cannot be undone.`,
      () => removeImageProvider(idx)
    )
  }

  const updateImageProvider = (idx: number, key: string, val: string) => {
    ;(imageProviders.value[idx] as unknown as Record<string, unknown>)[key] = val
    save()
  }

  const applyImageProviderSecret = (idx: number) => {
    const provider = imageProviders.value[idx]
    const val = imgSecretInputs[provider.id]
    if (!val) return
    const keyId = `abele-img-${provider.id.toLowerCase().replace(/[^a-z0-9-]/g, '')}`
    provider.apiKeyId = keyId
    secretStore().set(keyId, val)
    imgSecretInputs[provider.id] = ''
    save()
  }

  const editingImageModel = ref<{
    pIdx: number
    mIdx: number
    model: ImageModelConfig2
    isNew: boolean
  } | null>(null)

  const addImageModel = (pIdx: number) => {
    const newModel = { id: '', name: '', size: '1024x1024', outputFormat: 'png', quality: 'medium' }
    editingImageModel.value = {
      pIdx,
      mIdx: imageProviders.value[pIdx].models.length,
      model: newModel,
      isNew: true,
    }
  }

  const openImageModelEdit = (pIdx: number, mIdx: number) => {
    editingImageModel.value = {
      pIdx,
      mIdx,
      model: { ...imageProviders.value[pIdx].models[mIdx] },
      isNew: false,
    }
  }

  const onImageModelSave = (pIdx: number, mIdx: number, model: ImageModelConfig2) => {
    const models = imageProviders.value[pIdx].models
    if (mIdx >= models.length) {
      models.push(model)
    } else {
      models[mIdx] = model
    }
    save()
  }

  const removeImageModel = (pIdx: number, mIdx: number) => {
    imageProviders.value[pIdx].models.splice(mIdx, 1)
    editingImageModel.value = null
    save()
  }

  const selectDefaultImageModel = (key: string) => {
    defaultImageModel.value = key
    save()
  }

  return {
    imgEndpointDefault,
    imageModelOptions,
    addImageProvider,
    askRemoveImageProvider,
    updateImageProvider,
    applyImageProviderSecret,
    editingImageModel,
    addImageModel,
    openImageModelEdit,
    onImageModelSave,
    removeImageModel,
    selectDefaultImageModel,
  }
}
