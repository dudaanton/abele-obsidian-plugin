import { expect, it } from 'vitest'
import ts from 'typescript'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname, posix } from 'node:path'

// Existing non-sync integrations may use their own storage APIs. New modules require an explicit entry.
const nonSyncFilesystem = new Set([
  'src/agents/AgentsService.ts',
  'src/ai/ChatSearchIndex.ts',
  'src/ai/ChatService.ts',
  'src/ai/ChatSession.ts',
  'src/ai/ChatStorage.ts',
  'src/ai/CommentService.ts',
  'src/ai/RunStorage.ts',
  'src/ai/agents/AgentRegistry.ts',
  'src/ai/attachments.ts',
  'src/ai/chatCopy.ts',
  'src/ai/chatIndexFile.ts',
  'src/ai/commentTrail.ts',
  'src/ai/imagePrep.ts',
  'src/ai/messageCards.ts',
  'src/ai/openChat.ts',
  'src/ai/readGuard.ts',
  'src/ai/rewind/ChangeTracker.ts',
  'src/ai/rewind/RewindStore.ts',
  'src/ai/rewind/vaultFs.ts',
  'src/ai/tools/CopyFileTool.ts',
  'src/ai/tools/CreateFileTool.ts',
  'src/ai/tools/CreateScriptTool.ts',
  'src/ai/tools/DeckTools.ts',
  'src/ai/tools/DeleteFileTool.ts',
  'src/ai/tools/DrawingTool.ts',
  'src/ai/tools/EditFileTool.ts',
  'src/ai/tools/EditSelectionTool.ts',
  'src/ai/tools/FindTool.ts',
  'src/ai/tools/ReadFileTool.ts',
  'src/ai/tools/RelationTools.ts',
  'src/ai/tools/ReplaceTool.ts',
  'src/ai/tools/ScreenshotTool.ts',
  'src/ai/tools/SkillTool.ts',
  'src/ai/tools/WriteFileTool.ts',
  'src/ai/tools/imageUtils.ts',
  'src/analytics/sources/baseProbe.ts',
  'src/archive/vaultZip.ts',
  'src/calendars/meetingNote.ts',
  'src/calendars/start.ts',
  'src/canvas/CanvasView.ts',
  'src/canvas/adapter.ts',
  'src/canvas/editorControls.ts',
  'src/canvas/embed.ts',
  'src/canvas/excalidraw/migrate.ts',
  'src/canvas/excalidrawAdapter.ts',
  'src/canvas/exportAdapter.ts',
  'src/canvas/measureAdapter.ts',
  'src/canvas/obsidianStore.ts',
  'src/canvas/opening.ts',
  'src/canvas/pickedActions.ts',
  'src/canvas/pictureAdapter.ts',
  'src/checkboxes/register.ts',
  'src/columns/register.ts',
  'src/commands/createNoteInGroup.ts',
  'src/commands/migrateDataviewFields.ts',
  'src/commands/migrateFromFirefly.ts',
  'src/commands/migrateFromToggl.ts',
  'src/commands/setCover.ts',
  'src/comments/TextComments.ts',
  'src/comments/vaultRepository.ts',
  'src/components/AiChat.vue',
  'src/components/AiRunView.vue',
  'src/components/AiToolApproval.vue',
  'src/components/ChatArtifacts.vue',
  'src/components/DeduplicateMediaModal.vue',
  'src/components/GalleryViewer.vue',
  'src/components/MigrateFromDataviewModal.vue',
  'src/components/SaveMediaModal.vue',
  'src/components/ScriptNode.vue',
  'src/components/settings/NodesSettings.vue',
  'src/components/sync/VersionHistoryModal.vue',
  'src/composables/useGalleryImports.ts',
  'src/composables/useListSearch.ts',
  'src/composables/useReplacementPreview.ts',
  'src/debugger/trace/notesFolder.ts',
  'src/drawing/DrawingView.ts',
  'src/drawing/ImageInkView.ts',
  'src/drawing/askAgent.ts',
  'src/drawing/embed.ts',
  'src/drawing/files.ts',
  'src/drawing/noteLayer.ts',
  'src/drawing/noteRenames.ts',
  'src/entities/Task.ts',
  'src/finance/rates/start.ts',
  'src/github/users.ts',
  'src/helpers/bulkReplacement.ts',
  'src/helpers/mediaDeduplication.ts',
  'src/helpers/mediaReferences.ts',
  'src/helpers/noteFilter.ts',
  'src/helpers/notesUtils.ts',
  'src/helpers/protocolHandler.ts',
  'src/helpers/reduceImage.ts',
  'src/helpers/taskFileName.ts',
  'src/helpers/transactionFileName.ts',
  'src/helpers/vaultUtils.ts',
  'src/linter/engine.ts',
  'src/media/importImageFile.ts',
  'src/node/NodeObsidianAdapter.ts',
  'src/node/NodeObsidianTools.ts',
  'src/node/localDiscovery.ts',
  'src/notePlaces/otherPlugin.ts',
  'src/ooxml/vaultAdapter.ts',
  'src/properties/dailyNote.ts',
  'src/properties/noteReader.ts',
  'src/properties/thumbnails.ts',
  'src/reader/BookView.ts',
  'src/reader/bookText.ts',
  'src/reader/bookmarkFiles.ts',
  'src/reader/companion.ts',
  'src/reader/ink/inkStore.ts',
  'src/reader/places.ts',
  'src/reader/readerFonts.ts',
  'src/reader/vocab/formsLinks.ts',
  'src/scripting/ScriptContext.ts',
  'src/scripting/ScriptService.ts',
  'src/scripting/noteInfo.ts',
  'src/scripting/trust/localScriptUpgrade.ts',
  'src/scripting/trust/localScriptWrite.ts',
  'src/scripting/trust/scriptExecutionGate.ts',
  'src/scripting/trust/scriptTrustStorage.ts',
  'src/scripting/vocabularyApi.ts',
  'src/secrets/host.ts',
  'src/services/SnippetService.ts',
  'src/services/revisionTrash.ts',
  'src/services/settingsFile.ts',
  'src/slides/adapter.ts',
  'src/slides/cssImportAdapter.ts',
  'src/slides/newDeck.ts',
  'src/slides/register.ts',
  'src/stores/GlobalStore.ts',
  'src/templates/GenericTemplate.ts',
  'src/templates/TemplateService.ts',
  'src/templates/UserTemplate.ts',
  'src/testing/canvasProbe.ts',
  'src/testing/chatArtifactsFixture.ts',
  'src/testing/openRewind.ts',
  'src/transfer/files.ts',
  'src/transfer/saveFile.ts',
  'src/views/CodeView.ts',
  'src/word/vaultAdapter.ts',
])

