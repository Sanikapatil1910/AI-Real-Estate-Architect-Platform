# Smart House VR — voice lights, wall switches, five-speed ceiling fan

A Unity package (`Packages/com.realestate.smarthouse`) for the Meta Quest demo of the houses this platform generates.
It adds **voice-controlled room lights**, **wall switches**, a **master ON/OFF**, a **five-speed ceiling fan** with a **wall regulator**, an in-house
**control panel**, an optional **motion-sensor (automatic) lighting** simulation and an optional **simulated energy** read-out, driven by a small data
file (`house-N.smarthouse.json`) that the web app writes next to the exported `.glb`.

Guides: [`docs/UNITY_SETUP_GUIDE.md`](docs/UNITY_SETUP_GUIDE.md) (step by step) · [`docs/QUEST2_BUILD_AND_TEST.md`](docs/QUEST2_BUILD_AND_TEST.md) (build, install, headset checklist) ·
[`docs/FUTURE_EXTENSIONS.md`](docs/FUTURE_EXTENSIONS.md) · [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md) (what was actually run) · [`docs/CHANGES.md`](docs/CHANGES.md)

> **Status, plainly.** The package's logic is tested (see *Tests*), and the data file is checked against real exported `.glb` files in a browser.
> **Nothing has been run inside Unity or on a Quest.** The Unity-specific parts (shaders, `TextMesh` sizing, controller poses, the Android speech
> service, glTFast import) are written from the documented APIs and are unverified until you run the headset checklist at the end.
> Voice on Quest in particular is **not confirmed to work** — see *Voice*.

The floor-plan generator, Vastu rules, styles (Modern, Traditional, Wada) and room counts are untouched: the data file is computed *from* the plan,
it never changes it.

---------------------------------------------------------------------------------------------------------------------------------------------------

## 1. What the audit found (read before trusting any "automatic" step)

The project had **no Unity project at all**: it is FastAPI + React/Vite/three.js. The `.glb` is produced **in the browser** (`TwinViewer.tsx`, button
*Download 3D model (.glb)*, via three.js `GLTFExporter`). Inspecting real exports:

| Question | Finding | Consequence |
|---|---|---|
| Units / axes | feet; x = plan x, y = up, z = plan y; floor *n* at y = n × wall height | scale 0.3048 and a mirror axis are needed in Unity |
| Node names | 699 of 700 nodes unnamed; only the root has `extras` (style, palette) | rooms cannot be found by name |
| Room identity | none | per-room lights need the data file |
| Separate meshes | merged per material | a fan cannot be picked out of the house mesh; walls are not separate objects |
| Lights, fans, switches | none in the file | all are created at run time |
| Transforms | root only, identity | positions in the data file are in the `.glb`'s own frame |

So the integration is a **sidecar**: `buildSmartHouse(plan)` (`frontend-react/src/lib/smartHouse.ts`) writes, per room, the rectangle, floor and
ceiling heights, light position, fan (if the room is a habitable room ≥ 9 ft wide), and the position/normal of the switch and regulator — in the
same frame as the `.glb`. The viewer has a **Smart-house data (.json)** button beside the `.glb` button.

Two things the first version got wrong and a real export caught (now fixed and tested):
* a **passage is open (no wall)** where it runs beside a living/dining/lounge/stair space, so a switch placed there would float in the air;
* the **stair well upstairs** has a guard rail, not a wall, where nothing adjoins it; and the structural exterior wall is 230 mm in all three styles
  (Traditional/Wada add cladding on the outside only).

**Limits of the data file:** it knows rooms, doors, windows and the wall rules of the 3D build, not every decorative object. If a model was edited
after export, or a room has no automatic position (`notes` in the file), place the control by hand with a `SmartAnchor` (section 5).

---------------------------------------------------------------------------------------------------------------------------------------------------

## 2. Architecture

