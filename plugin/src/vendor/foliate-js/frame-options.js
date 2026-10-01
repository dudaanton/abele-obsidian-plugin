// ABELE PATCH (new file): the sandbox of every book frame, set by the host per platform before a
// book is opened. Abele drops `allow-scripts` wherever the engine allows it; see README.md.
// Fail closed until the host explicitly chooses the platform's sandbox.
export const frameOptions = { sandbox: 'allow-same-origin' }
