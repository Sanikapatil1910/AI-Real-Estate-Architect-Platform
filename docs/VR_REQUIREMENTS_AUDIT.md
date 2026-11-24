# Smart House WebXR — requirements audit (original requirement vs the actual implementation)

Scope of this review: compare the original requirement with the code that was actually there, then implement **only** the missing or incomplete parts.
Not rebuilt, not removed, not touched: the WebXR engine, panel, wall plates, fans, lights, energy model, the floor-plan generator, the 2D/3D viewer, Go G / Go 1F / GO.
Nothing here was run on a Meta Quest 2 (see the three-way separation in section 3).

## 1. Status table — before this work and after

| # | Requirement | Before | Evidence found in the code | After (this work) |
|---|---|---|---|---|
| 1a | Headset floor-level tracking, realistic eye height | **Implemented** | `local-floor` reference space requested (`bounded-floor` optional); fallback `local` + fixed 1.62 m eye height (`VrEngine.enterVR`, `eyeOffset`); the view height in VR is the headset's own tracked height | unchanged |
| 1b | Smooth controller movement | **Implemented** | left stick walk at 1.5 m/s relative to the view, right stick 30° snap-turn; head movement in the play space is followed through the collision grid | unchanged |
| 1c | Wall / floor collisions | **Implemented** | walking grid built from the exported triangles (0.3 ft cells), walls, furniture and floor edges stop the stick movement | body radius trimmed 0.4 → 0.3 ft so narrow bathroom doors are passable |
| 1d | Ceiling collisions | **Partial (by design)** | the grid deliberately ignores undersides: head room is the person's own head position | unchanged for walking (a ceiling must not stop a thumbstick walk); **teleport arcs are stopped by ceilings and slab undersides** |
| 1e | Staircase collisions / walking up and down | **Partial** | first flights walkable; upper flights sealed by the generator's guard rails/posts at the foot of the flight | **Implemented**: every flight of every generated stair shape is walkable (generator tread/landing surfaces) |
| 2 | Physical stair + upper-floor navigation; bathrooms on foot; Go G / Go 1F / GO kept | **Partial** | `g2_0` 17/24 rooms, `sc_g2` 13/18 reachable on foot | **Implemented and audited on 89 layouts** (21 stored samples, 16 + 52 freshly generated): every room, every floor and every plan door reached on foot from OUTSIDE the front door, 89 / 89 layouts, 0 unreachable rooms (before: 29 / 89, 148 rooms unreachable from the start point). See `docs/VR_ACCESSIBILITY_REPORT.md`; Go buttons kept |
| 2b | No room may stay inaccessible in a generated plan (doors, furniture, walk paths, connectivity validated after furniture placement, automatic repair, clear failure otherwise) | **Missing** | rooms sealed by furniture beside an open door leaf, closed front gate, doorless rooms in uploaded plans | **Implemented**: post-placement clearance validator + corridor-reserving retry (`twinAccess.ts`, `twinInterior.ts`), door-leaf hinge rule, open front gate / pedestrian opening in the walking model, plan-level assumed doors where a room has none (`planAccess.ts`, reported, stored plan unchanged), strict audit on the real collision grid (`access.ts`), notice in the VR page. Collisions of walls and furniture are NOT disabled. Remaining limits: `docs/VR_ACCESSIBILITY_REPORT.md` |
| 3 | Teleportation, including upper floors | **Missing** (only the Go buttons) | no arc / pointer code | **Implemented**: right stick forward + release, arc + marker, blink; desktop: hold T; upper floors via stairs / landings / stairwell line of sight |
| 4 | Sit / Stand Up on sofas, dining chairs, beds, from furniture geometry; works on new houses | **Missing** | no seat data anywhere | **Implemented**: seats recorded by the furniture builder (so any new house), height read from the mesh; trigger on seat disc / panel SIT NEAREST / E key; Stand Up by stick, panel, E, teleport |
| 5a | Lights, fans, fan speed 0–5, automatic lighting, manual override, energy panel, controller interactions | **Implemented** | see `docs/VR_TEST_REPORT.md` | unchanged |
| 5b | Fan blades visibly rotate at different speeds | **Implemented** | blade group speed 0 / 90 / 140 / 190 / 240 / 300 rpm | re-measured on scene objects in the final run |
| 5c | Bedroom and staircase motion-sensor lighting reliable | **Partial** | tested for two rooms only; on the flight up to the terrace the occupancy sensor point sat above every room ceiling, so the staircase light would switch off mid-climb | **Fixed + tested on every bedroom and every tread** |
| 5d | All controls synchronized | **Partial** | each route tested separately | **Cross-route sync test** (panel / typed command / wall switch / wall regulator → state, panel rows, blade speed, energy, summaries) |
| 6 | Voice: ≤ 1–2 days; if unreliable or paid, leave disabled, keep manual controls | **Implemented as asked** | Web Speech API only when the browser has it, otherwise "Microphone unavailable" and every manual control works; no paid service | unchanged (no time spent; not verified on a Quest) |
| 7 | Tests on multiple generated layouts; desktop vs simulated WebXR vs real Quest separated; no Quest claim | **Partial** | browser tests on 2 houses | 8 houses in the browser suite (3 old + 5 freshly generated), node audits on 89 plans; separation kept (section 3) |

