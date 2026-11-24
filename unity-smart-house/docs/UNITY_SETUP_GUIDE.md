# Unity setup guide — Smart House VR (step by step)

Everything here was written from the documented Unity / glTFast / Meta APIs. **None of it has been executed in Unity or on a Quest** (see
`TEST_REPORT.md`). Where a menu name differs in your Unity version, follow Unity's current UI; the *intent* of each step is stated.

## 0. What you need

| Item | Version / note |
|---|---|
| Unity Hub + Unity Editor | 2021.3 LTS or newer (the package targets 2021.3; `Compat.cs` covers the 2023+ API rename). Install **Android Build Support** with *OpenJDK* and *Android SDK & NDK Tools* from the Hub. |
| Render pipeline | **URP** (3D URP template). The code also finds HDRP/Lit or Standard, but Quest needs URP. |
| glTFast | `com.unity.cloud.gltfast` (Package Manager ▸ Unity Registry). Needs URP + Shader Graph (installed with URP). |
| XR | *XR Plug-in Management* + **OpenXR** (or the Oculus XR plugin / Meta XR SDK). The package only uses `UnityEngine.XR.InputDevices`, which both provide. |
| From the web app | `house-N.glb` (**Download 3D model**) and `house-N.smarthouse.json` (**Smart-house data**) — same plan, style and floors. |

## 1. Create the project and add the package

1. Unity Hub ▸ New project ▸ **3D (URP)**.
2. Copy the folder `unity-smart-house/Packages/com.realestate.smarthouse` into your project's `Packages/` folder
   (or *Package Manager ▸ + ▸ Add package from disk…* ▸ its `package.json`).
3. Package Manager ▸ *In Project* ▸ **Real Estate Smart House (VR)** ▸ *Samples* ▸ import **Demo house** and **Android manifest for Quest**.
4. Check the Console for compile errors. Expected: none. If there are any, note the first message — it is the useful one.

## 2. Try the demo house first (no .glb)

1. *Real Estate ▸ Smart House ▸ Setup*.
2. **Data file** = `demo.smarthouse.json`. Press **Create config asset**, then **Try the demo house**.
3. Select the **Main Camera** (tag *MainCamera*), put it inside the first room about 1.6 m above the floor.
4. Press Play. You should see: the control panel in front of you, a caption when you press its buttons, fixtures glowing when lights are on.
   Use the *Smart House* debug window (editor only) to type commands such as `turn on the light`.

This confirms the package compiles and runs in your Unity version before any model is involved.

## 3. Import a generated house (GLB)

1. Install glTFast. Drag `house-N.glb` into `Assets/`. glTFast's importer turns it into a prefab-like asset; drag it into the scene.
2. Drag `house-N.smarthouse.json` into `Assets/` (it imports as a *TextAsset*).
3. **Do not scale or rotate the house instance by hand** (position and Y-rotation are fine). The package converts feet to metres itself
   (`Apply Feet To Metres` in the config). If you already scaled it, turn that option off — otherwise everything is 3.28× too small.
4. *Real Estate ▸ Smart House ▸ Setup*: **House root** = the house instance, **Data file** = the json, **Add / update SmartHouseController**.
5. Press Play and read the Console line: `N room lights, M fans, N switches, K regulators; mirror X|Z`, followed by any warnings.

### 3.1 Check the mirror axis (first real-import check)
Walk (or move the camera) to the living room. The light fixture and wall switch must be **inside that room**, on its walls. If everything is mirrored
(lights in the wrong rooms), select the config asset and set **Mirror** to the other axis (X ↔ Z). If the Console says *AMBIGUOUS*, this step is not optional.

### 3.2 Check heights and wall positions
A switch is 1.22 m above the floor on the room side of a wall, never inside a wall. If a plate is buried in a wall or floats, the glTFast import
scale or the model's origin differs from what the data file assumes — see README §4 ("Mirror axis") and tell me what you see.

## 4. The control panel

The `SmartHouseController` builds it automatically (`Show Control Panel` in the config). It stands about 1.1 m in front of the camera at start.

