import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Stop the companion when a managed service exits. */
export function supervise(children, finish) {
  let stopped = false
  const stop = (code = 0) => {
    if (stopped) return
    stopped = true
    for (const child of children) child.kill('SIGTERM')
    finish(code)
  }
  for (const child of children) {
    child.once('error', (error) => { console.error(error.message); stop(1) })
    child.once('exit', (code, signal) => stop(code ?? (signal ? 1 : 0)))
  }
  return stop
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url))
  let apiRunning = false
  try {
    const response = await fetch('http://127.0.0.1:3001/health', { signal: AbortSignal.timeout(1000) })
    const health = response.ok && await response.json()
    apiRunning = health.status === 'ok' && health.schemaVersion === 1
  } catch { /* No healthy API: start our own. */ }
  const children = []
  if (!apiRunning) {
    children.push(spawn(process.execPath, ['--env-file-if-exists=../.env', 'src/index.ts'], { cwd: `${root}server`, stdio: 'inherit' }))
  } else console.log('Using the API already running on port 3001.')
  children.push(spawn(process.execPath, [`${root}node_modules/vite/bin/vite.js`, '--port', '5173', '--strictPort'], { cwd: `${root}web`, stdio: 'inherit' }))
  const stop = supervise(children, (code) => { process.exitCode = code })
  process.once('SIGINT', () => stop())
  process.once('SIGTERM', () => stop())
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