function violations(source: string): string[] {
  const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  if (scripts.length) source = scripts.map((match) => match[1]).join('\n')
  const ast = ts.createSourceFile('sample.ts', source, ts.ScriptTarget.Latest)
  const found: string[] = []
  const walk = (node: ts.Node) => {
    if (
      (ts.isCallExpression(node) &&
        ['Reflect.get', 'Reflect.apply'].includes(node.expression.getText(ast)) &&
        node.arguments.some((arg) => /\b(?:adapter|rawAdapter)\b/.test(arg.getText(ast)))) ||
      (ts.isPropertyAccessExpression(node) &&
        /(?:^|\.)vault$/.test(node.expression.getText(ast)) &&
        [
          'read',
          'cachedRead',
          'readBinary',
          'modify',
          'modifyBinary',
          'create',
          'createBinary',
          'rename',
          'delete',
          'trash',
          'append',
          'process',
        ].includes(node.name.text)) ||
      (ts.isElementAccessExpression(node) && /(?:^|\.)vault$/.test(node.expression.getText(ast))) ||
      (ts.isBindingElement(node) &&
        ['adapter', 'fsPromises'].includes((node.propertyName ?? node.name).getText(ast))) ||
      (ts.isPropertyAccessExpression(node) &&
        node.name.text === 'promises' &&
        node.expression.getText(ast) === 'fs') ||
      (ts.isCallExpression(node) &&
        node.expression.getText(ast) === 'Reflect.get' &&
        node.arguments.some(
          (arg) => ts.isStringLiteral(arg) && ['adapter', 'fsPromises'].includes(arg.text)
        )) ||
      (ts.isPropertyAccessExpression(node) && ['adapter', 'fsPromises'].includes(node.name.text)) ||
      (ts.isElementAccessExpression(node) &&
        ts.isStringLiteral(node.argumentExpression) &&
        ['adapter', 'fsPromises'].includes(node.argumentExpression.text)) ||
      (ts.isStringLiteral(node) && /^(?:node:)?fs(?:\/promises)?$/.test(node.text))
    )
      found.push(node.getText(ast))
    ts.forEachChild(node, walk)
  }
  walk(ast)
  return found
}
function enforce(source: string) {
  const found = violations(source)
  if (found.length) throw new Error('Raw sync filesystem access: ' + found.join(', '))
}
it.each([
  'app.vault.adapter.readBinary(path)',
  'const raw = vault["adapter"]',
  'const {adapter: raw} = vault',
  'require("fs")',
  'import {promises} from "node:fs"',
  'disk.fsPromises.open(path)',
  'fs.promises.open(path)',
  'Reflect.get(vault, "adapter")',
  'const key = "adapter"; app.vault[key].readBinary(path)',
  'Reflect.apply(Reflect.get(app.vault, "adapter").readBinary, null, [path])',
  'app.vault.read(file)',
  'Reflect.get(adapter, key)',
  'Reflect.apply(adapter.readBinary, adapter, [path])',
])('rejects deliberately bad filesystem fixture: %s', (source) => {
  expect(() => enforce(source)).toThrow(/Raw sync filesystem access/)
})
// Parses every source file with the TypeScript compiler. That is CPU-bound and grows with the
// tree, so under a busy test machine it outruns the 5 s default; the assertion, not the clock,
// is what guards the boundary.
const SOURCE_WALK_TIMEOUT = 60_000
it('keeps all raw filesystem access inside the guarded module', () => {
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(directory, entry.name))
        : /\.(?:ts|tsx|js|jsx|mjs|vue)$/.test(entry.name)
          ? [join(directory, entry.name)]
          : []
    )
  const found = walk('src')
    .filter((path) => path !== 'src/sync/vaultPathLinks.ts' && !nonSyncFilesystem.has(path))
    .flatMap((path) => violations(readFileSync(path, 'utf8')).map((value) => `${path}: ${value}`))
  expect(found).toEqual([])
}, SOURCE_WALK_TIMEOUT)

