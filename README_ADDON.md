# Smart House VR add-on (merged into this project)

> **Update — Meta Quest 2 now works straight from the website (WebXR), no Unity.** Generate a house → open the site in the Quest browser → *VR walk-through* → *Enter VR*.
> Guides: `docs/QUEST2_WEBXR_SETUP.md`, `docs/QUEST2_WEBXR_CONTROLS.md`, `docs/QUEST2_WEBXR_COMPATIBILITY.md` (what is and is not verified), `docs/VR_TEST_REPORT.md`.
> Code: `frontend-react/src/vr/`, pages `src/pages/VrHomes.tsx` and `VrViewer.tsx`. Not yet run on a real Quest 2.
> Also in the walk-through: walkable staircases (every generated flight), comfortable **teleport** (right stick forward / hold **T**), **Sit / Stand Up** on sofas, chairs, beds, benches and stools (trigger on a seat disc / **E**). Audit and results: `docs/VR_REQUIREMENTS_AUDIT.md`, `docs/VR_TEST_REPORT.md`.
> The Unity package below is **optional / legacy** and is not required for anything in the WebXR path; it was kept so nothing was removed.

This project ZIP already contains the add-on. Entry points:

| What | Where |
|---|---|
| Unity package + guides + tests | `unity-smart-house/` (start with `unity-smart-house/docs/UNITY_SETUP_GUIDE.md`, then `QUEST2_BUILD_AND_TEST.md`) |
| Data-file generator (web app) | `frontend-react/src/lib/smartHouse.ts`; button **Smart-house data (.json)** next to *Download 3D model (.glb)* in `components/TwinViewer.tsx` |
| Generator checks | `frontend-react/dev/check_smart_house.ts`, `emit_smart_house.ts`; `tests/test_smart_house.py` |
| Re-merge into another copy of the project | `patches/apply_smart_house.py` (idempotent; see below) |

Floor-plan generation, Vastu, styles and room counts are not touched. The only edit to an existing file is the viewer button
(2 imports + 1 button in `TwinViewer.tsx`).

## Re-applying the add-on to a newer copy of the project
```
python3 patches/apply_smart_house.py <path-to-this-addon-folder> <path-to-project-root>
cd <project-root>/frontend-react && npx tsc --noEmit
python -m pytest tests/test_smart_house.py
```
The script copies the add-on files and patches `TwinViewer.tsx` if it has not been patched. If the project has `components/twinMassing.ts`
(Exterior Shape work) the button passes its `projectPlan`, so the data file follows the projected massing; otherwise it uses the plan as is.
It stops with a message if the two anchor lines in `TwinViewer.tsx` are not found (then add the button by hand — see `patches/TwinViewer_smart_house.patch`).

## Honest status
See `unity-smart-house/docs/TEST_REPORT.md` for exactly what was run. In short: logic and data generation are tested; **nothing has been run inside Unity or on a Quest.**
