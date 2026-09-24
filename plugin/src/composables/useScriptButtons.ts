import { computed, onScopeDispose, ref, unref, type ComputedRef, type Ref } from 'vue'
import type { EventRef, TFile } from 'obsidian'
import { AbeleConfig, type HeaderButtonDefinition } from '@/services/AbeleConfig'
import { buttonParams, buttonsForNote, noteVariables } from '@/helpers/headerButtons'
import { getFrontmatterFromCache } from '@/helpers/notesUtils'
import { runScriptByName } from '@/scripting/runScript'
import { GlobalStore } from '@/stores/GlobalStore'

/**
 * The script buttons a note's header shows, and pressing one.
 *
 * Shared by the ordinary header and a task's own, so a button configured for `task` shows on a
 * task too. The settings object is not reactive; reading its `version` is what redraws the
 * buttons when they are configured, or when settings arrive from another device.
 *
 * A button may ask for properties of the note as well, and those change while the note is
 * open — so the buttons are also worked out again whenever Obsidian has re-read this note's
 * frontmatter.
 */
export function useScriptButtons(
  filePath: Ref<string> | ComputedRef<string>,
  noteType: Ref<string | null> | ComputedRef<string | null>
) {
  const frontmatterRevision = ref(0)

  const metadataCache = GlobalStore.getInstance().app?.metadataCache
  if (metadataCache?.on) {
    const changed: EventRef = metadataCache.on('changed', (file: TFile) => {
      if (file?.path === unref(filePath)) frontmatterRevision.value++
    })
    onScopeDispose(() => metadataCache.offref(changed))
  }

  const scriptButtons = computed(() => {
    const config = AbeleConfig.getInstance()
    void config.version.value
    void frontmatterRevision.value
    const path = unref(filePath)
    return buttonsForNote(config.headerButtons, {
      type: unref(noteType),
      path,
      frontmatter: getFrontmatterFromCache(path),
    })
  })

  const runButton = async (button: HeaderButtonDefinition) => {
    // The note is read at the moment the button is pressed rather than when it was drawn: what
    // the parameters describe is the note as it stands now.
    const params = buttonParams(button, noteVariables(unref(filePath)))
    await runScriptByName(button.scriptName, params)
  }

  return { scriptButtons, runButton }
}
