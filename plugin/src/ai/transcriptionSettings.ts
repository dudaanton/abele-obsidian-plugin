/**
 * Where voice input gets its model and its key.
 *
 * The key is the one OpenRouter key, kept in the keychain under a fixed name so voice and
 * image generation can share it: a person with an OpenRouter account should not have to paste
 * the same key twice.
 */
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_TRANSCRIPTION, type TranscribeOptions } from './transcription'
import type { VoiceSettings } from './types'

export type { VoiceSettings }

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  modelId: DEFAULT_TRANSCRIPTION.modelId,
  endpoint: '',
  apiKeyId: '',
  language: '',
}

export const voiceSettings = (): VoiceSettings => ({
  ...DEFAULT_VOICE_SETTINGS,
  ...(AbeleConfig.getInstance().ai.voice ?? {}),
})

/** The keychain name a key is read from, given what the settings say. */
export const voiceKeyId = (settings: VoiceSettings = voiceSettings()): string =>
  settings.apiKeyId || DEFAULT_TRANSCRIPTION.apiKeyId

export function transcriptionOptions(): TranscribeOptions {
  const settings = voiceSettings()
  const { app } = GlobalStore.getInstance()

  return {
    apiKey: app.secretStorage.getSecret(voiceKeyId(settings)) || '',
    modelId: settings.modelId || DEFAULT_TRANSCRIPTION.modelId,
    endpoint: settings.endpoint || DEFAULT_TRANSCRIPTION.endpoint,
    language: settings.language || undefined,
  }
}
