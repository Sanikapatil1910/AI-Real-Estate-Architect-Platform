// `npm run quest` (dev server) / `npm run quest -- preview` (serves the production build): HTTPS + reachable from the headset. See vite.config.ts.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cmd = process.argv[2] === 'preview' ? ['preview'] : []
const bin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite')
spawn(bin, cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, QUEST: '1' }, shell: process.platform === 'win32' }).on('exit', (c) => process.exit(c ?? 0))
