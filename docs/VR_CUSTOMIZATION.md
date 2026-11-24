# Live customization of the house (desktop and in VR)

One customization document, one live scene, two panels. Whatever you change is applied to the **same loaded 3D house** you are walking through (no second scene,
no rebuild, no reload), and the same saved design opens on the desktop page and in the headset.

## How to use
* **Desktop:** open a house under *VR walk-through* → **Open customization** (above the viewer).
* **In VR (Quest):** press **right A** (or the **CUSTOMIZE** button on the Smart House panel). The panel floats in front of you; if the Smart House panel is also open they sit side by side.
  Point a controller at a button and press the trigger. Left **X** brings the panels back in front of you. Close with the panel's **Close** button or right **A**.
* Tabs: **Interior** (ready-made palettes for the whole house), **Exterior**, **Walls**, **Flooring**, **Ceiling**, **Doors** (doors and window frames), **Furniture**, **Decor** (curtains, rugs), **History** (undo / redo / reset / save / restore / lighting).
* Walls / Flooring / Ceiling edit **one room** (use ◀ ▶ to pick it) or **ALL ROOMS**. Every other tab changes a whole family of objects at once (all interior doors, all sofas, ...).
* Footer: **UNDO, REDO, RESET ALL** (back to the original generated design; itself undoable), **SAVE**, **RESTORE SAVED**.

## What can be changed live
| Area | Choices |
|---|---|
| Walls (per room or all) | 15 paint colours × matte / satin / textured; wall materials: wood panelling, stone cladding, brick, concrete; one **accent wall** per room (any side, colour or material) |
| Flooring (per room or all) | Wood (5), Marble (4), Granite (3), Ceramic (4), Stone (2) × matte / satin / gloss |
| Ceiling (per room or all) | 6 colours × matte / satin |
| Doors and windows | door finishes, window-frame finishes (every door / frame in the house) |
| Furniture | wooden furniture, sofas and chairs, kitchen cabinets, kitchen counter, bathroom tile, taps and fixtures (existing furniture only: nothing is replaced by a primitive) |
| Curtains and decor | curtain finish or **off**, rug tint |
| Exterior | outer wall finish and colour, trim and cornices, railings, gate |
| Palettes | Warm classic, Cool modern, Luxury marble, Earthy terracotta: walls, floors, ceilings of every indoor room + doors, frames, furniture, outer colour in **one** undo step |
| Lighting | Daylight (default) / Evening (View-only; not part of the saved design) |

## How it works (so you can trust what it touches)
* **State** (`src/custom/types.ts`, `store.ts`): a small JSON document keyed by *stable ids* (room key `floor:roomId` - the same key the lights and fans use - and design-studio role keys).
  Nothing points into the scene graph, so it survives a reload, a new VR session and a new model.
* **Role tagging** (`twinThemes.ts`): at build time every material of a family (door, sofa, curtain, outer wall ...) is a private clone tagged `userData.role`. The tag
  survives the `.glb` export as a glTF extra, so the loaded model still knows which meshes belong to which family. **Only tagged meshes change**; a mesh that merely
  *looks* similar keeps its material (this is asserted in the browser test by comparing the material of every mesh before and after).
* **Per-room skins** (`src/custom/skins.ts`, `apply.ts`): a room's paint / floor / ceiling is a thin face laid 3 mm in front of that room's own wall faces (read from the exported model, so
  door and window openings stay open), its floor and its ceiling. The original meshes and materials are never modified, so **reset = remove the skins and put the original materials back**.
* **Navigation is untouched:** the walking grid and collision were built from the original geometry; skins are not part of them (and ignore ray picks).
* **Persistence:** *Save* writes to this browser (`localStorage`) **and** into the project record (`project.data.custom`), so another device or the headset opens the same look.
  A saved design that mentions a room the model does not have (a newly generated house) is pruned and ignored, never an error.

## Known limits (honest)
* **Ceiling shape** (cove light, slats, beams), **stair and roof shapes**, and **furniture models/layout** are part of the generated geometry: changing them needs a rebuild (3D design studio); only their *finishes* are live.
* A house built **without** curtains (or a gate, rugs ...) has nothing to recolour; the panel says "this house has none of these".
* Wood-panel / stone / brick wall materials are procedural textures: they are repeatable surfaces, not photographs.
* Floor and ceiling skins cover the room rectangle; stairs, balconies, terraces, parking and courtyards get no floor/ceiling skin.
* Per-item furniture picking (recolour *this one* chair) is not implemented; furniture is changed by family.
* A plain `.glb` file (not generated from a plan) carries no role tags: the per-room tools work, the family tools do not.
* Tested in headless desktop Chromium and with a mocked WebXR session. **Not tested on a Meta Quest** (see the report for the exact list).
