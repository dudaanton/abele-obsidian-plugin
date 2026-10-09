import type { RepositoryLocation, RepositorySource } from './source'

/** Explicit locations avoid guessing the split between a slash-containing ref and a file path. */
export function loadRepositoryLocation(source: RepositorySource, location: RepositoryLocation) {
  source.assertCurrent()
  switch (location.kind) {
    case 'home':
      return source.home(location.ref)
    case 'file':
      return source.blob(location.ref, location.path, location.contentId)
    case 'folder':
      return source.folder(location.ref, location.path)
    case 'commit':
      return source.commit(location.commit)
    case 'comparison':
      return source.compare(location.base, location.head, location.direct, location.mode)
  }
}
