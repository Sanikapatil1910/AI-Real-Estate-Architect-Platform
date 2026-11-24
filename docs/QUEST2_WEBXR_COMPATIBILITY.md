# Smart House WebXR — compatibility report and open items

**Nothing in this project has been run on a Meta Quest 2.** The environment this was built in has no headset. WebXR was exercised only through a *mock*
`navigator.xr` / `XRSession` with injected controller input (tests labelled MOCK), and the desktop fallback was exercised in headless Chromium.
No frame rate (72 / 90 Hz) is claimed. Controller behaviour on the device is unverified.

## 1. What was actually executed (see `docs/VR_TEST_REPORT.md` for the numbers)
* Real backend + real website pages in headless Chromium (software GL): sign-in → VR list → viewer, house built from the saved plan, exported to `.glb`, loaded back with `GLTFLoader`, textures capped,
  meshes merged, collision grid built, desktop walking and wall collision, panel buttons, wall plates, fans, automatic lighting, energy panel, typed commands, "voice unavailable" path.
* Node-only checks: Smart House logic, `realestate.smart-house/1` parsing over all stored plan fixtures, walking-grid geometry, WebXR availability/fallback decisions with a fake `navigator.xr`.
* The existing backend regression suite and floor-plan generator tests (report separately).

## 2. Simulated (mock) only — NOT evidence the headset works
* A fake `navigator.xr` that answers "immersive-vr supported" and a fake session; **three.js's real XR session handling was bypassed** (`setSession` replaced by a no-op).
* Injected thumbstick values (walk, 30° snap-turn), injected Y-button edge (open panel), injected `selectstart` on a *posed* controller object (ray hits the panel and wall plate).
These prove our input-handling code reacts correctly to the values a Quest gamepad *should* report. They do not prove the Quest reports those values (button/axis indices follow the
`xr-standard` mapping: stick = axes[2..3], X/A = buttons[4], Y/B = buttons[5]).

## 3. Needs a real Quest 2 (please confirm; none of these are verified)
1. The Quest Browser accepts the self-signed HTTPS certificate and still exposes `navigator.xr` / `immersive-vr` (or use a tunnel).
2. **Enter VR** starts an immersive session, the `local-floor` reference space is granted, and you stand at floor level in the right room (fallback to `local` + fixed eye height is implemented, untested).
3. Controller input: left stick walk, right stick snap-turn, trigger select, Y / X / B buttons, haptic pulses.
4. Controller 3D models: loaded at runtime from a CDN by three.js's `XRControllerModelFactory`; offline, a small marker box + ray is shown instead (the ray/marker path is the fallback, untested on the device).
5. Rendering performance. The scene is optimised (≈ 69 draw calls after merging 1346 meshes on the sample house; ≈ 88k triangles ground-floor sample, ≈ 151k two-storey; textures capped at 1024 px; no shadow maps; at most 4 dynamic point lights; foveation set to maximum).
   Whether this holds the headset's refresh rate is **unknown** — measure it. If it stutters: use `npm run quest:preview`, and reduce `MAX_TEXTURE_PX` (`src/vr/houseLoader.ts`) or the light pool size.
6. Memory/loading time on the headset for large plots (the 59-texture, ~10 M-pixel sample was measured only on a desktop).
7. Comfort: smooth locomotion speed and 30° snap-turn are defaults; **teleport** (right stick forward, with a blink) is implemented but its comfort on a headset is untested; there is no vignette during smooth movement.
7b. Sitting: the seated view height comes from the headset's tracked height at the moment of sitting (a modelled 75 cm above the seat); whether it feels right for a physically seated or standing person is untested.
8. The visual quality of the dynamic light pool and the lit/unlit contrast in the headset's lenses.
9. Voice (section 5).
10. Entering the session from the page's button vs the browser's own prompt, and the **EXIT VR** button ending the session.

