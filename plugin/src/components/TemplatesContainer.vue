<template>
  <TemplateSelectModal
    v-if="isSelectModalOpen"
    :templates="typedTemplates"
    @close="closeModals"
    @select="onTemplateSelected"
  />
  <TemplateVariablesModal
    v-if="isVariablesModalOpen"
    :variables="typedVariables"
    :initial-values="initialValues"
    @close="closeModals"
    @confirm="onVariablesConfirmed"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getTemplateComposable } from '@/composables/useTemplates'
import { UserTemplate } from '@/templates/UserTemplate'
import { TemplateVariable } from '@/templates/TemplateParser'
import TemplateSelectModal from './TemplateSelectModal.vue'
import TemplateVariablesModal from './TemplateVariablesModal.vue'

const {
  isSelectModalOpen,
  isVariablesModalOpen,
  templates,
  userVariables,
  initialValues,
  onTemplateSelected,
  onVariablesConfirmed,
  closeModals,
} = getTemplateComposable()

const typedTemplates = computed(() => templates.value as UserTemplate[])
const typedVariables = computed(() => userVariables.value as TemplateVariable[])
</script>
