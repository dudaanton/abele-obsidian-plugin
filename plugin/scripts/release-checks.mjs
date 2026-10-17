export const catalogAssetNames = ['ru', 'lv', 'es', 'de'].map((lang) => `abele-i18n-${lang}.json`)

/** A release.sh tag is the version itself, without a prefix. */
export function checkVersions(tag, manifest, pkg) {
  if (!/^\d+\.\d+\.\d+$/.test(tag) || tag !== manifest.version || tag !== pkg.version) {
    throw new Error('Release tag, manifest.json and package.json versions must match.')
  }
}

export function checkBuild(names, javascript) {
  for (const name of ['main.js', 'main.css']) {
    if (!names.includes(name)) throw new Error(`Missing release asset: ${name}`)
  }
  if (
    names.some(
      (name) => !['main.js', 'main.css', 'styles.css', ...catalogAssetNames].includes(name)
    )
  ) {
    throw new Error('Unexpected build output: release must remain a single JavaScript bundle.')
  }
  for (const marker of ['__abeleTest', 'sourceMappingURL']) {
    if (javascript.includes(marker)) throw new Error(`Development marker in release: ${marker}`)
  }
}
