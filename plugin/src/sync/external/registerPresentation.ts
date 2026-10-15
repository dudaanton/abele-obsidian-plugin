import { ViewPlugin } from '@codemirror/view'
import { editorInfoField, type Plugin } from 'obsidian'
import { tokenOffloadsOf } from '../tokenOffloadCoordinator'
import { pathCoordinatorOf } from '../pathCoordinator'
import { ExternalFileTab } from './ExternalFileTab'
import { EXTERNAL_VIEW_TYPE, routeExternalFiles, routeExternalLinks } from './opening'
import { externalEmbedProcessor, externalEmbedsInEditor } from './embed'

export function registerExternalPresentation(plugin: Plugin): void {
  const { app } = plugin
  const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
  plugin.registerView(EXTERNAL_VIEW_TYPE, (leaf) => new ExternalFileTab(leaf))
  plugin.register(routeExternalLinks(app, manager))
  plugin.register(routeExternalFiles(app, manager))
  plugin.registerMarkdownPostProcessor(externalEmbedProcessor(app))
  plugin.registerEditorExtension(
    ViewPlugin.define(
      externalEmbedsInEditor(
        app,
        (view) => view.state.field(editorInfoField, false)?.file?.path ?? ''
      )
    )
  )
}
