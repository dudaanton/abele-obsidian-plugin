<template>
  <ObsidianModal :title="t('streamC.400b02e9b4d285f6')" size="tall" @close="request.answer(false)">
    <div class="abele-script-approval">
      <div class="abele-script-approval__review">
        <p class="abele-script-approval__lead">{{ t('streamC.8e7ae99648a7f988') }}</p>
        <p v-if="request.recovery" class="abele-script-approval__lead">
          {{ t('streamC.aedf4c6ad71685ff') }}
        </p>
        <!-- What is being approved, as a quiet list: which file, from where, and the exact
             bytes, the hash on one line with the whole of it under the pointer. -->
        <dl class="abele-script-approval__facts">
          <dt>{{ t('streamC.50009ce1da4d15e1') }}</dt>
          <dd>{{ request.path }}</dd>
          <dt>{{ t('streamC.639a40e82b9a96f0') }}</dt>
          <dd>{{ request.identity.binding.endpoint }}</dd>
          <dt>{{ t('streamC.999f23fcd7bec707') }}</dt>
          <dd>{{ request.identity.fileId }}</dd>
          <dt>SHA-256</dt>
          <dd class="abele-script-approval__sha" :title="request.sha">
            <code>{{ request.sha }}</code>
          </dd>
        </dl>
        <!-- Changed since it was approved: what changed comes first, the whole script a tab away. -->
        <Tabs
          v-if="request.previousSource !== undefined"
          v-model="shown"
          class="abele-script-approval__tabs"
          :tabs="[
            { id: 'changes', label: 'What changed' },
            { id: 'whole', label: 'Whole script' },
          ]"
        />
        <Diff
          v-if="request.previousSource !== undefined && shown === 'changes'"
          class="abele-script-approval__diff"
          :text-left="request.previousSource"
          :text-right="request.source"
          :path="request.path"
          layout="auto"
        />
        <!-- The code as Obsidian draws a code block, coloured by its own highlighter. -->
        <ObsidianMarkdown v-else class="abele-script-approval__source" :text="fenced" as-document />
      </div>
    </div>
    <template #footer>
      <!-- Stopping the agent is a different decision from leaving this one script blocked, so
           it stands apart on the left. -->
      <div class="abele-modal__actions">
        <Button
          v-if="!request.reviewOnly"
          class="abele-script-approval__stop"
          :text="t('streamC.cae7d57bc067a514')"
          warning
          :tooltip="t('streamC.7da41674b2e13d57')"
          :disabled="readOnly"
          @click="!readOnly && request.stop()"
        />
        <Button
          :text="request.reviewOnly ? t('streamC.6007acbe30b2cd98') : t('streamC.354f979ed1b2f730')"
          :tooltip="
            request.reviewOnly ? t('streamC.c41ac14d8fa8f654') : t('streamC.0ad0878743cc2d5a')
          "
          :accent="!readOnly"
          :disabled="readOnly"
          @click="!readOnly && request.answer(true)"
        />
        <Button
          :text="t('kit.cancel')"
          :tooltip="t('streamC.ff41b0cba98260e1')"
          @click="request.answer(false)"
        />
      </div>
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

import ObsidianModal from './obsidian/Modal.vue'
import Button from './obsidian/Button.vue'
import Tabs from './obsidian/Tabs.vue'
import ObsidianMarkdown from './obsidian/Markdown.vue'
import Diff from './Diff.vue'
import { computed, ref } from 'vue'
import type { ScriptApprovalDialog } from '@/scripting/trust/scriptApprovalPrompt'
const props = withDefaults(defineProps<{ request: ScriptApprovalDialog; readOnly?: boolean }>(), {
  readOnly: false,
})

const shown = ref('changes')

// A fence longer than any run of backticks in the code, so the code can never close it early.
const fenced = computed(() => {
  const longest = Math.max(2, ...(props.request.source.match(/`+/g) ?? []).map((r) => r.length))
  const fence = '`'.repeat(longest + 1)
  const lang = /\.(ts|tsx)$/.test(props.request.path) ? 'ts' : 'js'
  return `${fence}${lang}\n${props.request.source}\n${fence}`
})
</script>

<style lang="scss">
.abele-script-approval {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  min-height: 0;
  flex: 1 1 auto;
}
.abele-script-approval__lead {
  margin-block: 0 var(--size-4-3);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
.abele-script-approval__facts {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--size-2-2) var(--size-4-3);
  margin: 0 0 var(--size-4-3);
  font-size: var(--font-ui-small);

  dt {
    color: var(--text-faint);
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
}
.abele-script-approval__sha {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  code {
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
  }
}
// Facts and source share one scroller so a narrow sheet can scroll past the facts to read
// code at full height, instead of reducing the code to a two-line porthole.
.abele-script-approval__review {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  // Leave room for the native code-copy button's outward focus ring.
  padding: var(--size-4-2);
}
.abele-script-approval__source {
  // Long code wraps rather than push the native sheet sideways.
  pre,
  code {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  pre {
    margin: 0;
  }
}

.abele-script-approval__tabs {
  margin-bottom: var(--size-4-2);
}

.abele-script-approval__stop {
  margin-inline-end: auto;
}
</style>
