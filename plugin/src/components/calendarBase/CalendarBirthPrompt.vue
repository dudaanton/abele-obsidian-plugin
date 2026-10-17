<template>
  <div class="abele-calendar-base__birth">
    <EmptyState
      :text="
        t(
          'area.aLifeInWeeksIsCountedFromYourBirthDateSetItOnceHereAndEveryBaseUsesItItIsKeptInThePluginsSettingsUnderTasks'
        )
      "
    />
    <div class="abele-calendar-base__birth-row">
      <Input
        type="date"
        class="abele-calendar-base__birth-input"
        :model-value="draft"
        @update:model-value="(v) => (draft = v)"
      />
      <Button
        :text="t('area.showMyWeeks')"
        accent
        :disabled="!isBirthDate(draft)"
        :tooltip="
          isBirthDate(draft) ? t('area.saveTheBirthDateAndDrawTheWeeks') : t('area.pickADateFirst')
        "
        @click="save"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
/**
 * What the life in weeks shows before it knows when the life began: a field for the birth date,
 * saved into the plugin's settings — one date for the person, not one per base.
 */
import { ref } from 'vue'
import Button from '../obsidian/Button.vue'
import Input from '../obsidian/Input.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { isBirthDate } from '@/bases/lifeWeeks'

const draft = ref('')

const save = async () => {
  if (!isBirthDate(draft.value)) return
  const config = AbeleConfig.getInstance()
  config.birthDate = draft.value
  await config.saveSettings()
}
</script>

<style lang="scss">
.abele-calendar-base__birth {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  max-width: 32em;
}

.abele-calendar-base__birth-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
}

.abele-calendar-base__birth-input {
  flex: 1 1 10em;
  width: auto;
}
</style>
