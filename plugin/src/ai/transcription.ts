/**
 * Turning a recording into words.
 *
 * OpenRouter has no transcription endpoint — no `/audio/transcriptions`, no Whisper — so the
 * audio rides inside an ordinary chat message as an `input_audio` part, and the model is asked
 * to type out what it hears. That asking matters: a chat model given speech will cheerfully
 * *answer* it instead, so the instruction is explicit and the temperature is nailed to zero.
 */
import { requestUrl } from 'obsidian'

export interface TranscriptionModel {
  id: string
  name: string
  /** Why this one is on the list — where it runs, what it costs. */
  note: string
}

/**
 * The two picked out of everything OpenRouter offers with audio input, on 2026-08-29.
 *
 * There are no dedicated speech models there at all; these are the cheapest of the ones that
 * hear, that run in Europe, and that are not training on what is sent.
 */
export const TRANSCRIPTION_MODELS: TranscriptionModel[] = [
  {
    id: 'google/gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash Lite',
    note: 'About $0.0006 a minute. Has a European endpoint (google-vertex/eu); Vertex does not train on what it is sent.',
  },
  {
    id: 'mistralai/voxtral-small-24b-2507',
    name: 'Voxtral Small (Mistral)',
    note: 'About $0.006 a minute. French, built for transcription, and its endpoint is tagged zero-data-retention.',
  },
]

export const DEFAULT_TRANSCRIPTION = {
  endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  modelId: TRANSCRIPTION_MODELS[0].id,
  /** Where the OpenRouter key lives, so voice and images can share the one key. */
  apiKeyId: 'abele-openrouter',
}

export interface TranscribeOptions {
  apiKey: string
  modelId: string
  /** For a model somewhere other than OpenRouter. */
  endpoint?: string
  /** Named in the instruction when set. Left out, the model decides for itself. */
  language?: string
}

const instruction = (language?: string) =>
  [
    'Transcribe the speech in this audio exactly as spoken.',
    language ? `The speech is in ${language}.` : '',
    'Reply with the transcription only: no preamble, no translation, no commentary,',
    'no quotation marks around it, and no description of the audio.',
    'If there is no speech, reply with nothing at all.',
  ]
    .filter(Boolean)
    .join(' ')

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  // In chunks: `String.fromCharCode(...bytes)` on a minute of audio is a million arguments,
  // which overflows the call stack rather than returning a string.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** A model that wrapped the words in a code fence or quotes despite being asked not to. */
const unwrap = (text: string): string =>
  text
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/, '')
    .replace(/^["«](.*)["»]$/s, '$1')
    .trim()

export async function transcribe(wav: Uint8Array, options: TranscribeOptions): Promise<string> {
  if (!options.apiKey) {
    throw new Error('No API key for transcription. Add an OpenRouter key in the voice settings.')
  }

  const response = await requestUrl({
    url: options.endpoint || DEFAULT_TRANSCRIPTION.endpoint,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    // Obsidian throws on a non-2xx by default, which loses the body that says what went wrong.
    throw: false,
    body: JSON.stringify({
      model: options.modelId,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: instruction(options.language) },
            { type: 'input_audio', input_audio: { data: toBase64(wav), format: 'wav' } },
          ],
        },
      ],
    }),
  })

  const body = response.json as {
    choices?: { message?: { content?: string } }[]
    error?: { message?: string }
  }

  if (response.status >= 300) {
    throw new Error(body?.error?.message || `Transcription failed (${response.status})`)
  }

  return unwrap(body?.choices?.[0]?.message?.content ?? '')
}
