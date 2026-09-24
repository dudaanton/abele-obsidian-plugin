// ABELE PATCH (new file): the sandbox of every book frame, set by the host per platform before a
// book is opened. Abele drops `allow-scripts` wherever the engine allows it; see README.md.
export const frameOptions = { sandbox: 'allow-same-origin allow-scripts' }
