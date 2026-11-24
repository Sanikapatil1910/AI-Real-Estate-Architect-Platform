# Test report — what was actually run

Date of runs: 2026-11-04 … 11-06. Environment: Linux sandbox, Python 3.13, Node, Mono 6.8 (`mcs`), Chromium via Playwright. **No Unity Editor. No Meta Quest.**
Anything not listed under "Executed" was **not** executed.

## A. Acceptance tests from the Smart House brief

| # | Acceptance test | Executed? | Where / result | Limitation |
|---|---|---|---|---|
| 1 | Voice turns a light on | Yes — logic | Mono core + layer tests: spoken phrase → state → light view. PASS | text-to-command only; **no microphone, no speech recogniser, no Unity, no Quest** |
| 2 | Voice turns a light off | Yes — logic | same. PASS | same |
| 3 | Wall switch toggles the same light | Yes — logic | layer tests (switch `Activate` → same `LightBank` entry). PASS | switch placement on real GLB walls verified in the browser (row 9), not in Unity |
| 4 | Voice / switch / panel stay in sync | Yes — logic | layer tests: voice, switch, panel row, ALL ON/OFF, regulator all read one state. PASS | stand-ins, not Unity |
| 5 | Fan level 1 slower than level 2 | Yes — logic | fan model + layer tests at 20/30/60/144 fps. PASS | not seen in a headset |
| 6 | Each level faster than the one below | Yes — logic | same (levels 1…5 strictly increasing). PASS | same |
| 7 | Level 0 stops the fan | Yes — logic | same (smooth deceleration to rest). PASS | same |
| 8 | VR controller operates the controls | **Partly** | simulated controller poses/trigger fed through the same `InputDevices` code path (switch, regulator pad, **panel buttons**). PASS | **simulation is not proof of real controller behaviour**: real aim pitch, haptics and trigger mapping untested. PlayMode tests written, not run |
| 9 | Works with a generated GLB | **Partly** | browser test exports real GLBs (2 plans × 3 styles) and checks the data file against them: floors, ceilings, footprint, every switch lies on a wall face of the GLB. PASS (9/9 in `tests/test_smart_house.py`) | **GLB was not imported into Unity**; glTFast import, mirror axis, scale not verified |
| 10 | Existing generation unaffected | Yes (see C) | only the viewer button was added to existing code; backend/planner files are byte-identical to the original; full suite below | — |

## B. Unity-side logic (Mono, framework-free + UnityEngine stand-ins) — `bash unity-smart-house/tools/mono-tests/run.sh`

* Core suite: **27/27 groups pass on each of 2 real data files** (436 and 424 checks): data parsing, voice grammar (existing phrases + automation/panel phrases), light bank, **master switch**, fan model (exact integration, frame-rate independence), room query/locator, calibration, **panel model, voice-status board, automatic lighting (enter/leave/delay/re-entry/manual hold/remote change/disable/enable/master mode/frame-rate independence), energy model**.
* Unity-layer suite against stand-in `UnityEngine` classes: **200 checks pass, 0 fail** — placement by the binder, switch/regulator/fan views, the controller ray, guards and fallbacks, **control panel (every row button acts on its own room, ALL ON/OFF, fan −/+ with clamping, paging, panel/voice/switch/regulator sync, placement in front of the player, recall, anchor, hide/show by voice, Rebind, config off, master-light fallback), voice status line (Listening / recognized / completed / not understood / mic unavailable / permission request / partial speech), automation in the scene, simulated energy, hand-placed fan prefab auto-bind**.
* Type-check only (compiled against stand-ins, **not run**): Android speech code path, Editor window, **`FanPrefabCreator`**, NUnit/PlayMode test code.
* Mutation check of the new logic: 7 deliberate breakages (no hold after manual off; auto-off ignores the delay; re-entry does not cancel the countdown; energy ignores fans; panel ALL OFF does nothing; board never reports a denied microphone; panel row button acts on the wrong room). **6 were caught.** "Re-entry does not cancel the countdown" survives because the countdown is cancelled a second time in `Tick` (an equivalent mutant, not a test gap). The wrong-room mutant first survived; a test for every row's button was added and it is now caught.

## C. Regression of the existing project (merged tree)

| Check | Result |
|---|---|
| `tsc --noEmit` (frontend) | pass |
| `vite build` | pass |
| Full pytest suite, **every one of the 42 test files run separately on a snapshot of the merged tree** (slow suites and browser `*_render` suites included) | **374 passed, 3 skipped, 0 failed, 4 errors** — all 4 errors were in `test_smart_house.py` (see below) |
| `tests/test_smart_house.py` re-run on the final tree after the fix | **9 passed** |
| Net on the final tree | **378 passed, 3 skipped, 0 failed** |
| Diff of the final tree vs the original project | only add-on files + the viewer button in `TwinViewer.tsx`; no backend / planner / style / Vastu file differs |

The snapshot used for the 42-file run differs from the final tree only in add-on files (Unity package, docs, `dev/project_plan.ts`, patch script), not in anything the other 41 files exercise.

**Skipped (3), by design, unchanged from the original project:** `test_architectural_quality.py:108`, `test_planning_integration.py:109`, `test_vastu_variation.py:5` — each "Exercises the retired legacy placer, which still uses the old y-up convention; superseded by tests/test_architect_engine.py".

**The 4 errors:** the add-on's dev scripts imported `components/twinMassing`, which does not exist in this project copy (it belongs to a later Exterior-Shape version), so the test setup failed to bundle them. Fixed: the scripts now import `dev/project_plan.ts`, which `patches/apply_smart_house.py` points at `twinMassing` when the file exists and makes an identity otherwise. Re-run: 9 passed.

**Important caveat:** the "latest project" ZIP was **not attached**, so all of this ran on the `feasibility_fix` copy. If your real latest project has `twinMassing.ts`, run `patches/apply_smart_house.py` on it and then `tests/test_smart_house.py`; that combination is **untested**.

## D. Not executed (everything needing Unity or a headset)

Unity compile of the package; glTFast import; mirror-axis calibration on a real import; URP shaders/materials; TextMesh sizing and panel readability; controller aim, haptics; the Editor setup window; the fan-prefab creator; PlayMode tests; Android speech on Quest; Meta Voice SDK / Wit.ai; microphone permission prompt; Quest build/install; 72 Hz performance; the debug window (IMGUI). Use the checklist in `QUEST2_BUILD_AND_TEST.md`.
