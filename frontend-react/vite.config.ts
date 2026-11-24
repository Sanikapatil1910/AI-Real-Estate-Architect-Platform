import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

/**
 * Meta Quest Browser only exposes WebXR on HTTPS pages, and the headset reaches this computer over the local network.  `npm run quest` (dev) and
 * `npm run quest:preview` (production build) therefore turn on QUEST=1: listen on every network interface and serve HTTPS with a self-signed certificate
 * made by `npm run quest:cert` (scripts/make-dev-cert.mjs).  Plain `npm run dev` is unchanged (localhost, HTTP).
 */
const quest = process.env.QUEST === '1'
const certDir = path.resolve(__dirname, '.certs')
const https = quest && fs.existsSync(path.join(certDir, 'dev.key')) && fs.existsSync(path.join(certDir, 'dev.crt'))
  ? { key: fs.readFileSync(path.join(certDir, 'dev.key')), cert: fs.readFileSync(path.join(certDir, 'dev.crt')) }
  : undefined
if (quest && !https) console.warn('\n[quest] No certificate found in frontend-react/.certs - run `npm run quest:cert` first, otherwise the Quest browser will refuse WebXR (it needs https).\n')

/**
 * Host names the dev / preview server answers to.  A Cloudflare Quick Tunnel (cloudflared tunnel --url http://localhost:5173) gives a random *.trycloudflare.com name
 * on every start, so the whole suffix is allowed rather than one name.  Add other names with ALLOWED_HOSTS=name1,name2 (comma separated).  Nothing here exposes the
 * backend: it is only reachable through the proxy table below, which is the same set of paths as before.
 */
const allowedHosts = ['.trycloudflare.com', 'localhost', '127.0.0.1', ...(process.env.ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean)]

const API = process.env.API_TARGET || 'http://localhost:8000'
const proxy = {
  '/generate': API,
  '/auth': API,
  '/health': API,
  '/feasibility': API,
  '/parse-brief': API,
  '/critique': API,
  '/projects': API,
  '/plan-import': API,
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    ...(quest ? { host: true, https } : {}),
    allowedHosts,
    proxy,
  },
  preview: {
    port: 4173,
    ...(quest ? { host: true, https } : {}),
    allowedHosts,
    proxy,
  },
})