```
web app                         Unity package  com.realestate.smarthouse
-------                         ------------------------------------------------------------------
plan ──buildSmartHouse──► house-N.smarthouse.json ─┐
GLTFExporter ─────────► house-N.glb ──(glTFast)────┤
                                                   ▼
Runtime/Core  (pure C#, no UnityEngine, tested under Mono)
   SmartHouseDocument  MiniJson          the data file
   LightBank           ControlSource     one on/off state per room; event Changed(room, on, source)
   FanModel / FanSpec                    levels 0-5, RPM table, acceleration, exact integration
   VoiceCommandParser  RoomQuery         text -> command, room phrase -> rooms
   SmartHouseState                       lights + fans + Execute(text);  RoomLocator (point -> room); owns Auto + Energy
   AutoLighting                          optional motion-sensor rules (enter -> on, leave + delay -> off, manual override)
   EnergyModel / EnergySpec              SIMULATED watts and session Wh
   VoiceStatusBoard                      Listening / recognized / completed / not understood / microphone unavailable
   PanelModel                            rows, pages and button actions of the control panel
   GltfSpace                             feet->m, mirror axis, calibration from the model's bounds

Runtime  (Unity)
   SmartHouseController  one per scene (a second one removes itself); ticks the fans, finds the room you are in,
                         limits real-time lights, connects voice, builds everything through HouseBinder
   HouseBinder           builds lights / fans / switches / regulators under ONE container at the scene root
   RoomLightView  CeilingFanView  WallSwitchView  FanRegulatorView(+Pad)   thin views of the state
   SmartControlPanel     in-house control panel (+ PanelButton): master ON/OFF, per-room light and fan, auto, voice status, energy
   SmartRayInteractor    controller ray + trigger (InputDevices; no XR Interaction Toolkit needed), mouse in the Editor
   Voice/                VoiceBackendBase  AndroidSpeechBackend  ExternalTranscriptBackend  VoiceCommandRouter
                         MicrophonePermission  VoicePushToTalk
   VoiceFeedbackToast    "Heard: “…”  →  Living Room light ON" caption that follows your gaze
   SmartDebugConsole     typed commands in the Editor / development builds (IMGUI: not visible in a headset)
   SmartAnchor           manual placement  ·  DemoHouseBuilder  stand-in model made from the data file
Editor/SmartHouseSetupWindow   Real Estate > Smart House > Setup      Editor/FanPrefabCreator   Create ceiling fan prefab
```

**One source of truth.** Voice, the wall switch and the regulator all call the same `LightBank` / `FanModel`; every visual only *reads* that state.
So voice and switches cannot disagree, and the number on the regulator is read from the very model the blades are driven by.

The generated objects are separate from the model: they live under `SmartHouse_Generated`; the house model is never rotated or animated (only its root
is scaled by 0.3048 once, if its size says it is still in feet).

---------------------------------------------------------------------------------------------------------------------------------------------------

## 3. Try it without a .glb (demo house) — Unity Editor, ~5 minutes

1. Unity 2021.3 LTS or newer, URP 3D project. *Window ▸ Package Manager ▸ + ▸ Add package from disk…* → `Packages/com.realestate.smarthouse/package.json`.
2. Package Manager ▸ *Smart House* ▸ **Samples ▸ Demo house ▸ Import** (brings `demo.smarthouse.json`).
3. *Real Estate ▸ Smart House ▸ Setup*: drop `demo.smarthouse.json` into **Data file**, press **Try the demo house**. (This creates a `SmartHouse` object with
   `SmartHouseController` + `DemoHouseBuilder` and a config asset.)
4. Make sure the scene has a camera tagged **MainCamera** (the head). Place it **inside a room**, about 1.6 m up. The demo house is a stand-in built from
   the data file (solid walls, **no doors**): the first room is at roughly x 6–8 m, z 1–6 m — use the room names in the panel if you are lost.
5. Press Play. The in-world control panel appears in front of the camera, and an editor-only *Smart House* window (IMGUI) lets you type: type `turn on the light`, `turn on all lights`, `set the fan to speed 3`, or use the buttons. Click a wall
   switch or a regulator digit with the mouse (needs the old Input Manager; with only the new Input System use the panel).

