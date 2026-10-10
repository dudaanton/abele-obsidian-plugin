import { expect, it } from 'vitest'
import { evalJson } from './helpers/obsidianCli'

// These are the types captured BEFORE patching. Testing the current prototypes would accept
// our wrappers even when the host methods they call had disappeared in an Obsidian update.
it('Obsidian still supplies every internal method wrapped by note places', () => {
  expect(evalJson('window.__abeleTest.originalNotePlaceHookTypes')).toEqual({
    'WorkspaceLeaf.setViewState': 'function',
    'WorkspaceLeaf.detach': 'function',
    'MarkdownView.setEphemeralState': 'function',
    'MarkdownView.onUnloadFile': 'function',
  })
})
