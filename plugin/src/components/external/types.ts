/**
 * A file kept on the sync server only, as its stub on this device describes it: enough to name it
 * and say what it is, nothing to fetch it with.
 */
export interface ExternalFile {
  /** The file's name, without the stub's own extension. */
  name: string
  mime: string
  size: number
  width?: number
  height?: number
  /** Seconds, for sound and video. */
  duration?: number
  /** When the server took this version, already said for people ("12 October"). */
  since: string
  /** A small picture kept on the device, for an image; shown while offline too. */
  preview?: string
}

/**
 * remote: on the server only; downloading: on its way here; offline: no link to the server;
 * changed: the server has a newer version than the stub says; failed: the last download failed.
 */
export type ExternalState = 'remote' | 'downloading' | 'offline' | 'changed' | 'failed'

export interface ExternalProgress {
  done: number
  total: number
}