## 4. Use a generated house

1. In the web app open the 3D view of a plan. Click **Download 3D model (.glb)** and **Smart-house data (.json)** → `house-1.glb`, `house-1.smarthouse.json`
   (same number). Use the **same plan, style and floors** for both.
2. Unity: install **glTFast** (`com.unity.cloud.gltfast`, Package Manager ▸ Unity Registry). Drop `house-1.glb` into `Assets/`; glTFast imports it as a prefab.
   Drop `house-1.smarthouse.json` into `Assets/` (it imports as a TextAsset).
3. Drag the house prefab into the scene (position it anywhere, rotation about Y is fine). Do **not** scale it by hand.
4. *Real Estate ▸ Smart House ▸ Setup*: **House root** = the prefab instance, **Data file** = the json, **Add / update SmartHouseController**.
5. Press Play. The console prints e.g. `18 room lights, 7 fans, 18 switches, 7 regulators; mirror X` and any warnings.

**Mirror axis.** glTF is right-handed, Unity left-handed; importers mirror one axis and which one depends on the importer. The binder chooses by checking
which mapping puts the rooms inside the model's bounds. If it says *AMBIGUOUS* (house centred on the origin) check that lights sit in their rooms; if not,
set **Mirror** in the config to X or Z by hand. This is the first thing to verify with a real import.

**Loading a .glb at run time** (downloaded in the headset): import *Samples ▸ Runtime .glb loader (glTFast)*; it is written against the glTFast 5/6 API and
not compiled here.

## 5. Manual placement, and "my model has no data file"

* Add a **SmartAnchor** (empty GameObject + component) where a control must go: kind *WallSwitch / FanRegulator / CeilingFan / CeilingLight*, `roomKey` as in
  the data file (`<floor>:<room id>`). **+Z of the anchor must point into the room**, position on the wall's room-side face. It replaces the automatic one.
* Without a data file (or an unreadable one) the controller falls back to **one master light** for the whole house — "turn on the light" / "turn on all
  lights" light it — and no fans. This is a documented fallback, not per-room control.

---------------------------------------------------------------------------------------------------------------------------------------------------

## 6. Voice

**Phrases** (case, punctuation and "please / the / my" are ignored): `turn on|off the light` (the room you are standing in), `… the living room light`,
`… the bedroom light`, `… the master bedroom / kitchen / dining / bath / … light`, `… the second bedroom light`, `… first floor lights`, `… all lights`;
also `switch`, `put on`, `light(s) on/off`. Fan: `turn on|off the fan` (on = level 3), `set the fan to speed 4`, `fan level two`, `faster`, `slower`,
`living room fan off`.
The current room comes from the head position (`RoomLocator`); outside any room a bare "turn on the light" answers *"Say which room…"* instead of guessing.
"bedroom light" lights **every** bedroom unless you say the ordinal ("second bedroom"). Rooms with the same type are numbered in file order.

**Confirmation and status.** Every final transcript shows a caption in front of you (what was heard, what happened). The control panel's voice line shows the
pipeline state: *Listening…* → *Command recognized* → *Action completed*, or *Command not understood* / *Command recognized, nothing to act on* /
*Microphone unavailable* (permission denied, no recogniser, error) / *asking for microphone permission* / *Voice: off (use the panel)* when no backend is attached.
More phrases: `turn on|off automatic lighting` (also `motion sensor`), `show|hide the control panel`.

**Recogniser options evaluated**

