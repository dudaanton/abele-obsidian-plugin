/** Test-only compile-time activation. No runtime setting, URL allowlist or environment override. */
export const TEST_SHARING_MODULE = 'virtual:abele-test-sharing'
const flags = new Map([
  ['/src/sync/sharing/folderSharing.ts', 'OWNER_SHARING_ENABLED'],
  ['/src/sync/publication/fence.ts', 'PUBLICATION_ENABLED'],
])
export function testSharingBuildPlugin(mode) {
  return {
    name: 'abele-test-sharing-build',
    enforce: 'pre',
    resolveId(id) {
      return id === TEST_SHARING_MODULE ? '\0' + id : null
    },
    load(id) {
      if (id !== '\0' + TEST_SHARING_MODULE) return null
      if (mode !== 'sharing-test') throw new Error('Test sharing activation outside its build mode')
      return 'export const testSharingEnabled = true;'
    },
    transform(code, id) {
      const path = id.replaceAll('\\', '/').split('?')[0]
      for (const [suffix, flag] of flags) {
        if (!path.endsWith(suffix)) continue
        const declaration = `export const ${flag} = false`
        if (!code.includes(declaration)) throw new Error('Sharing source flags must remain false')
        if (mode !== 'sharing-test') return null
        return code.replace(
          declaration,
          `import { testSharingEnabled as ${flag} } from '${TEST_SHARING_MODULE}'; export { ${flag} }`
        )
      }
      return null
    },
  }
}
