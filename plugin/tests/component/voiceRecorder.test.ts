/**
 * The voice panel, from tapping the microphone to handing over the words.
 *
 * The recorder and the transcriber are stood in for — one belongs to the browser, the other is
 * a paid request — so what is asserted is the part that is ours: which controls a person is
 * offered at each step, that nothing is emitted until there are words, and that a failed
 * transcription leaves the recording where it is rather than throwing it away.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import VoiceRecorder from '@/components/VoiceRecorder.vue'
import Button from '@/components/obsidian/Button.vue'
import Waveform from '@/components/obsidian/Waveform.vue'

const { recorder, transcribe, toWav } = vi.hoisted(() => {
  const state = { value: 'idle' as string }
  return {
    recorder: {
      state,
      levels: { value: [] as number[] },
      elapsed: { value: 0 },
      recording: { value: null as Blob | null },
      error: { value: '' },
      start: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      reset: vi.fn(),
      dispose: vi.fn(),
    },
    transcribe: vi.fn(),
    toWav: vi.fn(),
  }
})

vi.mock('@/audio/useRecorder', () => ({ useRecorder: () => recorder }))
vi.mock('@/audio/wav', () => ({ toWav }))
vi.mock('@/ai/transcription', () => ({ transcribe }))
vi.mock('@/ai/transcriptionSettings', () => ({
  transcriptionOptions: () => ({ apiKey: 'sk', modelId: 'm' }),
}))

const icons = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('.abele-obsidian-icon').map((i) => i.attributes('aria-label'))

const clickIcon = async (wrapper: ReturnType<typeof mount>, label: string) => {
  await wrapper
    .findAll('.abele-obsidian-icon')
    .find((i) => i.attributes('aria-label') === label)
    ?.trigger('click')
  await flushPromises()
}

const clickButton = async (wrapper: ReturnType<typeof mount>, text: string) => {
  await wrapper
    .findAllComponents(Button)
    .find((b) => b.props('text') === text)
    ?.trigger('click')
  await flushPromises()
}

const open = (props: Record<string, unknown> = {}) => mount(VoiceRecorder, { props })

beforeEach(() => {
  recorder.state.value = 'idle'
  recorder.levels.value = []
  recorder.elapsed.value = 0
  recorder.recording.value = null
  recorder.error.value = ''
  vi.clearAllMocks()
  toWav.mockResolvedValue(new Uint8Array([1, 2, 3]))
  transcribe.mockResolvedValue('привет как дела')
})

describe('before anything is recorded', () => {
  it('offers the microphone and nothing else to press', () => {
    const wrapper = open()

    expect(icons(wrapper)).toContain('Start recording')
    expect(wrapper.findComponent(Waveform).exists()).toBe(false)
  })

  it('starts recording when asked', async () => {
    const wrapper = open()

    await clickIcon(wrapper, 'Start recording')

    expect(recorder.start).toHaveBeenCalled()
  })

  it('starts on its own when it was opened for that', () => {
    open({ autoStart: true })

    expect(recorder.start).toHaveBeenCalled()
  })

  it('shows why there is no microphone rather than a bare button', () => {
    recorder.error.value = 'No microphone. Obsidian needs permission to use it.'

    expect(open().text()).toContain('No microphone')
  })
})

describe('while recording', () => {
  beforeEach(() => {
    recorder.state.value = 'recording'
    recorder.levels.value = [0.2, 0.9, 0.4]
    recorder.elapsed.value = 65_000
  })

  it('draws what is being heard, and how long it has been going', () => {
    const wrapper = open()

    expect(wrapper.findComponent(Waveform).exists()).toBe(true)
    expect(wrapper.text()).toContain('1:05')
  })

  it('offers a pause, a way out, and a way to finish', () => {
    expect(icons(open())).toEqual(
      expect.arrayContaining(['Pause', 'Throw the recording away', 'Finish recording'])
    )
  })

  it('pauses without letting go of what is recorded so far', async () => {
    await clickIcon(open(), 'Pause')

    expect(recorder.pause).toHaveBeenCalled()
    expect(recorder.reset).not.toHaveBeenCalled()
  })

  it('carries on from a pause', async () => {
    recorder.state.value = 'paused'

    await clickIcon(open(), 'Carry on recording')

    expect(recorder.resume).toHaveBeenCalled()
  })

  it('throws the recording away and closes when asked to', async () => {
    const wrapper = open()

    await clickIcon(wrapper, 'Throw the recording away')

    expect(recorder.reset).toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})

describe('once there is a recording', () => {
  beforeEach(() => {
    recorder.state.value = 'recorded'
    recorder.levels.value = [0.3, 0.7]
    recorder.recording.value = new Blob(['audio'])
  })

  it('offers to listen to it and to turn it into text', () => {
    const wrapper = open()

    expect(icons(wrapper)).toContain('Listen to it')
    expect(wrapper.findAllComponents(Button).map((b) => b.props('text'))).toContain('Text')
  })

  it('offers sending only where there is somewhere to send it', () => {
    const inChat = open({ canSend: true })
      .findAllComponents(Button)
      .map((b) => b.props('text'))
    const inNote = open()
      .findAllComponents(Button)
      .map((b) => b.props('text'))

    expect(inChat).toContain('Send')
    expect(inNote).not.toContain('Send')
  })

  it('hands over the words and closes', async () => {
    const wrapper = open()

    await clickButton(wrapper, 'Text')

    expect(toWav).toHaveBeenCalled()
    expect(wrapper.emitted('text')?.[0]).toEqual(['привет как дела'])
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('asks for the words to be sent, when that is what was pressed', async () => {
    const wrapper = open({ canSend: true })

    await clickButton(wrapper, 'Send')

    expect(wrapper.emitted('send')?.[0]).toEqual(['привет как дела'])
    expect(wrapper.emitted('text')).toBeFalsy()
  })

  /** A refused key or a network that dropped must not cost the recording. */
  it('keeps the recording when transcribing fails, and says why', async () => {
    transcribe.mockRejectedValue(new Error('Insufficient credits'))
    const wrapper = open()

    await clickButton(wrapper, 'Text')

    expect(wrapper.text()).toContain('Insufficient credits')
    expect(wrapper.emitted('text')).toBeFalsy()
    expect(wrapper.emitted('close')).toBeFalsy()
    expect(recorder.reset).not.toHaveBeenCalled()
  })

  it('says it is working while the model has it', async () => {
    let release = (_: string) => {}
    transcribe.mockReturnValue(new Promise<string>((resolve) => (release = resolve)))
    const wrapper = open()

    void clickButton(wrapper, 'Text')
    await flushPromises()
    expect(wrapper.text()).toContain('Transcribing')

    release('готово')
    await flushPromises()
    expect(wrapper.emitted('text')?.[0]).toEqual(['готово'])
  })
})
