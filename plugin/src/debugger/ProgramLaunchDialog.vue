<template>
  <Modal
    :title="t('debug.launchTitle')"
    :size="Platform.isMobile ? 'tall' : 'default'"
    close-in-footer
    :can-close="() => !busy"
    @close="emit('close')"
  >
    <Section>
      <Setting :name="t('debug.launchProgram')" :desc="t('debug.launchProgramHint')">
        <Input v-model="path" :disabled="busy" :aria-label="t('debug.launchProgram')" />
      </Setting>
      <Setting :name="t('debug.launchArgs')" :desc="t('debug.launchArgsHint')">
        <Input v-model="argumentsText" :disabled="busy" :aria-label="t('debug.launchArgs')" />
      </Setting>
      <Disclosure v-model="configurationExpanded" :label="t('debug.launchConfiguration')">
        <Setting :name="t('debug.launchRuntimeArgs')" :desc="t('debug.launchRuntimeArgsHint')">
          <Input
            v-model="runtimeArguments"
            :disabled="busy"
            :aria-label="t('debug.launchRuntimeArgs')"
          />
        </Setting>
        <Setting :name="t('debug.launchCwd')" :desc="t('debug.launchCwdHint')">
          <Input v-model="cwd" :disabled="busy" :aria-label="t('debug.launchCwd')" />
        </Setting>
        <Setting :name="t('debug.launchEnv')" :desc="t('debug.launchEnvHint')">
          <Input
            v-model="environment"
            as-text-area
            :rows="3"
            :disabled="busy"
            :aria-label="t('debug.launchEnv')"
          />
        </Setting>
      </Disclosure>
      <Setting v-if="stopOnEntrySupported" :name="t('debug.stopAtStart')">
        <Checkbox
          :is-enabled="stopAtStart"
          :disabled="busy"
          :aria-label="t('debug.stopAtStart')"
          @toggle="stopAtStart = !stopAtStart"
        />
      </Setting>
      <div v-if="error" role="alert" class="mod-warning">
        <p>{{ error }}</p>
        <p v-if="output" class="abele-debug-launch__error">{{ output }}</p>
      </div>
      <Disclosure v-if="technical" v-model="expanded" :label="t('kit.details')">
        <pre class="abele-debug-launch__error">{{ technical }}</pre>
      </Disclosure>
    </Section>
    <template #footer>
      <Button :text="t('kit.cancel')" :disabled="busy" @click="emit('close')" />
      <Button accent :text="t('debug.launchTitle')" :disabled="busy || !path.trim()" @click="run" />
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Platform } from 'obsidian'
import { t } from '@/i18n'
import Modal from '@/components/obsidian/Modal.vue'
import Section from '@/components/obsidian/Section.vue'
import Setting from '@/components/obsidian/Setting.vue'
import Input from '@/components/obsidian/Input.vue'
import Button from '@/components/obsidian/Button.vue'
import Disclosure from '@/components/obsidian/Disclosure.vue'
import Checkbox from '@/components/obsidian/Checkbox.vue'
import { parseLaunchArguments } from './launchArguments'
import {
  parseLaunchEnvironment,
  type LaunchConfiguration,
  type LaunchOptions,
} from './launchConfiguration'
import { z } from 'zod'

const DiagnosticsSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
})

const props = defineProps<{
  program: string
  launch: (
    path: string,
    argv: string[],
    stopOnEntry?: boolean,
    options?: LaunchOptions
  ) => Promise<unknown>
  stopOnEntrySupported?: boolean
  argumentsFor?: (path: string) => string
  rememberArguments?: (path: string, text: string) => void
  configurationFor?: (path: string) => LaunchConfiguration | undefined
  rememberConfiguration?: (path: string, configuration: LaunchConfiguration) => void
}>()
const emit = defineEmits<{ close: [] }>()
const path = ref(props.program)
const stopAtStart = ref(false)
const configurationExpanded = ref(false)
const argumentsText = ref(props.argumentsFor?.(props.program) ?? '')
const runtimeArguments = ref('')
const cwd = ref('')
const environment = ref('')
function restoreConfiguration(value: string) {
  const saved = props.configurationFor?.(value.trim())
  runtimeArguments.value = saved?.runtimeArguments ?? ''
  cwd.value = saved?.cwd ?? ''
  environment.value = saved?.environment ?? ''
}
restoreConfiguration(props.program)
watch(path, (value) => {
  argumentsText.value = props.argumentsFor?.(value.trim()) ?? ''
  restoreConfiguration(value)
})
const busy = ref(false)
const error = ref('')
const output = ref('')
const technical = ref('')
const expanded = ref(false)
async function run() {
  if (busy.value) return
  error.value = ''
  output.value = ''
  technical.value = ''
  expanded.value = false
  let argv: string[]
  let runtimeArgv: string[]
  let env: Record<string, string>
  try {
    argv = parseLaunchArguments(argumentsText.value)
    runtimeArgv = parseLaunchArguments(runtimeArguments.value)
  } catch {
    error.value = t('debug.launchArgsInvalid')
    return
  }
  try {
    env = parseLaunchEnvironment(environment.value)
  } catch {
    error.value = t('debug.launchEnvInvalid')
    return
  }
  busy.value = true
  try {
    props.rememberArguments?.(path.value.trim(), argumentsText.value)
    props.rememberConfiguration?.(path.value.trim(), {
      runtimeArguments: runtimeArguments.value,
      cwd: cwd.value,
      environment: environment.value,
    })
    const options: LaunchOptions = {
      ...(runtimeArgv.length ? { runtime_argv: runtimeArgv } : {}),
      ...(cwd.value.trim() ? { cwd: cwd.value.trim() } : {}),
      ...(Object.keys(env).length ? { env } : {}),
    }
    if (Object.keys(options).length)
      await props.launch(
        path.value.trim(),
        argv,
        props.stopOnEntrySupported ? stopAtStart.value : undefined,
        options
      )
    else if (props.stopOnEntrySupported)
      await props.launch(path.value.trim(), argv, stopAtStart.value)
    else await props.launch(path.value.trim(), argv)
    emit('close')
  } catch (e) {
    console.debug('[debugger] Program not started', e)
    const diagnostics = DiagnosticsSchema.safeParse(e)
    const details = diagnostics.success ? diagnostics.data.details : undefined
    technical.value = [
      ...new Set(
        [
          diagnostics.success ? diagnostics.data.code : undefined,
          diagnostics.success && diagnostics.data.message
            ? diagnostics.data.message
            : e instanceof Error
              ? e.message
              : String(e),
          details ? JSON.stringify(details, null, 2) : undefined,
        ].filter(Boolean)
      ),
    ].join('\n')
    error.value =
      typeof details?.exit_code === 'number'
        ? t('debug.launchExitCode', { code: details.exit_code })
        : technical.value.includes('debugger_startup_handoff_lost')
          ? t('debug.launchExitedEarly')
          : /request_timeout|connection_lost|disconnected|outcome_unknown|delivery_unknown/.test(
                technical.value
              )
            ? t('debug.launchUnknown')
            : technical.value.includes('debugger_program_not_found')
              ? t('debug.launchMissing')
              : t('debug.launchFailedPlain')
    output.value = [details?.stderr, details?.stdout]
      .filter((value): value is string => typeof value === 'string' && !!value)
      .join('\n')
      .split('\n')
      .slice(0, 8)
      .join('\n')
      .slice(0, 2000)
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.abele-debug-launch__error {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
