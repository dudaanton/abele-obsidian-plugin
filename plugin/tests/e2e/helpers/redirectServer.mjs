// Two origins with controlled redirects. Only invented credentials, never logged.
import { createServer } from 'node:http'
const seen = []
const sink = createServer((req, res) => {
  seen.push({
    destination: 'other-origin',
    path: req.url,
    authenticated: !!req.headers.authorization,
  })
  res.end(JSON.stringify({ ok: true }))
})
sink.listen(0, '127.0.0.1', () => {
  const other = `http://127.0.0.1:${sink.address().port}`
  const server = createServer((req, res) => {
    if (req.url === '/seen') {
      res.end(JSON.stringify(seen))
      return
    }
    seen.push({
      destination: 'original',
      path: req.url,
      authenticated: !!req.headers.authorization,
    })
    if (req.url === '/same-origin' || req.url === '/api/v3/same-origin') {
      res.writeHead(302, { Location: '/landed' })
      res.end()
    } else if (req.url === '/other-origin' || req.url === '/api/v3/other-origin') {
      res.writeHead(302, { Location: `${other}/landed` })
      res.end()
    } else if (req.url === '/other-host' || req.url === '/api/v3/other-host') {
      res.writeHead(302, { Location: `http://localhost:${sink.address().port}/landed` })
      res.end()
    } else {
      res.end(JSON.stringify({ ok: true }))
    }
  })
  server.listen(0, '127.0.0.1', () =>
    console.log(`listening ${server.address().port} ${sink.address().port}`)
  )
})
