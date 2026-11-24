// Walkability audit runner: node dev/audit_access.cjs OUT_DIR fixture [fixture ...]   (env BASE=http://127.0.0.1:5173, FROM_SPAWN=1 to start inside the house)
// Needs the Vite dev server (npm run dev) and `NODE_PATH=$(npm root -g)` for playwright. Writes one JSON per layout; tools/access_report.py turns them into the report.
const { chromium } = require('playwright')
const fs = require('fs')
;(async () => {
  const [outDir, ...names] = process.argv.slice(2)
  fs.mkdirSync(outDir, { recursive: true })
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const pg = await b.newPage()
  pg.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 300)))
  await pg.goto((process.env.BASE || 'http://127.0.0.1:5173') + '/dev/vr_load.html')
  await pg.waitForFunction(() => window.__ready, null, { timeout: 60000 })
  for (const name of names) {
    if (fs.existsSync(`${outDir}/${name}.json`)) continue
    await pg.evaluate((n) => window.__load(n), name)
    const r = await pg.evaluate((FS) => {
      const a = window.__access(0.15, FS)
      const h = window.__house
      const pa = h.access ? h.access.plan : null
      return { audit: a, plan: pa ? { cutOff: pa.cutOff, added: pa.added, unresolved: pa.unresolved, through: pa.throughDeadEnd, graphOk: pa.graphOk } : { cutOff: [], added: [], unresolved: [], through: [], graphOk: null }, rooms: h.access ? h.access.rooms : [], repaired: pa ? pa.plan : null, seats: h.seats ? h.seats.length : 0 }
    }, !!process.env.FROM_SPAWN)
    fs.writeFileSync(`${outDir}/${name}.json`, JSON.stringify({ name, ...r }))
    const A = r.audit
    const failed = r.rooms.filter((x) => !x.ok)
    console.log(name.padEnd(26), 'rooms', A.rooms.length, 'unreached', A.unreachable.length, 'noReplay', A.rooms.filter((x) => x.reached && !x.replay).length, 'doorFail', A.doorFailures.length, 'entr', A.entranceToSpawn, 'floors', A.floorsReached.every(Boolean), '| furn-fail', failed.length, 'retried', r.rooms.filter((x) => x.attempts > 1).length, '| doors+', r.plan.added.length, 'through', r.plan.through.length, 'unres', r.plan.unresolved.length)
  }
  await b.close()
})()
