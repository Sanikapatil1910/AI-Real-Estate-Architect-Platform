# Changes in this phase (integration, control panel, automation, energy)

Base: the `RealEstate_feasibility_fix` project tree (the "latest" project ZIP was not attached to the request) + the earlier add-on (`RealEstate_smart_house_addon.zip`, 90 entries / 63 files).
The pristine base was kept untouched as a backup before anything was merged.

## Integration
* Merged the add-on into the project with `patches/apply_smart_house.py` (idempotent, copies add-on files, patches `TwinViewer.tsx`).
  The only existing file edited: `frontend-react/src/components/TwinViewer.tsx` (2 imports + the **Smart-house data (.json)** button). Backend, planner, styles, Vastu: no changes.
* The old patch imported `./twinMassing`, which does not exist in this tree; the script now detects that and uses the plan as is (it passes `projectPlan` only when `twinMassing.ts` exists).

## New in the Unity package (0.1.0 → 0.2.0)
| Area | Files | Summary |
|---|---|---|
| Master switch | `Core/LightBank.cs` (`SetAll`, `ControlSource.Auto`), `Core/SmartHouseState.cs` (`SetAllLights`) | one call turns every light on/off, raising the same events as a single switch |
| Control panel | `SmartControlPanel.cs` (+`PanelButton`), `Core/PanelModel.cs` | in-house panel: master ON/OFF, per-room light and fan −/+, AUTO LIGHTS, paging, voice status, energy; all values from the shared state |
| Voice status | `Core/VoiceStatusBoard.cs`, controller wiring | Listening → Command recognized → Action completed / not understood / no target / microphone unavailable / permission request / voice off |
| Voice grammar | `Core/VoiceCommandParser.cs` | `turn on/off automatic lighting`, `show/hide the control panel` (existing light/fan phrases untouched; `IsFan` made explicit so new kinds are not mistaken for fan commands) |
| Motion sensor | `Core/AutoLighting.cs`, `SetSimulatedOccupant`, config, debug window | optional, off by default; enter → on, leave + delay → off, manual override, simulated occupant |
| Energy | `Core/EnergyModel.cs`, config `energy` | simulated watts (documented assumptions) and session Wh; labelled "Simulated" everywhere |
| Fan prefab | `Editor/FanPrefabCreator.cs`, `CeilingFanView.autoBind` | editor menu that saves a real prefab (with its generated meshes/materials as assets); prefab follows the state by `roomKey` |
| Config | `SmartHouseConfig.cs` | `showControlPanel`, `showEnergy`, `autoLightsOnStart`, `autoVacancySeconds`, `energy` |
| Controller | `SmartHouseController.cs` | `VoiceStatus`, `Panel`, `panelAnchor`, `SetSimulatedOccupant`, backend-state and partial-transcript hooks |
| Debug window | `SmartDebugConsole.cs` | auto-lights toggle, simulated occupant, energy line |
| Docs | `README.md`, `docs/*` | setup guide, Quest build/test guide, extension audit, test report, this list |
| Tests | `Tests/Editor/CoreTests.Automation.cs`, `tools/mono-tests/UnityLayerTests.cs`, `Tests/PlayMode/…` | see `TEST_REPORT.md` |

## Bugs found and fixed while doing this
* **Toast backdrop could not be seen:** `VoiceFeedbackToast` rotated its background quad 180° about Y, so a Unity Quad (visible from its −Z side) faced away from the viewer and would have been culled. Rotation removed. (Found by reasoning about Unity's quad facing; **not** observed in a headset.)
* **README claimed a "Create Prefab" step that did not exist.** Replaced by the real editor menu item above, with the reason (generated meshes are lost if a prefab is saved from a running scene).
* **Panel layout overlap:** rendering the panel's real coordinates showed the 6th room row overlapped the page buttons and the right-hand buttons touched the panel edge. Panel enlarged to 0.68 × 0.745 m and spacing corrected (checked again in the preview image; still not seen in a headset).
* Test-harness stand-ins were missing a few UnityEngine members (enums, `IsChildOf`, `GetTexture`, `DestroyImmediate`); added. These are test doubles, not package code.
* The "no duplicate listeners" test now expects the two listeners that are new by design (automation model, control panel) instead of the old exact count.

## Behaviour decisions worth knowing
* Recall key for the panel is the left **Y** button (X is left free for `VoicePushToTalk`).
* Manual ON in the room you are in is still switched off by the sensor after you leave and the delay passes (vacancy enforcement); manual OFF while present is held. Documented in README §7b.
* Energy uses the *selected* fan level for power, not the instantaneous blade speed.
* The panel shows 6 rooms per page; a house with 18 rooms has 3 pages.
