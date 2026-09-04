<template>
  <template v-if="!n.hidden">
    <div
      v-if="n.type === 'stack'"
      class="abele-script-node__stack"
      :class="[`abele-script-node__stack_gap-${n.gap}`, n.cls]"
    >
      <ScriptNode v-for="child in n.children" :key="child.key" :node="child" :view="view" />
    </div>

    <div
      v-else-if="n.type === 'row'"
      class="abele-script-node__row"
      :class="[
        `abele-script-node__row_gap-${n.gap}`,
        `abele-script-node__row_align-${n.align}`,
        { 'abele-script-node__row_nowrap': !n.wrap },
        n.cls,
      ]"
    >
      <ScriptNode v-for="child in n.children" :key="child.key" :node="child" :view="view" />
    </div>

    <CardGrid v-else-if="n.type === 'grid'" :wide="n.wide" :stack="n.stack" :class="n.cls">
      <ScriptNode v-for="child in n.children" :key="child.key" :node="child" :view="view" />
    </CardGrid>

    <Section v-else-if="n.type === 'section'" :title="n.title" :desc="n.desc" :class="n.cls">
      <ScriptNode v-for="child in n.children" :key="child.key" :node="child" :view="view" />
    </Section>

    <div v-else-if="n.type === 'tabs'" class="abele-script-node__tabs" :class="n.cls">
      <Tabs :tabs="tabStrip" :model-value="n.active" @update:model-value="pickTab" />
      <div class="abele-script-node__tab-content">
        <ScriptNode
          v-for="child in n.contentOf(n.active)"
          :key="child.key"
          :node="child"
          :view="view"
        />
      </div>
    </div>

    <Setting v-else-if="n.type === 'setting'" :name="n.name" :desc="n.desc" :class="n.cls">
      <ScriptNode v-for="child in n.children" :key="child.key" :node="child" :view="view" />
    </Setting>

    <Markdown
      v-else-if="n.type === 'markdown'"
      :text="n.file ? fileText : n.text"
      :file-path="n.file ?? n.filePath"
      :as-document="Boolean(n.file)"
      class="abele-script-node__markdown"
      :class="n.cls"
      @click="fire('click')"
    />

    <p
      v-else-if="n.type === 'text'"
      class="abele-script-node__text"
      :class="[
        { 'abele-script-node__text_muted': n.muted, 'abele-script-node__text_small': n.small },
        n.cls,
      ]"
    >
      {{ n.text }}
    </p>

    <Image
      v-else-if="n.type === 'image'"
      :src="n.src"
      :alt="n.alt"
      :fit="n.fit"
      :class="n.cls"
      @click="fire('click')"
    />

    <Table
      v-else-if="n.type === 'table'"
      :columns="n.columns"
      :rows="n.rows"
      :clickable="n.has('rowClick')"
      :class="n.cls"
      @row-click="(row, i) => fire('rowClick', row, i)"
    >
      <template #cell="{ value }">
        <ScriptNode v-if="isNode(value)" :key="value.key" :node="value" :view="view" />
        <template v-else>{{ value ?? '' }}</template>
      </template>
    </Table>

    <Badge v-else-if="n.type === 'badge'" :text="n.text" :accent="n.accent" :class="n.cls" />

    <EmptyState v-else-if="n.type === 'empty'" :text="n.text" :class="n.cls" />

    <Button
      v-else-if="n.type === 'button'"
      :text="n.text"
      :icon="n.icon"
      :accent="n.accent"
      :warning="n.warning"
      :disabled="n.disabled"
      :tooltip="n.tooltip"
      :class="n.cls"
      @click="fire('click')"
    />

    <Icon
      v-else-if="n.type === 'icon'"
      :icon="n.icon"
      :tooltip="n.tooltip"
      :disabled="n.disabled"
      :class="n.cls"
      @click="fire('click')"
    />

    <Input
      v-else-if="n.type === 'input'"
      :model-value="n.value"
      :placeholder="n.placeholder"
      :as-text-area="n.textarea"
      :rows="n.rows"
      :disabled="n.disabled"
      :class="n.cls"
      @update:model-value="
        (v: string) => {
          n.value = v
          fire('input', v)
        }
      "
      @change="fire('change', n.value)"
      @keydown.enter="!n.textarea && fire('enter', n.value)"
    />

    <Dropdown
      v-else-if="n.type === 'select'"
      :options="options"
      :model-value="n.value"
      :class="n.cls"
      @update:model-value="
        (v: string) => {
          n.value = v
          fire('change', v)
        }
      "
    />

    <div v-else-if="n.type === 'checkbox'" class="abele-script-node__checkbox" :class="n.cls">
      <Checkbox :is-enabled="n.checked" @toggle="toggle" />
      <span v-if="n.label" class="abele-script-node__checkbox-label" @click="toggle">
        {{ n.label }}
      </span>
    </div>

    <Search
      v-else-if="n.type === 'search'"
      :model-value="n.value"
      :placeholder="n.placeholder"
      :suggester="suggester"
      :class="n.cls"
      @update:model-value="
        (v: string) => {
          n.value = v
          fire('change', v)
        }
      "
    />

    <Card
      v-else-if="n.type === 'card'"
      :title="n.title"
      :subtitle="n.subtitle"
      :description="n.description"
      :meta="n.meta"
      :selected="n.selected"
      :clickable="n.has('click')"
      :class="n.cls"
      @click="fire('click')"
    >
      <template v-if="n.badges.length" #badges>
        <ScriptNode v-for="child in n.badges" :key="child.key" :node="child" :view="view" />
      </template>
      <template v-if="n.actions.length" #actions>
        <ScriptNode v-for="child in n.actions" :key="child.key" :node="child" :view="view" />
      </template>
      <ScriptNode v-for="child in n.children" :key="child.key" :node="child" :view="view" />
    </Card>

    <!-- Task 7 puts `ScriptHtml` here; until then raw markup is named and not drawn. -->
    <EmptyState v-else-if="n.type === 'html'" text="Html" />
  </template>
