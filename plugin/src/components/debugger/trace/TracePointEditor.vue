<template>
  <!-- A record point set up under its line: what it takes, as Obsidian lists a property's values,
       when it fires, and a line saying why it is there. Enter keeps it, Escape leaves it as it
       was; the glyphs at the end say the same, for a finger. -->
  <div
    ref="root"
    class="abele-trace-point"
    role="group"
    :aria-label="`Record point at line ${line}`"
    @keydown.esc.prevent="emit('cancel')"
  >
    <span class="abele-trace-point__label">Take</span>
    <div class="abele-trace-point__field">
      <div class="multi-select-container abele-trace-point__take">
        <div v-for="name in take" :key="name" class="multi-select-pill">
          <div class="multi-select-pill-content">{{ name }}</div>
          <Icon
            icon="x"
            tooltip="Do not take this"
            class="multi-select-pill-remove-button"
            @click="drop(name)"
          />
        </div>
        <input
          ref="adding"
          v-model="added"
          class="multi-select-input"
          :placeholder="take.length ? 'Add' : 'All values here'"
          aria-label="A name or an expression to take"
          spellcheck="false"
          autocomplete="off"
          @keydown.enter.prevent="added.trim() ? add(added) : save()"
          @keydown.backspace="!added && take.length && drop(take[take.length - 1])"
        />
      </div>
      <div v-if="offered.length" class="abele-trace-point__offered">
        <button
          v-for="name in offered"
          :key="name"
          type="button"
          class="abele-trace-point__offer"
          :aria-label="`Take ${name}`"
          @click="add(name)"
        >
          + {{ name }}
        </button>
      </div>
    </div>

    <span class="abele-trace-point__label">When</span>
    <Input
      v-model="when"
      class="abele-trace-point__code"
      placeholder="Always"
      aria-label="Fire only when this holds"
      spellcheck="false"
      autocomplete="off"
      @keydown.enter.prevent="save"
    />

    <span class="abele-trace-point__label">Note</span>
    <Input
      v-model="note"
      placeholder="What happens here"
      aria-label="What happens here: the run's step reads by it"
      @keydown.enter.prevent="save"
    />

    <div class="abele-trace-point__glyphs">
      <Icon icon="trash-2" tooltip="Remove the point" @click="emit('remove')" />
      <Icon
        icon="circle"
        tooltip="Make it a breakpoint: stop here"
        @click="emit('to-breakpoint')"
      />
      <span class="abele-trace-point__gap" />
      <Icon icon="x" tooltip="Leave as it was (Escape)" @click="emit('cancel')" />
      <Icon icon="check" tooltip="Keep (Enter)" @click="save" />
    </div>
  </div>
</template>

<script setup lang="ts">
// What a record point takes, set up where it is: the names the editor sees on its line are
// offered under the field, an expression is typed in with `as` for its name. Nothing taken means
// all the values of that place, which the run warns about by their size.
import { computed, onMounted, ref } from 'vue'
import Icon from '../../obsidian/Icon.vue'
import Input from '../../obsidian/Input.vue'
import type { DebugBreakpoint } from '../types'

const props = defineProps<{
  line: number
  point?: DebugBreakpoint
  /** The names in scope on the line, offered to take. */
  inScope?: string[]
}>()

const emit = defineEmits<{
  (e: 'save', point: { take: string[]; when?: string; note?: string }): void
  (e: 'cancel'): void
  (e: 'remove'): void
  (e: 'to-breakpoint'): void
}>()

const take = ref<string[]>([...(props.point?.take ?? [])])
const when = ref(props.point?.when ?? '')
const note = ref(props.point?.note ?? '')
const added = ref('')
const adding = ref<HTMLInputElement>()
const offered = computed(() => (props.inScope ?? []).filter((n) => !take.value.includes(n)))

function add(name: string) {
  const n = name.trim()
  if (n && !take.value.includes(n)) take.value.push(n)
  added.value = ''
  adding.value?.focus()
}
const drop = (name: string) => (take.value = take.value.filter((n) => n !== name))
const save = () =>
  emit('save', {
    take: take.value,
    when: when.value.trim() || undefined,
    note: note.value.trim() || undefined,
  })

const root = ref<HTMLElement>()
onMounted(() => {
  adding.value?.focus({ preventScroll: true })
  root.value?.scrollIntoView({ block: 'nearest' })
})
</script>

<style lang="scss">
.abele-trace-point {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  gap: var(--size-4-2) var(--size-4-3);
  max-width: 40em;
  font-size: var(--font-ui-small);
}
.abele-trace-point__label {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-trace-point__field {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-2);
  min-width: 0;
}
.abele-trace-point__take,
.abele-trace-point__code input,
.abele-trace-point__take .multi-select-input {
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
}
.abele-trace-point__take .multi-select-input {
  flex: 1 1 8em;
  min-width: 8em;
}
.abele-trace-point__offered {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-2-2);
}
// An offered name reads as a pill not yet taken: the same shape, faint, a plus before it.
.abele-trace-point .abele-trace-point__offer {
  height: auto;
  padding: var(--size-2-1) var(--size-4-2);
  border: var(--border-width) dashed var(--background-modifier-border);
  border-radius: var(--radius-s);
  background: none;
  box-shadow: none;
  color: var(--text-muted);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);

  &:hover {
    background-color: var(--background-modifier-hover);
    color: var(--text-normal);
  }
}
.abele-trace-point__glyphs {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  gap: var(--size-2-2);
}
.abele-trace-point__gap {
  flex: 1 1 auto;
}
</style>
