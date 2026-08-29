<template>
  <div ref="root" class="abele-voice">
    <template v-if="recorder.state.value === 'idle' && !busy">
      <Icon
        icon="mic"
        with-bg
        class="abele-voice__record"
        tooltip="Start recording"
        @click="begin"
      />
      <span class="abele-voice__hint">{{ recorder.error.value || 'Tap to record' }}</span>
      <Icon icon="x" tooltip="Close voice input" @click="emit('close')" />
    </template>

    <template v-else-if="listening">
      <Icon
        :icon="recorder.state.value === 'paused' ? 'mic' : 'pause'"
        with-bg
        :class="{ 'abele-voice__live': recorder.state.value === 'recording' }"
        :tooltip="recorder.state.value === 'paused' ? 'Carry on recording' : 'Pause'"
        @click="recorder.state.value === 'paused' ? recorder.resume() : recorder.pause()"
      />
      <Waveform :levels="tail" label="What is being recorded" />
      <span class="abele-voice__time">{{ clock(recorder.elapsed.value) }}</span>
      <Icon icon="trash-2" tooltip="Throw the recording away" @click="discard" />
      <Icon icon="check" with-bg tooltip="Finish recording" @click="finish" />
    </template>

    <template v-else-if="recorder.state.value === 'requesting'">
      <Icon icon="loader" no-hover class="abele-voice__spinner" />
      <span class="abele-voice__hint">Waiting for the microphone…</span>
      <Icon icon="x" tooltip="Close voice input" @click="discard" />
    </template>

    <template v-else-if="busy">
      <Icon icon="loader" no-hover class="abele-voice__spinner" />
      <span class="abele-voice__hint">Transcribing…</span>
    </template>

    <template v-else>
      <Icon
        :icon="playing ? 'pause' : 'play'"
        with-bg
        :tooltip="playing ? 'Pause' : 'Listen to it'"
        @click="togglePlay"
      />
      <Waveform :levels="recorder.levels.value" :progress="progress" label="The recording" />
      <span class="abele-voice__time">{{ clock(recorder.elapsed.value) }}</span>
      <Icon icon="trash-2" tooltip="Throw the recording away" @click="discard" />
      <Button text="Text" tooltip="Transcribe it into the text field" @click="toText" />
      <Button v-if="canSend" text="Send" accent tooltip="Transcribe it and send" @click="toSend" />
    </template>

    <span v-if="failure" class="abele-voice__error">{{ failure }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue'
import Icon from './obsidian/Icon.vue'
import Button from './obsidian/Button.vue'
import Waveform from './obsidian/Waveform.vue'
import { useRecorder } from '@/audio/useRecorder'
import { toWav } from '@/audio/wav'
import { transcribe } from '@/ai/transcription'
import { transcriptionOptions } from '@/ai/transcriptionSettings'

const props = withDefaults(defineProps<{ canSend?: boolean; autoStart?: boolean }>(), {
  canSend: false,
  autoStart: false,
})

const emit = defineEmits<{
  /** The words, for the caller to put wherever they belong. */
  (e: 'text', text: string): void
  /** The words, and the caller should send them on. */
  (e: 'send', text: string): void
  (e: 'close'): void
}>()

const root = useTemplateRef<HTMLElement>('root')
const win = () => root.value?.win ?? window

const recorder = useRecorder(window)
const busy = ref(false)
const failure = ref('')
const playing = ref(false)
const progress = ref<number | undefined>(undefined)

let audio: HTMLAudioElement | null = null

const listening = computed(
  () => recorder.state.value === 'recording' || recorder.state.value === 'paused'
)

/** While recording, only the last stretch is shown — a scrolling tail, as a phone does it. */
const TAIL = 56
const tail = computed(() => recorder.levels.value.slice(-TAIL))

const clock = (ms: number) => {
  const total = Math.floor(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

const begin = async () => {
  failure.value = ''
  await recorder.start()
}

const finish = async () => {
  await recorder.stop()
}

const discard = () => {
  stopPlaying()
  recorder.reset()
  emit('close')
}

const stopPlaying = () => {
  audio?.pause()
  audio = null
  playing.value = false
  progress.value = undefined
}

const togglePlay = () => {
  if (playing.value) return stopPlaying()

  const blob = recorder.recording.value
  if (!blob) return

  const url = URL.createObjectURL(blob)
  audio = new (win().Audio)(url)
  audio.ontimeupdate = () => {
    if (audio?.duration) progress.value = audio.currentTime / audio.duration
  }
  audio.onended = () => {
    URL.revokeObjectURL(url)
    stopPlaying()
  }
  void audio.play()
  playing.value = true
}

/**
 * The recording as words.
 *
 * Recorded as webm or mp4 depending on the engine, and sent as WAV, because that is the one
 * format every provider behind OpenRouter accepts — see `audio/wav.ts`.
 */
const words = async (): Promise<string | null> => {
  const blob = recorder.recording.value
  if (!blob) return null

  busy.value = true
  failure.value = ''
  try {
    const wav = await toWav(blob, win() as Window & typeof window)
    return await transcribe(wav, transcriptionOptions())
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
    return null
  } finally {
    busy.value = false
  }
}

const toText = async () => {
  const text = await words()
  if (text === null) return

  emit('text', text)
  recorder.reset()
  emit('close')
}

const toSend = async () => {
  const text = await words()
  if (text === null) return

  emit('send', text)
  recorder.reset()
  emit('close')
}

if (props.autoStart) void begin()

onBeforeUnmount(() => {
  stopPlaying()
  recorder.dispose()
})
</script>

<style lang="scss">
.abele-voice {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-2);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  background-color: var(--background-secondary);
}

.abele-voice__hint {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  flex: 1 1 auto;
}

.abele-voice__time {
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}

/** The recording light: the same pulse Obsidian's own recorder uses. */
.abele-voice__live {
  color: var(--text-error);
  animation: abele-voice-pulse 1.4s ease-in-out infinite;
}

.abele-voice__spinner {
  animation: abele-voice-spin 1s linear infinite;
}

.abele-voice__error {
  color: var(--text-error);
  font-size: var(--font-ui-smaller);
}

@keyframes abele-voice-pulse {
  50% {
    opacity: 0.35;
  }
}

@keyframes abele-voice-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