</template>

<script setup lang="ts">
/**
 * One node of a script's view, as the kit component it stands for.
 *
 * The switch is the whole point: a script says `Button`, the plugin's own `Button.vue` is
 * what appears, and the view cannot help looking like the rest of the plugin. Every handler
 * goes through `view.run`, which reports a throw into the view's error strip rather than
 * letting it take the tree down; `onErrorCaptured` does the same for a render error.
 */
import { computed, onErrorCaptured, onMounted, onUnmounted, ref, watch } from 'vue'
import { TFile, type EventRef } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import type { View } from '@/scripting/view/View'
import { isNode, type ViewNode } from '@/scripting/view/components'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import { FolderSuggest } from '@/helpers/suggesters/FolderSuggester'
import CardGrid from './obsidian/CardGrid.vue'
import Section from './obsidian/Section.vue'
import Tabs from './obsidian/Tabs.vue'
import Setting from './obsidian/Setting.vue'
import Markdown from './obsidian/Markdown.vue'
import Image from './obsidian/Image.vue'
import Table from './obsidian/Table.vue'
import Badge from './obsidian/Badge.vue'
import EmptyState from './obsidian/EmptyState.vue'
import Button from './obsidian/Button.vue'
import Icon from './obsidian/Icon.vue'
import Input from './obsidian/Input.vue'
import Dropdown from './obsidian/Dropdown.vue'
import Checkbox from './obsidian/Checkbox.vue'
import Search from './obsidian/Search.vue'
import Card from './obsidian/Card.vue'

const props = defineProps<{ node: ViewNode; view: View }>()

/**
 * The template switches on `type` and reads the props of whichever class that is. One loose
 * alias instead of a cast per branch: the component is keyed by the node, so `n` never
 * changes identity while it lives.
 */
const n = props.node as ViewNode & Record<string, any>

const fire = (event: string, ...args: unknown[]) =>
  void props.view.run(() => props.node.emit(event, ...args))

onErrorCaptured((err) => {
  props.view.report(err)
  return false
})

// ── tabs ──
const tabStrip = computed(() =>
  n.type === 'tabs'
    ? n.tabs.map(
        ({
          id,
          label,
          icon,
          tooltip,
        }: {
          id: string
          label: string
          icon?: string
          tooltip?: string
        }) => ({ id, label, ...(icon ? { icon } : {}), ...(tooltip ? { tooltip } : {}) })
      )
    : []
)
const pickTab = (id: string) => {
  n.active = id
  fire('change', id)
}

// ── select / search ──
const options = computed(() =>
  n.type === 'select'
    ? n.options.map((o: { value: string; label: string }) => ({ value: o.value, display: o.label }))
    : []
)
const suggester = computed(() =>
  n.suggest === 'file' ? FileSuggest : n.suggest === 'folder' ? FolderSuggest : undefined
)

// ── checkbox ──
const toggle = () => {
  n.checked = !n.checked
  fire('change', n.checked)
}

// ── markdown from a file ──
const fileText = ref('')
let modifyRef: EventRef | null = null

async function readNote(path: string) {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  fileText.value =
    file instanceof TFile ? await app.vault.cachedRead(file) : `File not found: ${path}`
}

if (n.type === 'markdown') {
  watch(
    () => n.file,
    (file) => {
      if (file) void readNote(file)
    },
    { immediate: true }
  )
  onMounted(() => {
    modifyRef = GlobalStore.getInstance().app.vault.on('modify', (file) => {
      if (file.path === n.file) void readNote(file.path)
    })
  })
  onUnmounted(() => {
    if (modifyRef) GlobalStore.getInstance().app.vault.offref(modifyRef)
  })
}
</script>

<style lang="scss">
.abele-script-node__stack,
.abele-script-node__tab-content {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
}

.abele-script-node__stack_gap-none {
  gap: 0;
}

.abele-script-node__stack_gap-small {
  gap: var(--size-4-1);
}

.abele-script-node__stack_gap-large {
  gap: var(--size-4-6);
}

.abele-script-node__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-2);
}

.abele-script-node__row_gap-none {
  gap: 0;
}

.abele-script-node__row_gap-small {
  gap: var(--size-4-1);
}

.abele-script-node__row_gap-large {
  gap: var(--size-4-4);
}

.abele-script-node__row_align-center {
  justify-content: center;
}

.abele-script-node__row_align-end {
  justify-content: flex-end;
}

.abele-script-node__row_align-between {
  justify-content: space-between;
}

.abele-script-node__row_nowrap {
  flex-wrap: nowrap;
}

.abele-script-node__tabs {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
}

.abele-script-node__text {
  margin: 0;
}

.abele-script-node__text_muted {
  color: var(--text-muted);
}

.abele-script-node__text_small {
  font-size: var(--font-ui-smaller);
}

.abele-script-node__checkbox {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
}

.abele-script-node__checkbox-label {
  cursor: var(--cursor-link);
}
</style>
