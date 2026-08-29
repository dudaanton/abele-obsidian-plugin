/**
 * Sending a recording off to be turned into words.
 *
 * OpenRouter has no transcription endpoint: the audio goes as part of an ordinary chat
 * message, which means the model has to be *told* to write out what it hears and nothing
 * else — left to itself a chat model answers the question it heard rather than typing it out.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { transcribe, TRANSCRIPTION_MODELS, DEFAULT_TRANSCRIPTION } from '@/ai/transcription'

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }))

vi.mock('obsidian', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../mocks/obsidian')),
  requestUrl,
}))

const wav = () => new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])

const answered = (text: string) =>
  requestUrl.mockResolvedValue({ status: 200, json: { choices: [{ message: { content: text } }] } })

const sent = () => JSON.parse(requestUrl.mock.calls.at(-1)![0].body as string)

const options = { apiKey: 'sk-test', modelId: 'google/gemini-3.5-flash-lite' }

beforeEach(() => {
  requestUrl.mockReset()
})

describe('what gets sent', () => {
  it('goes to OpenRouter as a chat message by default', async () => {
    answered('привет')

    await transcribe(wav(), options)

    expect(requestUrl.mock.calls[0][0].url).toBe(DEFAULT_TRANSCRIPTION.endpoint)
    expect(sent().model).toBe('google/gemini-3.5-flash-lite')
  })

  it('carries the audio itself, base64 and named as WAV', async () => {
    answered('привет')

    await transcribe(wav(), options)

    const part = sent().messages[0].content.find((p: { type: string }) => p.type === 'input_audio')
    expect(part.input_audio.format).toBe('wav')
    expect(part.input_audio.data).toBe('UklGRgECAwQ=')
  })

  it('tells the model to write out the speech rather than answer it', async () => {
    answered('привет')

    await transcribe(wav(), options)

    const text = sent().messages[0].content.find((p: { type: string }) => p.type === 'text').text
    expect(text.toLowerCase()).toContain('transcribe')
  })

  it('names the language when one was chosen, and says nothing when it was not', async () => {
    answered('привет')

    await transcribe(wav(), { ...options, language: 'Russian' })
    const withLanguage = sent().messages[0].content[0].text

    await transcribe(wav(), options)
    const without = sent().messages[0].content[0].text

    expect(withLanguage).toContain('Russian')
    expect(without).not.toContain('Russian')
  })

  it('uses the key it was given, and asks for no reasoning it would have to strip', async () => {
    answered('привет')

    await transcribe(wav(), options)

    expect(requestUrl.mock.calls[0][0].headers.Authorization).toBe('Bearer sk-test')
    expect(sent().temperature).toBe(0)
  })

  it('goes wherever it is pointed, for a model somewhere else entirely', async () => {
    answered('привет')

    await transcribe(wav(), { ...options, endpoint: 'https://example.dev/v1/chat/completions' })

    expect(requestUrl.mock.calls[0][0].url).toBe('https://example.dev/v1/chat/completions')
  })
})

describe('what comes back', () => {
  it('is the words, with the whitespace tidied', async () => {
    answered('  привет, как дела \n')

    await expect(transcribe(wav(), options)).resolves.toBe('привет, как дела')
  })

  /** Models like to introduce themselves; the prompt asks them not to, and this catches it. */
  it('drops a wrapper the model put around the words anyway', async () => {
    answered('```\nпривет\n```')

    await expect(transcribe(wav(), options)).resolves.toBe('привет')
  })

  it('is empty when the recording held no speech', async () => {
    answered('')

    await expect(transcribe(wav(), options)).resolves.toBe('')
  })

  it('says what went wrong rather than throwing something unreadable', async () => {
    requestUrl.mockResolvedValue({
      status: 402,
      json: { error: { message: 'Insufficient credits' } },
    })

    await expect(transcribe(wav(), options)).rejects.toThrow('Insufficient credits')
  })

  it('complains plainly when there is no key', async () => {
    await expect(transcribe(wav(), { ...options, apiKey: '' })).rejects.toThrow(/key/i)
    expect(requestUrl).not.toHaveBeenCalled()
  })
})

describe('the models offered', () => {
  it('are the two that were chosen, by their OpenRouter ids', () => {
    expect(TRANSCRIPTION_MODELS.map((m) => m.id)).toEqual([
      'google/gemini-3.5-flash-lite',
      'mistralai/voxtral-small-24b-2507',
    ])
  })

  it('each say where they run and what they cost, because that is why they were picked', () => {
    for (const model of TRANSCRIPTION_MODELS) {
      expect(model.note).toBeTruthy()
    }
  })
})