## 2. What changed (files)

* Stairs: `src/components/stairWalk.ts` (new; pure model), edits in `twinDoorsStairs.ts` / `twinBuild.ts` (register the walk surfaces the generator already computes; nothing drawn differently), `src/vr/navGrid.ts` (walk patches, stair-zone exemption, body radius), `src/vr/houseLoader.ts`.
* Teleport: `src/vr/teleport.ts` (new; pure arc), `navGrid.ts` (undersides recorded for arcs only: `blockedBetween`, `surfaceBetween`), `VrEngine.ts` (aim, arc line, marker, blink, VR stick, desktop T).
* Sitting: `src/components/seatRegistry.ts` (new), seat hooks in `twinInterior.ts` (`Frame.seat`, chairs, sofa cushions, bed, bench, stools), `src/vr/seats.ts` (new; height from mesh, stand spot, nearest seat), `houseLoader.ts`, `VrEngine.ts` (seat discs, sit/stand, seated eye height), `smart/panel.ts` (SIT NEAREST / STAND UP button).
* Motion lighting: `VrEngine.occupantY()` (staircase occupancy on the terrace flight).
* Tests/tools: `dev/check_stairwalk.ts`, `check_teleport.ts`, `check_seats.ts`, additions to `check_nav.ts`, `dev/vr_load.ts` (audit hooks), `dev/e2e_vr.cjs` (new browser checks), `tests/test_vr_webxr.py`.
* Walkability (no inaccessible rooms): `src/components/twinAccess.ts` (new; pure clearance check + corridor strips), `twinInterior.ts` (`furnishRoom` validate / retry loop, access log), `twinFloor.ts` + `twinDoorsStairs.ts` (shared hinge rule `hingeAtEndA`, leaves kept clear), `twinBuild.ts` (walkable model: open gate, pedestrian opening in the compound wall at a main door that is not on the road side), `src/vr/access.ts` (new; strict audit), `src/vr/planAccess.ts` (new; assumed-door repair), `houseLoader.ts` (repair + floor-level start point), `src/pages/VrViewer.tsx` (notice), `dev/check_access.ts`, `tools/access_report.py`.
* Docs: this file, `VR_TEST_REPORT.md`, `QUEST2_WEBXR_CONTROLS.md`, `…_COMPATIBILITY.md`, `…_SETUP.md`, READMEs.
* New fresh-house fixtures: `frontend-react/dev/fixtures/fresh_*.json` (16 plans generated by the backend `/generate`, 1–3 floors, Modern / Traditional / Wada).

## 3. Test layers (kept apart)

| Layer | What it is | What it can prove |
|---|---|---|
| **Desktop** (executed) | real backend + real website pages in headless Chromium (software GL), real keyboard / mouse events; node-only unit checks | our code and the generated houses behave as described on a desktop browser |
| **Simulated WebXR** (labelled MOCK) | fake `navigator.xr` / session, injected thumbstick and trigger values, posed controller objects | our input handling reacts correctly to the values a Quest *should* report |
| **Actual Meta Quest 2** | — | **not tested**: no headset available. No claim of Quest compatibility, frame rate (72/90 Hz), comfort or controller mapping is made |