it('finds a raw adapter helper imported from outside sync', () => {
  const files = new Map([
    ['src/sync/sample.ts', 'import {disk} from "@/helpers/sampleDisk"; disk(app).readBinary(path)'],
    ['src/helpers/sampleDisk.ts', 'export const disk = app => app.vault["adapter"]'],
  ])
  expect(
    [...files].flatMap(([path, text]) => violations(text).map((value) => `${path}: ${value}`))
  ).toContain('src/helpers/sampleDisk.ts: app.vault["adapter"]')
})

function importedFilesystemHelpers(path: string, source: string, allowlist: ReadonlySet<string>) {
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest)
  return ast.statements.flatMap((node) => {
    if (
      !ts.isImportDeclaration(node) ||
      !ts.isStringLiteral(node.moduleSpecifier) ||
      node.importClause?.isTypeOnly
    )
      return []
    const name = node.moduleSpecifier.text
    const base = name.startsWith('@/')
      ? 'src/' + name.slice(2)
      : name.startsWith('.')
        ? posix.normalize(posix.join(dirname(path), name))
        : name
    return [base, base + '.ts', base + '.vue', base + '/index.ts'].filter((candidate) => {
      if (!allowlist.has(candidate)) return false
      // These existing imports use a pure JSON function and the settings UI app accessor.
      const reviewed =
        path === 'src/sync/ownSettings.ts' && candidate === 'src/services/settingsFile.ts'
          ? ['canonicalJson']
          : path === 'src/sync/tokenSettingsPort.ts' && candidate === 'src/stores/GlobalStore.ts'
            ? ['GlobalStore']
            : []
      const bindings = node.importClause?.namedBindings
      return !(
        bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.every((item) => reviewed.includes((item.propertyName ?? item.name).text))
      )
    })
  })
}
it('rejects imports of explicitly allowlisted raw helpers into sync', () => {
  expect(
    importedFilesystemHelpers(
      'src/sync/sample.ts',
      'import {disk} from "@/helpers/sampleDisk"',
      new Set(['src/helpers/sampleDisk.ts'])
    )
  ).toEqual(['src/helpers/sampleDisk.ts'])
})
it('keeps allowlisted non-sync filesystem helpers out of sync imports', () => {
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(directory, entry.name))
        : entry.name.endsWith('.ts')
          ? [join(directory, entry.name)]
          : []
    )
  expect(
    walk('src/sync').flatMap((path) =>
      importedFilesystemHelpers(path, readFileSync(path, 'utf8'), nonSyncFilesystem)
    )
  ).toEqual([])
}, SOURCE_WALK_TIMEOUT)
