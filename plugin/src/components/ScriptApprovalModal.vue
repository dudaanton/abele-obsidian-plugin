<template>
  <ObsidianModal title="Review script execution" size="tall" @close="request.answer(false)">
    <div class="abele-script-approval">
      <div class="abele-script-approval__review">
        <p>
          This script has full vault access. Approve only code you trust. This decision applies to
          these exact bytes on this device only.
        </p>
        <p v-if="request.recovery">
          This device no longer has a current identity for this script. Review it to establish a new
          device-local approval. Other unreviewed scripts stay blocked.
        </p>
        <div class="abele-script-approval__facts">
          <p><strong>File:</strong> {{ request.path }}</p>
          <p><strong>Connection:</strong> {{ request.identity.binding.endpoint }}</p>
          <p><strong>Identity:</strong> {{ request.identity.fileId }}</p>
          <p>
            <strong>SHA-256:</strong> <code>{{ request.sha }}</code>
          </p>
        </div>
        <pre class="abele-script-approval__source"><code>{{ request.source }}</code></pre>
      </div>
      <div class="abele-modal__actions">
        <Button text="Cancel" tooltip="Leave this script blocked" @click="request.answer(false)" />
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
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import ObsidianModal from './obsidian/Modal.vue'
import Button from './obsidian/Button.vue'
import type { ScriptApprovalDialog } from '@/scripting/trust/scriptApprovalPrompt'
withDefaults(defineProps<{ request: ScriptApprovalDialog; readOnly?: boolean }>(), {
  readOnly: false,
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
.abele-script-approval__facts {
  overflow-wrap: anywhere;
}
// Facts and source share one scroller so a narrow sheet can scroll past the facts to read
// code at full height, instead of reducing the code to a two-line porthole.
.abele-script-approval__review {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
.abele-script-approval__source {
  // Long code must wrap rather than push the native sheet sideways.
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.abele-script-approval .abele-modal__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
  justify-content: flex-end;
}
</style>