* **Move it:** create an empty GameObject where you want the panel (a wall or a stand), assign it to **Panel Anchor** on the `SmartHouseController`.
* **Recall it in the headset:** left controller **Y** button, or say *"show the control panel"*. *"Hide the control panel"* or the **X** on the panel hides it.
* It shows 6 rooms per page (◀ ▶ to page), the master **ALL ON / ALL OFF**, **AUTO LIGHTS**, the voice status line and a simulated energy read-out.
* The backdrop has no collider, so it never blocks the ray to a switch behind it. If the panel sits inside a wall at start, use a Panel Anchor or recall it.

## 5. Lights

Each room gets a fixture (emissive disc) plus a real-time point light. At most **4** point lights (nearest the head) are real-time at once; the others keep
their glowing fixture. Tune in the config: `lightColor`, `onIntensity` (URP 1–3), `rangeScale`, `maxRealtimeLights`, `shadows` (off = Quest-friendly; light then leaks through walls).

## 6. Ceiling fan and the fan prefab

* Fans are built from code per room that has one (`Add Fans` in the config): stationary mount + separate rotating `BladeAssembly`.
* **Reusable prefab:** *Real Estate ▸ Smart House ▸ Create ceiling fan prefab* builds a fan, saves its meshes, materials and wood texture as assets and writes
  `Assets/SmartHouse/Prefabs/CeilingFan.prefab` (a prefab saved from a *running* scene would lose its generated meshes, which is why this is an editor step).
  Drag it under your own ceiling, set `roomKey` on its `CeilingFanView` to a key from the data file (e.g. `0:living_room`) and leave **Auto Bind** on:
  it follows that room's fan state (regulator, panel, voice) and re-binds after a `Rebind`. *(The creator compiles against stand-ins only; run it once and tell me if Unity complains.)*
* **A fan that is already in your own model:** see README §8 (Blender separation steps) — the blades must be a separate object with its pivot on the fan axis.
* Speeds: config ▸ Fan ▸ `Rpm` table (levels 0–5), `AccelDegPerSec2`, `DecelDegPerSec2`, `StopDecelDegPerSec2`.

## 7. XR / OpenXR configuration (Quest 2)

1. *Edit ▸ Project Settings ▸ XR Plug-in Management* ▸ **Android** tab ▸ tick **OpenXR**.
2. *OpenXR* ▸ **Interaction Profiles** ▸ add **Oculus Touch Controller Profile** (Quest 2). Enable the **Meta Quest Support** feature (name may be
   "Meta Quest Feature Group" in your version). Alternative: the *Oculus* XR plugin with Meta's XR SDK — then use their rig (`OVRCameraRig`).
3. Scene rig: an **XR Origin** (from *XR Interaction Toolkit* / *XR Core Utils*) or `OVRCameraRig`; its camera must be tagged **MainCamera** (the package uses it as the head).
4. The ray comes from `UnityEngine.XR.InputDevices` (pose + trigger). If your rig exposes tracked controller transforms, assign one to **Ray Origin** on the
   `Ray_Right`/`Ray_Left` objects (children of the SmartHouse object) for an exact ray; otherwise tune **Aim Pitch Deg** (default 30°) on the device.
5. The package does **not** need XR Interaction Toolkit's interactors; it uses its own ray. (It can coexist with them.)

## 8. Voice

See README §6 and `QUEST2_BUILD_AND_TEST.md` §4. Short version: on Quest use the **Meta Voice SDK** through `ExternalTranscriptBackend`
(needs your own Wit.ai token, entered in the editor, never in code). `AndroidSpeechBackend` is built in but **not shown to work on Quest**.

## 9. Project checks

*Real Estate ▸ Smart House ▸ Setup ▸ Run checks* lists the things that most often break a headset build (missing shader in *Always Included Shaders*, wrong
platform, missing microphone permission). **Add the Lit shader to Always Included Shaders** fixes the usual one (generated materials use `Shader.Find`).
