# Meta Quest 2 — build, install and headset test guide

**Status: nothing in this document has been executed.** I had no Unity Editor and no headset. Every "Result" cell below is deliberately blank:
fill it in as you test, and send me the failures (with the Console / `adb logcat` text) — the first real run is where the unverified parts
(glTFast mirror axis, URP shaders, text sizing, controller aim, haptics, voice) will show up.

## 1. Quest preparation (once)
1. A Meta developer account; the headset registered to it.
2. Phone: *Meta Horizon* app ▸ Devices ▸ your headset ▸ Headset Settings ▸ **Developer Mode** on. Reboot the headset.
3. PC: USB-C cable (Link/data-capable). Install **Meta Quest Developer Hub** (or Android platform-tools for `adb`). In the headset accept *Allow USB debugging* (tick "always allow").
4. `adb devices` must list the headset as `device` (not `unauthorized`).

## 2. Unity build settings
Follow Meta's current Quest/Unity guide for your Unity version; the settings that matter for this package:

| Setting | Value |
|---|---|
| *File ▸ Build Settings* | Platform **Android** (Switch Platform); Texture Compression **ASTC** |
| *Player ▸ Other Settings* | Scripting Backend **IL2CPP**, Target Architectures **ARM64** only; Minimum / Target API level as Meta's current docs require; Color Space Linear |
| *Player ▸ Other Settings* | **Internet Access: Require** — only if you use the Meta Voice SDK (it sends audio to Wit.ai; Meta's tutorial sets this) |
| *XR Plug-in Management ▸ Android* | **OpenXR** (+ *Oculus Touch Controller Profile*, *Meta Quest Support*) or the Oculus plugin — see `UNITY_SETUP_GUIDE.md` §7 |
| *Graphics* | Add the **Lit** shader to *Always Included Shaders* (Setup window button) |
| URP asset | mobile-friendly: HDR off, MSAA 4×, shadows off (the package defaults to no shadows), SRP Batcher on |
| Manifest | `Assets/Plugins/Android/AndroidManifest.xml` containing the `RECORD_AUDIO` entry from *Samples ▸ Android manifest for Quest* (merge, don't replace Meta's entries) |

Run *Real Estate ▸ Smart House ▸ Setup ▸ Run checks* and clear every `!!`.

## 3. Build and install
* **Build and Run** with the headset connected (Build Settings ▸ Run Device = the Quest), or build an APK and: `adb install -r SmartHouse.apk`.
* Launch from the headset: *Library ▸ Unknown Sources ▸ your app*.
* Logs: `adb logcat -s Unity` (look for the line `[SmartHouse] N room lights, M fans, ... mirror X|Z` and any warnings).

## 4. Voice on Quest — what to expect and how to set it up

| Route | Needs | Why it might fail |
|---|---|---|
| **Meta Voice SDK** (Wit.ai) → `ExternalTranscriptBackend` — *the route I recommend* | a Wit.ai app and its **server access token** entered in the Voice SDK's *Wit Configuration* asset (in the editor, kept out of source control — **never type a token into a script**); *Internet Access: Require*; microphone consent | audio goes to Meta's cloud; no network = no voice. Wiring below is from Meta's tutorial + the package's hooks; **not tested** |
| `AndroidSpeechBackend` (built in, `android.speech.SpeechRecognizer`) | RECORD_AUDIO + a recognition service on the device | **Not shown to work on Quest.** The only report I found (a Meta developer-forum thread) says `SpeechRecognizer` returned a "speech not supported" error on a Quest. If so the backend reports *Unavailable* and the panel says *Microphone unavailable*. Treat as a probe, not a feature |
| Offline engines (Vosk, whisper.unity, PocketSphinx) → `ExternalTranscriptBackend` | a native plugin + model files on the headset | extra integration work; one forum report says PocketSphinx builds run on Quest. Not implemented here |

Wiring the Voice SDK to the package (from Meta's *Receive Basic Voice Input* tutorial; verify in the SDK version you install):
1. Install Meta's XR SDK / Voice SDK; create a Wit.ai app; *Meta ▸ Voice SDK ▸ Voice Hub ▸ Wit Configuration* ▸ paste the server token ▸ **Link** ▸ save the asset.
2. *Assets ▸ Create ▸ Voice SDK ▸ …* an **App Voice Experience** in the scene, assign the Wit configuration.
3. On the `SmartHouse` object add `ExternalTranscriptBackend`; assign it to **Voice Backend** of the `SmartHouseController`.
4. On the App Voice Experience's events: `OnPartialTranscription (string)` → `ExternalTranscriptBackend.OnPartial`; `OnFullTranscription (string)` → `ExternalTranscriptBackend.OnFinal`.
   On the backend, *Listen Action* → `AppVoiceExperience.Activate` (or use `VoicePushToTalk`: hold left **X** to talk).
5. The sentences are parsed by the package itself, so the Wit.ai app needs **no intents** — only the transcription.

The microphone prompt: `MicrophonePermission.Request` runs when listening starts. Denied → the panel's voice line says *Microphone unavailable* and everything else keeps working.

## 5. Headset test checklist (mark each when you run it)

Legend — Result: PASS / FAIL (+note) / blank = not run.

### 5.1 Placement and import
| # | Check | Result |
|---|---|---|
| 1 | Console shows `N room lights, M fans, N switches, K regulators; mirror X or Z` | |
| 2 | In every room tried, the ceiling fixture is inside that room (if mirrored: set *Mirror* to the other axis) | |
| 3 | Wall switches are on the room-side wall face, ~1.2 m high, not inside the wall and not floating | |
| 4 | The house itself did not move, rotate or scale when lights/fans ran | |

### 5.2 Lights
| # | Check | Result |
|---|---|---|
| 5 | Panel *ALL ON*: every fixture glows and the room brightens; *ALL OFF*: all dark | |
| 6 | A room's panel button toggles only that room; its wall switch label flips LIGHT ON ⇄ LIGHT OFF | |
| 7 | Wall switch toggles the same light the panel and voice control (change one, the other two follow within a fraction of a second) | |
| 8 | With many lights on, frame rate holds 72 Hz (OVR Metrics Tool / Developer Hub) | |

### 5.3 Fan
| # | Check | Result |
|---|---|---|
| 9 | Regulator pad 1 → slow; pad 2 visibly faster than 1; 3 > 2; 4 > 3; 5 = maximum | |
| 10 | Pad 0 (or panel − until *FAN OFF*): blades decelerate smoothly to a stop | |
| 11 | Only the blades turn (mount, canopy, rod and the house stay still); speed changes ramp, they do not jump | |
| 12 | Count turns over 10 s at level 3: ≈ 190 rpm ≈ 32 turns (config table) | |
| 13 | Regulator read-out and the panel row show the same level | |

### 5.4 Controller interaction
| # | Check | Result |
|---|---|---|
| 14 | Right ray appears; it lines up with where you point (else tune *Aim Pitch Deg*) | |
| 15 | Hovering a switch / pad / panel button gives a haptic tick; the trigger gives a stronger one and toggles | |
| 16 | Left ray works the same | |
| 17 | The panel is readable at 1 m and at arm's length; its buttons are easy to hit; it does not block walking; left **Y** recalls it | |
| 18 | Switch labels (LIGHT ON/OFF) and regulator digits are readable | |

### 5.5 Voice
| # | Check | Result |
|---|---|---|
| 19 | Microphone permission prompt appears once; *Allow* → status line says *Listening...* | |
| 20 | "Turn on the living room light" → *Command recognized* → *Action completed*, light on | |
| 21 | "Turn off the bedroom light", "turn on all lights", "turn off all lights", "set the fan to speed three", "stop the fan" | |
| 22 | Nonsense → *Command not understood* | |
| 23 | Deny the permission (or no network with the Voice SDK) → *Microphone unavailable*; switches and panel still work | |
| 24 | A command is executed once, not twice | |

### 5.6 Automatic lighting and energy (optional features)
| # | Check | Result |
|---|---|---|
| 25 | Panel *AUTO LIGHTS* → ON. Walk into a room: its light comes on | |
| 26 | Walk out: it switches off after the configured delay (default 30 s) | |
| 27 | Switch a light off by hand while standing in the room: it stays off while you stay | |
| 28 | Energy panel: power matches *9 W × lights + fan watts*; session total grows; all labelled *Simulated* | |

### 5.7 Performance
| # | Check | Result |
|---|---|---|
| 29 | 72 Hz with the house, all lights on and all fans at 5 (stale frames / GPU time in OVR Metrics Tool) | |
| 30 | No spikes when turning lights on/off or changing panel pages | |

## 6. If something fails
Send: the `[SmartHouse]` lines from `adb logcat -s Unity`, the Unity and glTFast versions, whether you use OpenXR or the Oculus plugin, and (for placement) a screenshot from inside the room.
