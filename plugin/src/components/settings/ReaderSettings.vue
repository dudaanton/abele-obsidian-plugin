<template>
  <div class="abele-settings__reader">
    <Section :desc="t('settings.ReaderSettings.epub_books_in_the_vault.7574b8de')">
      <ReaderSettingsForm />
    </Section>
    <BookNotesSettings />
    <BookScriptsSettings />
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import Section from '../obsidian/Section.vue'
import ReaderSettingsForm from '../reader/ReaderSettingsForm.vue'
import BookNotesSettings from '../reader/BookNotesSettings.vue'
import BookScriptsSettings from '../reader/BookScriptsSettings.vue'
</script>
