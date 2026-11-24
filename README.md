## Running it
```
pip install -r backend/requirements.txt
uvicorn backend.main:app --port 8000                      # API (SQLite by default)
cd frontend-react && npm install && npm run dev            # web app on http://localhost:5173 (proxies the API)
```
Environment (all optional; none is ever logged or sent to the browser):

| Variable | Purpose |
|---|---|
| `SECRET_KEY` | Signs login tokens. **Set a long random value in any real deployment** - the built-in default is only a development placeholder. |
| `DATABASE_URL` | Default: a SQLite file under the backend data folder. |
| `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | Enables Gemini for floor-plan reading and the free-text brief. Without it everything still works; plan upload falls back to manual entry. |
| `GEMINI_PLAN_MODEL` | Model for floor-plan reading (default `gemini-3.8-flash`; comma list = fallbacks). `GEMINI_MODEL` does the same for the brief reader. Model names change, so they are configuration, not code. |
| `PLAN_UPLOAD_MAX_MB` | Upload size limit (default 10). |
| `PLAN_IMPORT_PER_HOUR` | Gemini plan readings per user per hour (default 8). |
| `MAX_PROJECTS_PER_USER` | Saved-project cap per account (default 100). |

## Smart House VR on Meta Quest 2 (WebXR, no Unity)
Open the website in the Quest browser (HTTPS needed: `cd frontend-react && npm run quest:cert && npm run quest`), sign in, open **VR walk-through**, pick a saved house, **Enter VR**.
The house is built from its plan, exported to `.glb` in the browser, loaded, and the Smart House panel / wall switches / fans work with the Touch controllers. Guides: `docs/QUEST2_WEBXR_SETUP.md`,
`docs/QUEST2_WEBXR_CONTROLS.md`, `docs/QUEST2_WEBXR_COMPATIBILITY.md` (read this one: it lists what is verified and what still needs a real headset), `docs/VR_REQUIREMENTS_AUDIT.md` (each requirement: implemented / partial / missing, before and after), `docs/VR_TEST_REPORT.md`.
Walking covers every generated staircase; **teleport** (right stick forward, release) and **Sit / Stand Up** (seat discs, panel button, E key on the desktop) are in the walk-through.

## Product pages
`/` landing, `/signup`, `/login`, and the signed-in app under `/app`: dashboard (recent saved projects, preferred style), `/app/create` (requirements -> four concepts), `/app/upload` (floor-plan image -> 3D), `/app/project/:id` (open, restyle, regenerate, rename, export, delete) and `/app/settings`. Signed-out visitors to `/app/*` are sent to `/login` and returned to the page they wanted. The router is a small History-API one in `frontend-react/src/router.tsx`; the dev server and any static host must serve `index.html` for unknown paths.

API: `POST /auth/signup|login`, `GET /auth/me`, `GET|POST /projects`, `GET|PUT|DELETE /projects/{id}` (owner only), `GET /plan-import/status`, `POST /plan-import/analyze|scale|check|build`, plus `/generate`, `/feasibility`, `/parse-brief`, `/critique`.

## Workflow
Two ways in, one 3D pipeline:
1. **Requirements -> concepts -> 3D.** Plot and brief in the form; four explained concepts; shortlist one for its 3D digital twin.
2. **Upload a 2D floor plan -> 3D digital twin** (`/app/upload`, PNG / JPG / JPEG, original quality; PDF is not accepted). Three separate layers:
   - *Reading (untrusted).* The backend sends the image to Gemini (only after the user ticks a consent box, and only if `GEMINI_API_KEY` is set) with a structured-output schema that separates **detected**, **inferred** and **unknown** items. Every returned value is bounded and re-validated; rooms, walls, doors and windows that are not in the drawing are never added. Without a key, or if Gemini fails, the user enters the rooms by hand while looking at the drawing.
   - *Scale and structure (layer A).* Real dimensions come from a measurement the user gives, or from printed dimensions the user explicitly approves as approximate. The result is an editable draft (rooms, doors, windows, in feet) shown on a 2D preview with every uncertainty listed. Nothing is built until the draft passes validation. Optionally, doors the drawing does not show can be added so every room is reachable; they are marked "assumed".
   - *Design (layer B).* The draft becomes a normal plan and goes through the same deterministic 3D builder as generated plans. The design studio (style, palette, materials, interior / exterior options, time of day) changes appearance only and never moves a wall, room, door or window. The model can be downloaded as `.glb` and saved to the dashboard.

Limits stated plainly: a photographed or hand-drawn plan may be read poorly (that is why the review step exists); the scale is only as good as the reference given; the Gemini path could not be exercised against the live service in the test environment (no key), so tests use a mocked client with the real request / response shapes.

## Architectural styles
The application offers exactly three styles, with these exact names: **Modern Minimalistic**, **Traditional Indian** and **Maharashtrian Wada**. Names written by earlier versions (saved projects, old API clients) are mapped, never dropped: "Minimalistic Luxury", "Contemporary Indian" and "Modern Indian" open as Modern Minimalistic; "Traditional Maharashtrian" and "South Indian Traditional" as Traditional Indian; any name containing "wada" as Maharashtrian Wada; anything unknown as Modern Minimalistic (`backend/planner/style_knowledge.canonical_style`, `frontend-react/src/lib/archStyle.ts`, the `GenerateRequest` validator).

A style dresses the validated plan; it never changes it. The planning engine does not read the style, so rooms, walls, doors, windows, stairs and the furniture slots are identical in all three styles (tests compare the structure and furniture hashes, and the generated geometry).

| | Modern Minimalistic | Traditional Indian |
| --- | --- | --- |
| Palettes | the seven existing ones | Rosewood & Ivory, Teak & Gold |
| Furniture | contemporary | carved divan, armchairs, solid coffee table, wooden bed, wardrobe and sideboard, brass lamps (same footprints) |
| Ceilings | the palette's own (flat / cove / slats) | plank ceilings with exposed beams in dry rooms only |
| Doors / windows | flush leaves, plain frames | panelled carved leaves, carved architraves; timber frames, jali transom, louvred shutters |
| Kitchen / bath | palette | wood cabinets with stone counters; earthy tile in bathrooms and wet floors |
| Roof | flat slab + parapet | clay-tile hip roof over the top floor, lean-to tile roofs over every lower roof area, ridge caps, eaves, fascia; a roof terrace stays open and gets a tiled eave round its parapet |
| Entrance | slab canopy | pillared verandah (stone bases, turned timber pillars, balustrade, gabled tile roof), stone cladding strip |
| Plot | standard planting, metal gate | palms and flowering shrubs, clay paving, timber gate between tile-capped pillars |

**Maharashtrian Wada** is a third, separate style (not a re-skin of Traditional Indian): carved timber columns on stone bases, a studded teak entrance door with brass bands, a deep front verandah (otla) with cusped arches and bracket capitals, timber balconies with turned balusters, tiled roofs with deep eaves, coffered timber ceilings, jali windows, a terracotta / cream / ochre / muted-red palette (three themes), stone floors, lanterns and warm light, and gadi-and-bolster seating, chowki stools, a jhula and a peeth (ceremonial seat). A front angan with a tulsi vrindavan and rangoli is added in the plot.

*Courtyard (chowk), honestly:* the planning engine tiles the plot with rectangles and does not create courtyard rooms, so a generated plan has none. Where a plan does contain a `courtyard` room (a room named courtyard in an uploaded plan, or a stored plan JSON such as `frontend-react/dev/fixtures/wada_court.json`) Wada builds a real open court: ringed by carved columns and arches, a ring-shaped tiled roof with an open sky hole, tulsi and rangoli in the court. Where the plan has none, the design studio says so and the 3D shows the front angan instead; it never moves rooms or walls to force a courtyard, because that would change the structure and would need the user's approval and a regeneration. Tests prove that switching to Wada leaves the structure and furniture-footprint hashes identical (`tests/test_styles_render.py`).

The style is chosen in the form, travels with the plan (`plan.architectural_style`) and is the viewer's starting style; the design studio's style cards switch it (palette and overrides reset, so styles never mix). The `.glb` export is the viewer's model: it carries the tile / timber materials and the style name as a node extra. Everything is data in `frontend-react/src/components/twinStyles.ts` (`StyleDef`); the builders read those flags (`twinRoof.ts` roofs, `twinHeritage.ts` furniture) and never test a style name. The style applies to every generated plan, to plans built from an uploaded floor plan (the design studio opens with the saved project's style) and to any stored plan JSON the viewer opens.

## Strict requirement compliance
The brief is a contract. `backend/planner/architect/spec.py` freezes it into an immutable `Spec` (with a fingerprint) before anything is generated; the generator may not change it.

| Rule | How it is enforced |
| --- | --- |
| **Floor count** - Ground = 1, G+1 = exactly 2, G+2 = exactly 3 | No rung of any ladder adds or removes a floor; a terrace never becomes a floor. `FLOORS` violation otherwise. |
| **Room counts** - total and (optionally) per floor | Counts are equalities, not minimums. `MISSING_ROOM`, `EXTRA_ROOM`, `WRONG_FLOOR`. A living room exists once, on the ground floor, unless `floor_rooms` says otherwise. No filler lounge / dining / utility / common bath is ever added. |
| **Terrace** - only when `include_terrace` is true (default false) | It is the roof of the top floor (`plan.terrace`), never a room on an upper floor. A floor that its rooms cannot fill leaves a **flat roof area** (`layout.roof_areas`): not a room, not accessible, not a terrace, no door or graph node. |
| **Sizes** | Bathrooms: at most 80 sq ft, at most 60 % of their bedroom, at most 70 % of the smallest bedroom (`BATH_SIZE`). Kitchen: short side >= 7 ft, >= 63 sq ft (`KITCHEN_SIZE`), 8 x 10 preferred. Rules live in `rules.py` (`BATH_MAX_SHARE_OF_PARENT`, `BATH_MAX_SHARE_OF_SMALLEST_BED`, `_OVERRIDES`). |
| **Kitchen fittings** | The 3D / 2D furnishing places base cabinets, wall units (on a window-free stretch), sink, hob + hood and a fridge, clear of doors; `model.kitchens` reports what was placed. |
| **Chajja** | `facade.apply_chajjas` gives every window of every floor a `chajja` record (same wall, window width + overhang, `chajja_projection_ft` default 1.5, `chajja_thickness_ft` default 0.33). `twinBuild.ts` builds exactly one slab per window above the lintel on the outdoor side; the 2D plan draws the same slab. `CHAJJA` violation if any window lacks one. |
| **Frontage** | The plot form has a required "Frontage" selector (plot width or length). The other dimension is the depth. `plan.site = {frontage, depth, road_side, frontage_selected}` is carried through entrance, parking, windows and regeneration and is never swapped. |
| **Parking** | Exactly the requested bays, in the ground-floor porch on the road side, drawn in 2D and 3D. |

Pipeline (`service.generate`): normalise -> build the spec -> generate -> validate (`verify_plan` + `spec.violations`) -> repair within the same constraints -> re-validate -> return only plans whose ledger is `ok`. Every plan carries `plan.ledger`: per-type totals, per-floor counts, one row per room (type, id, floor, width, length, area, connections, geometry validity, required / actual count, satisfies) and the violations.

If the plot genuinely cannot hold the brief, `/generate` answers **422** with `status: "conflict"` and the precise conflicting constraints; nothing is returned as a success. With `closest_if_infeasible` the response is `status: "closest_alternative"` - labelled, never `ok`. "Let the planner adjust my brief" (strict = false) may drop optional rooms or shrink rooms, never floors, and lists every change.

## Feasibility: valid, impossible, or not found
`/generate` never reports a valid brief as impossible because one randomised search was unlucky, and it never blames the parking unless the numbers do.
- **Static analysis** (`feasibility.py`, `diagnostics.py`): the buildable footprint after setbacks (and the garden strip), the area each floor needs against that one shared footprint (floors are never added together as ground area), the parking porch against the frontage and depth, the stair. Only this can say **infeasible**.
- **Staged search** (`service._generate_strict`, `_STAGES`): every layout rule at comfortable sizes -> comfortable sizes without the long-passage cap (3 seeds) -> rooms up to 8 % smaller (2 seeds) -> all bedrooms upstairs / one more downstairs (only when the user did not fix the floor split) -> 15 / 22 / 30 / 38 % smaller. Each attempt is logged (`search.attempt_log`). The floors, room counts, bathroom attached / common split, parking bay (9 x 15 ft) and the stair are never touched. If everything fails the answer is **inconclusive**: "no valid arrangement was found within the search performed", not a proof.
- **Outcomes** (`outcome`): `exact`, `mandatory_only` (preferences changed with approval), `needs_approval` (only a preference blocks the brief), `infeasible`, `inconclusive`, plus `closest_alternative` (labelled, `exact: false`, `deviations` listing everything that differs).
- **Mandatory** (never relaxed): plot boundary and setbacks, floor count, room counts, attached / common bathrooms, minimum dimensions, the parking bay and road entrance, stair and indoor circulation. **Preferences** (only with approval, `ADJUSTABLE` in `diagnostics.py`): garden strip, upper-floor balcony, Strict -> Basic Vastu, cross -> balanced ventilation.
- Endpoints: `POST /diagnose` (constraint report), `POST /adjustments` (proposed preference changes, each with a reason and, by default, verified by a search), `POST /generate` with `approved_adjustments: [ids]` (exactly those changes, nothing else). The 422 conflict carries `verdict`, `outcome` and `diagnostic`. The UI's "Let the planner adjust my brief" shows the proposals as a checklist; nothing is applied until it is approved.
- A courtyard preference is a planning wish only and takes no area from the rooms. The UI's usable area now uses the chosen frontage (50 x 60 with the 60 ft side on the road: 54 x 42 = 2268 sq ft, as the backend).

## Planning modes
1. **Exact brief** - every comfort rule.
2. **Same brief, other layout** - bedrooms upstairs, code-minimum stair, rooms made smaller step by step (never below `rules.HARD_MIN`), wider room shapes, and a corridor layout (`strip.py`) for long shallow plots.
3. **Adjust ON** - one car instead of car + bikes, fewer optional rooms, fewer bathrooms / bedrooms. Never an extra floor.
4. **Adjust OFF (strict)** - nothing is changed; a conflict report (or, on request, the closest alternative) when it cannot be planned.

Every response carries `compliance` (requested vs planned, counted from the plans). The UI shows it with the requirement ledger above the plans, and a conflict panel with "show the closest valid alternative" / "let the planner adjust my brief".

## Generator rules enforced
Every bathroom touches an outer wall (last resort: inside, with a duct shaft, and the plan says so); bedrooms, bathrooms, puja rooms and utility rooms are dead ends (no walking through a bedroom); kitchen-dining-utility stay linked; the living room reaches every public room without crossing a bedroom; setbacks are never reduced.

## Building envelope (stairs, terrace, roof, balcony, windows)
Decided once in the backend (`backend/planner/architect/facade.py`, `doors.py`, `rules.py`) and drawn from those records by the 3D builder (`frontend-react/src/components/twinBuild.ts`, pure helpers in `twinEnvelope.ts`, stair frame in `stairSpec.ts`); the same in every style.
- **Stairs**: handrails only on the open (well) side of each flight; a landing is railed only along the edge that faces the well, never across the walking line; the opening in the floor above is guarded on its open sides only. A top-floor stair climbs to the roof **only when a terrace is selected**.
- **Terrace**: a roof stair ends in an enclosed head-room (mumty) with a real door onto the terrace slab; the parapet (3 ft, one height) runs along every exposed roof edge, never across the door and never when no terrace was selected.
- **Roof**: a flat roof slab projects `roof_overhang_ft` (0.5-3 ft, default 1.5) beyond the wall with a drip fascia, clipped to stay `1 ft` inside the plot; the terrace parapet is separate from the overhang. Traditional / Wada keep their tiled roofs and eaves.
- **Balcony**: an upper-floor balcony may cantilever up to `balcony_projection_ft` (0-4 ft, default 3) beyond the enclosed floor on sides that face open ground, limited to what is left of the setback (2 ft kept to the plot edge), never over the main entrance or a car porch, never overlapping another projection; it gets its own slab and railing. Enclosed rooms always stay inside the usable plot. Uploaded plans never get an invented projection.
- **Windows**: sized by room type and wall (bedrooms / living: wide, a long wall gets a pair; bathrooms: small high ventilators; kitchens / utility above the counter), with wall piers, a clear half-foot beside doors, and on real exterior walls only - including walls that look onto a flat roof below. A long corridor wall gets a row of small windows instead of a blank wall.
- Both options are optional API fields (`roof_overhang_ft`, `balcony_projection_ft`); the UI keeps the defaults, like the chajja size.

## Known limits
`cf_g2` (G+2, 40 x 60, 4 bedrooms + 4 bathrooms, no setbacks) cannot be re-planned within the time budget (also true before these changes); its stored fixture predates the window planner.
Some tight briefs are reported as conflicts rather than squeezed: e.g. 25 x 50 G+1 with 3 bedrooms + 3 bathrooms (buildable 19 x 42 ft) and 30 x 40 G+1 with 3 + 3 and a car. Use a bigger plot, fewer rooms, or "closest alternative".

- Real plans use elongated wet rooms and bedrooms (PLAN - 1.pdf: 10 x 14 bedroom, 4.5 x 8 bath): the engine's wet-room and study shape rules are stricter than that and are unchanged.
- On small plots with a car, 3 BHK G+1 briefs can come back as *inconclusive* after the whole search (for example 42 x 34 ft); it says so and offers the closest alternative.

## Tests
`python -m pytest tests -q` runs the backend suite (the render tests drive a local Vite dev server through Playwright; fixtures: `python -m tests.gen_fixtures`).
- `tests/test_feasibility_search.py` - tests A-J of the feasibility fix (the 50 x 60 G+1 brief and other seeds, parking positions, floor allocation, compact plot, proven vs inconclusive vs needs-approval outcomes, approval flow, road orientation, PLAN - 1 reference fixture `tests/fixtures/plan1_reference.json`, regressions, geometric checks on every returned candidate).
- `tests/test_strict_compliance.py` - tests A-E, G-L of the compliance brief (counts, floors, frontage 50 / 60, per-floor counts, sizes, terrace on / off, parking, combination, chajja data, legacy OCR / vision upload stack stays removed) plus "an infeasible brief is not marked successful".
- `tests/test_strict_render.py` - chajja meshes in 3D and 2D, kitchen fittings, roof areas, floors, terrace and frontage in the stored plans.
- `tests/test_architectural_styles.py` - exactly two styles, legacy-name mapping, schema / parser, identical plan geometry for both styles, selector sources.
- `tests/test_styles_render.py` - both styles in a browser on a G+2 house and a terrace house: picker, structure / furniture hashes, tiled roofs, repeated switching leaves no mixed materials, `.glb` matches the viewer.
- `tests/test_plan_import.py` - upload validation (type, size, spoofed files), Gemini client (request shape, key in header only, retry, rate limit, bad output, blocked, no key), reading clean-up of untrusted values, scale rules, draft validation, deterministic build, never-invent guarantees, endpoints and rate limit.
- `tests/test_projects_api.py` - saved projects: owner-only access, validation, limits, summaries, auth flow.
- `tests/test_platform_e2e.py` - browser tests of the product shell (starts `tests/e2e_server.py`, a real backend on a throw-away DB with Gemini mocked): landing, signup / login / logout and error messages, protected-route redirect, dashboard empty state, upload -> review -> 3D -> `.glb` -> save, bad files, manual mode, generate -> save -> reopen -> restyle -> rename -> delete, cross-user isolation, and 390 / 820 / 1366 px layouts with no horizontal scroll and a usable 3D viewer; plus a static audit that every button has a handler and every link targets a real route.
- `tests/test_stair_geometry.py` / `tests/test_envelope_geometry.py` - pure geometry audits (esbuild + node): every stair shape (continuous climb, no rail across the walking path, guarded openings) and the roof helpers (overhang strips disjoint, fascia, parapet never in front of the head-room door).
- `tests/test_envelope_quality.py` - window rules, roof overhang and balcony projection limits, terrace flag, upload plans, plan sizes / floor counts, on the stored plans.
- `tests/test_envelope_render.py` - 3D in a browser, 6 plans x 3 styles: terrace door + parapet, no terrace = nothing on the roof, overhang inside the plot, balcony slabs / railings, identical structure in every style.
- Frontend: `cd frontend-react && npx tsc --noEmit && npm run build`.