| Option | Cloud / key | Status |
|---|---|---|
| `android.speech.SpeechRecognizer` (`AndroidSpeechBackend`, built in) | on-device if the device has an offline pack, else the system service (cloud); **no key** | works on phones with a recognition service. **Not shown to work on Quest**: the one report found (a Meta developer-forum thread) says it returned a "speech not supported" error there. The backend then reports *Unavailable* and the panel says *Microphone unavailable*. Untested. |
| **Meta XR Voice SDK** (Wit.ai) via `ExternalTranscriptBackend` | **needs a Wit.ai account and a server access token (entered in the SDK's Wit Configuration asset), *Internet Access: Require*, and microphone consent; audio goes to Meta's cloud** (per Meta's *Receive Basic Voice Input* tutorial) | The route I recommend for Quest. Not tested here. |
| Offline engines (Vosk, whisper.unity) via `ExternalTranscriptBackend` | none | an option if no cloud is wanted; heavier on the headset. |
| Wall switches / regulator / typed panel | none | always available: the manual fallback. |

**Wiring the Meta Voice SDK** (no compile-time dependency): add an `ExternalTranscriptBackend` to the SmartHouse object, assign it to
**Voice Backend** on the controller; on the `AppVoiceExperience`, add to *VoiceEvents*: `OnPartialTranscription → ExternalTranscriptBackend.OnPartial(string)`,
`OnFullTranscription → ExternalTranscriptBackend.OnFinal(string)`, and on the backend set *Listen Action* → `AppVoiceExperience.Activate`.
Optional `VoicePushToTalk` (hold a controller button to listen). Follow Meta's current Voice SDK setup for the token and dictation settings.

**Permission.** Android needs `RECORD_AUDIO` in the manifest *and* a run-time prompt (`MicrophonePermission.Request`, called by both backends). If denied the caption says
so and the switches keep working. Copy `Samples~/AndroidManifest/AndroidManifest.xml` entries into `Assets/Plugins/Android/AndroidManifest.xml`
(it also has the `<queries>` entry Android 11+ needs to see recognition services). Check Meta's current docs for any Quest-specific permission entry.

**No duplicate listeners.** One controller per scene; `VoiceCommandRouter.Attach` is idempotent; the same final transcript within 1.2 s is executed once.

---------------------------------------------------------------------------------------------------------------------------------------------------

## 7. Wall switches and the regulator

* Placed beside a door, 4 ft (1.22 m) above the floor, on the room-side face of the wall (half the wall thickness from the centre line, +2 mm), clear of every
  door, window and passage opening and ≥ 0.7 ft from corners; the regulator sits beside the switch of rooms with a fan. Audited on 21 stored plans (314 rooms).
* Plate + rocker + LED + label (**LIGHT ON / LIGHT OFF**); the regulator has pads **0–5** and a read-out (`FAN 3 / 190 rpm`).
* Colliders start at the plate's back face, so none is inside a wall. Reach: the ray is 4 m (config).
* **VR input:** `SmartRayInteractor` reads the controller pose and trigger from `UnityEngine.XR.InputDevices` (right and left hand), draws a ray, gives a haptic tick on hover
  and a stronger one on press. `aimPitchDeg` (30°) tilts the grip pose towards the way a Touch controller is aimed — **tune on the device**. If your rig already
  has tracked controller transforms (XRI, `OVRCameraRig` anchors) assign `rayOrigin` instead.

## 7b. Control panel, master switch, automatic lighting, energy

**Control panel** (`SmartControlPanel`, built by the controller; `Show Control Panel` in the config). A world-space panel (0.68 × 0.745 m) that stands ~1.1 m in front of you at
start and then stays where it is (it never follows your head and is not part of the house). Contents:
voice status line · **ALL ON / ALL OFF** (master switch) · **AUTO LIGHTS** toggle · lights/fans summary · 6 room rows per page (room name + floor, light ON/OFF button, fan **−**, level, **+**) ·
page buttons · simulated energy. Every button is picked with the same controller ray as the wall switches, and every value is read from the one shared `SmartHouseState`
(through `PanelModel`), so panel, voice, wall switches and regulator cannot disagree. Move it with **Panel Anchor**; left **Y** (or "show the control panel") brings it back in front of you.
The "master switch" is the panel's ALL ON / ALL OFF and the spoken "all lights"; no physical master plate is generated (the data file has no entrance location).

**Automatic lighting** (`AutoLighting`, optional, **off by default**; panel button, `Auto Lights On Start`, or voice). Occupancy = the headset position (`RoomLocator`), or a
simulated occupant for desktop testing (editor debug window ▸ *occupant*). Rules: entering a room turns its light ON; leaving starts a countdown (`Auto Vacancy Seconds`, default 30)
after which it turns OFF; coming back cancels it. **Manual always wins**: a light you switch off by hand while you are in the room is held off while you stay; a light you change from
elsewhere keeps its state until you next enter and leave; the automation never acts in a room you are standing in apart from the one switch-on at entry. No real sensor hardware is
involved — it is a simulation driven by the VR head position. Not available in the one-master-light fallback.

**Energy** (`EnergyModel`, `Show Energy`): **simulated, not measured.** Assumed power: **9 W per lit room light** and, per fan level 0–5, **0 / 18 / 28 / 40 / 55 / 75 W** (a 1200 mm AC-induction
fan; all editable in the config's *Energy* block). A fan draws the rated watts of its selected level, 0 W at level 0 even while the blades coast down. Session total = Σ watts × seconds ÷ 3600, shown in Wh/kWh.
Every figure is labelled "Simulated". No tariff or cost is shown (that would be a further assumption).

---------------------------------------------------------------------------------------------------------------------------------------------------

## 8. The ceiling fan

* Built in code (`CeilingFanBuilder`): **stationary** canopy, down-rod and motor shroud; a separate **BladeAssembly** (hub cap, blade irons, 5 pitched wooden blades with a
  grain texture, bronze metal). Only `BladeAssembly` rotates (`CeilingFanView`); the fan root, the house and the model never rotate. 3 draw calls per fan.
* **Speeds** (`SmartHouseConfig.fan`): level 0 = off, 1–5 = 90 / 140 / 190 / 240 / 300 rpm (= 540 … 1800 deg/s), acceleration 450 deg/s², deceleration 300, stop 600.
  Edit the table in the asset. The model integrates **exactly** (analytic), so the angle after *t* seconds does not depend on the frame rate.
* Direction: `spinDirection` (+1 counter-clockwise seen from below).
* **If your .glb already has a fan** (a merged fan mesh cannot be turned): in Blender, select the fan faces → *Edit Mode ▸ P ▸ Selection* to separate; keep the canopy/rod/motor
  as one object ("FanMount") and the blades + hub as another ("FanBlades"); set the origin of "FanBlades" to the fan axis (*Object ▸ Set Origin ▸ Origin to 3D Cursor* with the cursor on the
  axis); apply scale/rotation; export. In Unity put a `CeilingFanView` on the root, assign `bladeAssembly` to FanBlades, and (rotate axis) the local axis the fan spins about.
  The generated houses contain **no** fan, so this is only for your own models; the procedural fan is the reusable one: **Real Estate ▸ Smart House ▸ Create ceiling fan prefab** saves a prefab (with its meshes, materials and texture as assets) that follows the
  fan state of the room named in its `roomKey` (*Auto Bind*). That menu item compiles but has **not been run in Unity**.
* The regulator's lit pad is the model's level; its rpm figure is `VelocityDegPerSec / 6` of the same model, i.e. the speed the blades really have at that moment.

---------------------------------------------------------------------------------------------------------------------------------------------------

## 9. Performance (Quest standalone)

* No art assets: a few meshes, one wood texture (128×256), no per-frame allocation in the update paths.
* Real-time lights: **at most `maxRealtimeLights` (4)** lit rooms keep a point light — the ones nearest your head; the others keep their glowing fixture (emission). Shadows are off
  by default, so **light passes through walls into neighbouring rooms** (real-time shadows are too costly on Quest); keep ranges tight (the range follows the room size).
* Fan: merged meshes, 3 draw calls. Text: `TextMesh` (no TextMeshPro dependency).
* Always-included shaders: generated materials use `Shader.Find`; in a build add the Lit shader to *Project Settings ▸ Graphics ▸ Always Included Shaders* (the Setup window has a button and a check),
  or assign materials in the config.

## 10. Build for Quest and test in the headset

1. *File ▸ Build Settings ▸ Android ▸ Switch Platform.* Set up XR for Quest with **either** Meta's *XR Plugin / OpenXR* (Project Settings ▸ XR Plug-in Management ▸ Android, enable *Oculus* or
   *OpenXR + Meta Quest feature group*) — follow Meta's current setup guide for your Unity version. IL2CPP, ARM64, minimum API level as Meta requires.
2. Scene: an XR rig with a camera tagged MainCamera; the house; the `SmartHouse` object (Setup window). Add `Assets/Plugins/Android/AndroidManifest.xml` from the sample.
3. Run *Real Estate ▸ Smart House ▸ Setup ▸ Run checks* and fix anything marked `!!`.
4. Build & Run with the headset in developer mode.

**Headset checklist (nothing below has been done):**
- [ ] Lights sit inside their rooms (if mirrored, set Mirror X/Z). Walk to the living room. Say "turn on the light" → caption + light. "turn off the light".
- [ ] Microphone prompt appears once; denying it shows the caption and leaves the switches usable.
- [ ] Point the right controller at a wall switch: ray, hover tick, trigger toggles; the label flips; saying the command flips it back.
- [ ] Regulator: pad 1 … 5 → each faster than the last; 0 stops; the read-out rpm matches what you see (count turns over 10 s).
- [ ] Ray lines up with the pointing direction (adjust `aimPitchDeg`); plates are readable and reachable at arm's length.
- [ ] Frame rate holds 72 Hz with all lights on.

---------------------------------------------------------------------------------------------------------------------------------------------------

## 11. Tests (what they prove and what they do not)

| Suite | How to run | Result |
|---|---|---|
| Core (voice grammar incl. automation/panel phrases, light bank, master switch, fan model, room query, calibration, data parsing, **panel model, voice-status board, automatic lighting, energy model**) | `bash tools/mono-tests/run.sh` (needs `mcs`, `mono`); also *Test Runner ▸ EditMode* (`CoreNUnitTests`) | 27 groups × 2 real data files, 436 / 424 checks, all pass (Mono) |
| Unity layer against **stand-in UnityEngine stubs** (binder placement, sync, fan speeds at 20/30/60/144 fps, ray, guards, fallbacks, demo house, **control-panel buttons incl. via the simulated ray, voice-status line, automation in the scene, energy, fan prefab auto-bind**) | same script | 200 checks pass; of 7 deliberate breakages of the new logic, 6 are caught and 1 is an equivalent mutant (see `docs/TEST_REPORT.md`) |
| Type-check: the Android code path, the Editor window / prefab creator, the NUnit/PlayMode test code | same script | compiles against stubs |
| PlayMode tests in real Unity (`Tests/PlayMode`) | *Test Runner ▸ PlayMode* | **written, not run** |
| Data audit over 21 stored plans (`tests/test_smart_house.py`) | `python -m pytest tests/test_smart_house.py` | in the project's suite |
| Data vs real exported `.glb` (browser; 2 plans × 3 styles): heights, footprint, every switch's wall face | same file | in the project's suite |

The stubs are *functional stand-ins* I wrote: they prove the package's own logic, not Unity's behaviour. One real bug was found that way (lathe meshes facing inward).

## 12. Known limitations

* Not run in Unity or on a Quest; voice on Quest unverified (see 6). The control panel's layout, text size and readability have never been seen in a headset; simulated controller input in the tests is not proof of real controller behaviour. The glTFast mirror axis, URP shader names, `TextMesh` sizing, controller aim pitch and haptics are unverified.
* Light leaks through walls (no real-time shadows). The room locator uses plan rectangles: standing on a wall line may pick a neighbour.
* The demo house has no doors. Furniture is not in the data file. A 2-D "L-shaped" room is treated as its bounding rectangle in the file.
* The data file does not know about edits made to the `.glb` after export.
* Automatic lighting is a head-position simulation; energy figures are assumptions, not measurements. One light and one fan per room (see `docs/FUTURE_EXTENSIONS.md`).
* The editor debug window (IMGUI) is not visible in a headset; the in-world panel is.
