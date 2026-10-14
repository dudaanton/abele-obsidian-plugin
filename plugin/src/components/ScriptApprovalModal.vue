<template>
  <ObsidianModal title="Review script execution" size="tall" @close="request.answer(false)">
    <div class="abele-script-approval">
      <div class="abele-script-approval__review">
        <p class="abele-script-approval__lead">
          This script has full vault access. Approve only code you trust. This decision applies to
          these exact bytes on this device only.
        </p>
        <p v-if="request.recovery" class="abele-script-approval__lead">
          This device no longer has a current identity for this script. Review it to establish a new
          device-local approval. Other unreviewed scripts stay blocked.
        </p>
        <!-- What is being approved, as a quiet list: which file, from where, and the exact
             bytes, the hash on one line with the whole of it under the pointer. -->
        <dl class="abele-script-approval__facts">
          <dt>File</dt>
          <dd>{{ request.path }}</dd>
          <dt>Connection</dt>
          <dd>{{ request.identity.binding.endpoint }}</dd>
          <dt>Identity</dt>
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
          text="Stop"
          warning
          tooltip="Reject and stop the agent"
          :disabled="readOnly"
          @click="!readOnly && request.stop()"
        />
        <Button
          :text="request.reviewOnly ? 'Approve' : 'Approve and run'"
          :tooltip="
            request.reviewOnly
              ? 'Approve these exact bytes on this device without running'
              : 'Approve these exact bytes on this device and run'
          "
          :accent="!readOnly"
          :disabled="readOnly"
          @click="!readOnly && request.answer(true)"
        />
        <Button text="Cancel" tooltip="Leave this script blocked" @click="request.answer(false)" />
      </div>
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
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
