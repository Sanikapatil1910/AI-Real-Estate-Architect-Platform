/**
 * Command-line writer of the smart-house sidecar from a stored plan JSON (the same function the "Smart-house data" button of the 3D viewer calls):
 *
 *   npx esbuild dev/emit_smart_house.ts --bundle --platform=node --format=cjs --outfile=/tmp/emit_smart_house.cjs
 *   node /tmp/emit_smart_house.cjs plan.json > house-1.smarthouse.json
 */
import { buildSmartHouse } from '../src/lib/smartHouse'
import { projectPlan } from './project_plan'
import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) { console.error('usage: emit_smart_house <plan.json>'); process.exit(2) }
let plan = JSON.parse(readFileSync(file, 'utf8'))
plan = plan.plan ?? plan
console.log(JSON.stringify(buildSmartHouse(plan, projectPlan), null, 1))
