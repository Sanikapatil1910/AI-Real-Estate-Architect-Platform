// Makes a self-signed HTTPS certificate for this computer's LAN address so the Meta Quest Browser can open the site (WebXR needs https).
// Usage: npm run quest:cert            (uses openssl; run once, valid 1 year)
import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '.certs')
mkdirSync(dir, { recursive: true })
const ips = Object.values(networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address)
const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((i) => `IP:${i}`)].join(',')
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365', '-keyout', join(dir, 'dev.key'), '-out', join(dir, 'dev.crt'), '-subj', '/CN=ai-architect-dev', '-addext', `subjectAltName=${san}`], { stdio: 'inherit' })
} catch (e) {
  console.error('\nCould not run openssl. Install it (Git for Windows ships one; macOS/Linux have it) or use a tunnel instead (see docs/QUEST2_WEBXR_SETUP.md).')
  process.exit(1)
}
console.log(`\nCertificate written to ${dir}\nValid for: ${san}\nNow run:  npm run quest   (then open https://<one of these addresses>:5173 on the Quest)`)
console.log('Addresses of this computer:', ips.length ? ips.map((i) => `https://${i}:5173`).join('  ') : '(none found - are you on a network?)')