## 4. Known limitations of the walk-through (all desktop-measured)
* **Collision is derived from the exported triangles** (floors, walls, furniture) — not from room names. Generated GLB meshes have no meaningful room/light/fan names, and nothing relies on them: rooms, lights, fans, switches come from the Smart House JSON built from the same plan.
* **Stairs and tight rooms (measured by flood-filling the walking grid from the spawn point on the desktop, final settings; the flood is repeated on four lattice steps and a room counts as reached if any run gets in, because a single lattice can miss a narrow doorway by alignment alone):**
  walking-on-stairs now follows the generator's own tread and landing surfaces (the guard rails and posts the generator draws across the foot of upper flights used to seal them), so every flight of every generated stair shape can be walked up and down.
  Result: all rooms reachable on foot in **16 of the 16 freshly generated houses** (1–3 floors, three styles) and in **11 of the 21 older saved sample plans** (including the 3-floor `g2_0`, `g2_1` and `sc_g2`, which are the ones whose upper flights used to be unclimbable).
  In the other 10 older samples 14 rooms are not reachable on foot: 12 bathrooms, plus the master bedroom in each of the two small `upload_demo*` plans. The one I traced in detail (`g2_0`, before the body radius was trimmed to 0.3 ft) was a 0.6 ft gap that the generator's own bedroom furniture leaves in front of the master-bath door;
  I did not trace every remaining case, so I do not claim a single cause for them. The generator's layout was not changed.
  Mitigation: teleport (right stick), the *Go G / Go 1F* floor buttons and each room's **GO** button always work.
* The collision body is deliberately slim (radius 0.3 ft ≈ 9 cm; camera near plane is 5 cm) so narrow bathroom doors and furniture gaps stay passable. Earlier radii left more bathrooms sealed (0.55 ft: most samples; 0.4 ft: 8 of 21 samples).
  In VR your real head/body can still lean through a wall (a browser cannot stop you); the grid only stops the *thumbstick* movement.
* **Ceilings:** the walking grid ignores undersides (ceilings, slab and stair undersides), so a ceiling never stops walking. Teleport arcs *are* stopped by ceilings and slab undersides (no teleporting through a floor); head room while walking is left to your own head position.
* **Teleport destinations** must be standable floor at a walking level of the house (a floor, a stair tread or landing, the terrace); a table top, a sofa back or a bed is not a destination. An arc can land on another floor only where there is a line of sight to it (through the stairwell, from a landing, from the stairs).
* **Sitting** uses the seats the furniture builder places (so it follows every newly generated house, all three styles): dining / desk chairs, sofa cushions and armchairs, bed foot, bench, kitchen-island stools. The Wada *gadi* / *peeth* and the Traditional Indian *divan* go through the same sofa code, so they are seats too (their height is read from the mesh); rooms where the generator placed no table or sofa have nothing to sit on (3 of the 16 fresh houses, all 3-floor Traditional/Modern ones, have a dining room with no chairs).
  A `.glb` opened on its own (no plan) has no seat data, so there are no sit discs there.
* The walking grid uses 0.3 ft cells; very narrow gaps (< ~1.1 ft after body radius) are treated as closed.
* Plot/terrace triangles far outside the house are culled/split for the grid; the player cannot leave the footprint's floor surfaces.
* Automatic lighting and the energy panel are simulations (no sensors, no real power data).
* Interior lighting is an "evening" setup (dusk environment at 0.5 intensity, no shadows) so that lit rooms are visibly different from unlit ones; daylight mode is not implemented.
* The `.glb` is exported in the browser from the same builder the 3D viewer uses (so textures, materials, architecture and scale match; feet → metres under one 0.3048 scale group). The exported mesh names are generic; this is by design.

## 5. Voice commands in the Quest Browser — findings
* Implementation: the browser's **Web Speech API** (`SpeechRecognition` / `webkitSpeechRecognition`), used **only if the browser exposes it**. If it does not, the page and the panel show *"Microphone unavailable"* with the reason, and every manual control keeps working. Nothing is simulated.
* What I could establish: in Chromium the Web Speech API sends audio to an online speech service of the browser vendor; reports from Quest developers say the Meta Quest Browser does **not** provide it, and I found no confirmation that it works inside an immersive session. **Not verified on a device.**
  On the Quest, the *system* voice commands (Meta's own "Hey Meta" features) are separate and cannot drive this page.
* Browser-compatible alternatives (none implemented or enabled):
  * A cloud speech-to-text API (Google / Azure / OpenAI …) — **needs an API key and usually a paid plan; I have not added it. I will ask you before making any paid service a requirement.**
  * In-browser WASM speech recognition (e.g. a small Whisper/Vosk model): no key or service, but a download of tens of MB, noticeable CPU load on a Quest 2 that is also rendering, and **untested**.
  * The typed-command box (desktop) and the panel buttons / wall switches use the same command parser and are available now.

## 6. Security / privacy notes
* The dev certificate is self-signed and only for local testing; do not use it for a public deployment.
* The saved plan is read through the existing authenticated `/projects/<id>` API; no new backend endpoint was added.
