/**
 * HyperFormula carries a catalogue of human-readable descriptions for every built-in function
 * (`FUNCTION_DOCS`, about 170 KB minified). Only its `getFunctionList`/`getFunctionDetails` API
 * reads it, and the plugin never calls that API; formulas evaluate without it. Ship the module
 * with an empty catalogue instead, which HyperFormula already handles as "no authored entry".
 * Fails the build if the module is not where this expects it, rather than silently shipping it.
 */
const catalogue = '/hyperformula/es/interpreter/functionMetadata/index.mjs'
const expectedExport = 'export const FUNCTION_DOCS = '

export const emptyCatalogue = `export * from "./FunctionDescription.mjs";
export const FUNCTION_DOCS = Object.create(null);
`

export function isHyperFormulaCatalogue(id) {
  return id.split('?')[0].endsWith(catalogue)
}

export function hyperFormulaCataloguePlugin() {
  let usesHyperFormula = false
  let replaced = false
  return {
    name: 'abele-hyperformula-catalogue',
    enforce: 'pre',
    buildStart() {
      usesHyperFormula = false
      replaced = false
    },
    transform(code, id) {
      if (id.includes('/node_modules/hyperformula/')) usesHyperFormula = true
      if (!isHyperFormulaCatalogue(id)) return null
      if (!code.includes(expectedExport))
        throw new Error('HyperFormula function catalogue changed shape; review the empty stand-in')
      replaced = true
      return { code: emptyCatalogue, map: null }
    },
    buildEnd(error) {
      if (!error && usesHyperFormula && !replaced)
        throw new Error('HyperFormula function catalogue not found; it would ship in full')
    },
  }
}
