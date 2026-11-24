# Report: live customization, VR customization panel, human-scale, in-VR fan, QR workflows

Built on top of `RealEstate_walkable_vr_final.zip` (the authoritative baseline). Walkability, furniture clearance, door hinges, compound-wall openings, pedestrian access and
circulation code were not modified (the customiser only swaps materials / adds thin surface layers and never touches geometry or the navigation grid; a test asserts this).
**Nothing in this report was tested on a physical Meta Quest 2 / Quest Browser.**

## What was added
| Area | Where |
|---|---|
| Live customization of the loaded 3D house (rooms, walls, floors, ceilings, doors, frames, furniture, curtains, rugs, exterior, palettes; Undo/Redo/Reset/Save/Restore) | `src/custom/*`, `docs/VR_CUSTOMIZATION.md` |
| Floating customization panel in the WebXR scene + desktop mirror (independent of the Smart Home panel) | `src/vr/VrEngine.ts`, `src/vr/panelCanvas.ts`, `src/pages/VrViewer.tsx` |
| Human-scale diagnosis + daylight default lighting (EVENING kept) | `docs/HUMAN_SCALE_DIAGNOSIS.md` |
| In-VR fan control (ray hover/select, OFF/1/2/3/4/5, voice phrases, one state model) | `docs/SMART_HOME_VR_CONTROLS.md` |
| QR share (desktop) and in-app QR scan with validation + confirmation | `src/qr/*`, `docs/QR_AND_CLOUDFLARE_WORKFLOW.md` |
| Vite `allowedHosts` for Cloudflare Quick Tunnel hosts (API proxy unchanged) | `vite.config.ts` |

## New tests (all executed in this environment)
* `dev/check_custom.ts` 26 checks, `dev/check_qr.ts` 22 checks, `dev/check_smart_core.ts` 43 checks (node, run through `tests/test_vr_webxr.py`).
* `dev/e2e_custom.cjs`: 16 browser checks + 7 simulated-controller checks (g2_0; also run on g1_0 and g2_1 earlier in this session: all but a screenshot step passed, that step was then made robust).
* `dev/e2e_scale.cjs`: 29 checks on 4 layouts + runtime scale checks.
* `dev/e2e_qr.cjs`: 25 browser checks + 3 simulated (Chromium fake camera video; permission-denied / no-camera / invalid codes simulated by stubbing).

## Regression results (baseline behaviour)
| Suite | Result |
|---|---|
| Walkability audit, all 89 layouts (`dev/audit_access.cjs`) | 89/89: 0 unreached rooms, 0 door failures, 0 furniture failures, entrance and floors reachable |
| Baseline VR browser suite (`dev/e2e_vr.cjs`), houses g2_0 / g1_0 / g2_1 | 31/31 browser + 8/8 simulated-controller checks on each house |
| `tests/test_vr_webxr.py` | 9 passed, 4 skipped (the 4 are the opt-in browser tests, `VR_E2E=1`; the browser suites above were run directly) |
| Backend suite (43 test files) | all pass; `test_platform_e2e` 11/11 passed on a clean run |
| `tsc` type check, `npm run build` | clean / built |

## Newly introduced failures, and how they were resolved
1. **Simulated-controller test pressed the wrong spot (real, test-side).** The panel became 880 px tall when the fan strip was added, and `e2e_vr.cjs` still assumed 800 px, so the injected trigger missed ALL ON. The test now reads the panel's size from the engine. The product behaviour was correct.
2. **Two g1_0 timeouts (renderer speed, not a regression).** A canvas screenshot / click takes ~36 s in this software-rendered Chromium, over Playwright's 30 s default; it takes the same ~36 s on the unmodified baseline tree. Only timeouts were raised; no assertion was changed.
3. **`test_platform_e2e` 4 failures (environment).** It reuses a backend already listening on :8000; mine had no mocked Gemini. With the servers stopped so the test starts its own, it passed 11/11.
4. A screenshot step in `e2e_custom.cjs` timed out on the same slow renderer; it now captures with a clip instead of waiting for element stability.
No test was deleted or weakened.

## Pre-existing limitations (still true from the baseline)
* Some doors are *assumed* on legacy layouts so every room is walkable ("1 door was assumed ... Your saved plan is unchanged").
* Physical Quest 2 behaviour (comfort, frame rate, floor calibration, controller feel) is unverified.
* Furniture seat heights are above typical (see HUMAN_SCALE_DIAGNOSIS.md); not changed.

## Limits of the new features
* Customization changes finishes only: ceiling shape and furniture layout are not live-changeable; open/outdoor spaces get no floor/ceiling skins.
* Voice phrases depend on browser speech support and microphone permission (denial is handled with a visible message); typed commands always work.
* QR: tested with a fake camera and stubs, not a real phone, Quest camera or Cloudflare tunnel.
* Test environments: desktop Chromium (software GL), a mock WebXR session with injected controller poses, node unit checks. "Simulated" here is not a headset.

## Correction: fan SPEED 4 added (final speed set: OFF, 1, 2, 3, 4, 5)
The fan model and voice grammar already supported level 4 (240 rpm = 1440 deg/s); what was missing was the *named-speed list* used by the UI. Changed:
* `FAN_SPEEDS` is now `[1, 2, 3, 4, 5]` (`src/vr/smart/panel.ts`): the Smart Home panel strip is FAN OFF, FAN ON, SPEED 1, 2, 3, **4**, 5 (4 sits between 3 and 5); the VR engine's keyboard handler validates against the same list (key **4** now works; before it was deliberately ignored).
* In-world fan popup (`src/vr/fanPopup.ts`): six buttons (OFF + 1-5), widths computed from the popup width so they stay inside it and do not overlap (still >= 100 px controller targets).
* Voice: "Set fan speed to 4" (also "four", and the common mis-hearing "for") sets level 4; works inside an immersive session (no exit).
* Hints on the viewer page and docs (`docs/SMART_HOME_VR_CONTROLS.md`) updated; speed table now 540 / 840 / 1140 / **1440** / 1800 deg/s.
Tests (all executed): `dev/check_smart_core.ts` 44 checks (was 43; speed table, panel order/highlight, popup layout, voice variants, one-state-model test); browser/simulated suite (`dev/e2e_vr.cjs`) now also checks key 4, typed "Set fan speed to 4", measured blade speed per button (4 = 1440 deg/s: faster than 3, slower than 5), and in the mock-XR session the popup button 4, the panel strip button 4 and the voice phrase while still in `vr` mode.
Results: g1_0 33/33 browser + 8/8 simulated-controller; g2_0 32/32 + 8/8 (run before two test-only changes below, not re-run on g2_0); unit pytest 9 passed / 4 skipped; tsc clean; build OK.
Test changes made along the way (no product code involved, no assertion loosened): an older assertion that key 4 is ignored was replaced by one expecting speed 4 (intended change); the lights-visible check keeps its original +4 % assertion but now runs under the evening lighting it was written for, with a separate daylight check (>= 1 %); two click/screenshot timeouts were raised for the slow software renderer. Still untested on a physical Quest 2.

## Feature: hands-free continuous voice control inside VR
Design, wake-phrase approach, privacy and compatibility notes: `docs/HANDS_FREE_VOICE.md`. New/changed: `src/vr/continuousVoice.ts` (new), `VrEngine.ts`, `smart/panel.ts` (MIC button), `smart/voice.ts` (muted state), `pages/VrViewer.tsx` (desktop controls/privacy note). The existing parser, `SmartHouseState`, `FanModel`, lighting and panel are reused; no second Smart Home system. Fan OFF/1-5 and all earlier controls are unchanged.

### Results, reported separately
| Environment | What was run | Result |
|---|---|---|
| **Node unit checks** (fake recogniser, virtual clock, real `SmartHouseState`) | `dev/check_voice_continuous.ts` | 41/41: start/permission/unsupported/denied/no-microphone; final-only execution, no double execution, confidence and chatter filtering; wake optional/required; restart, back-off, give-up, no restart loop on terminal errors; stop/re-enter/20 cycles single instance; mute/resume; room-specific lights and fans from anywhere; fan OFF/1-5; status text; MIC button layout |
| **Desktop Chromium, real page + backend** (scripted fake speech, not real speech) | `dev/e2e_voice.cjs` | 6/6: nothing listens before the click; typed commands; hands-free button; mute/resume; wake optional/required; push-to-talk exclusivity |
| **Simulated WebXR** (mock XR session, scripted fake speech) | `dev/e2e_voice.cjs` | 20/20: auto-listen on Enter VR, lighting without Speak, room-specific from another room, fan ON/OFF and speeds 1-5 with blade speeds 540/840/1140/1440/1800 deg/s, consecutive commands, duplicate delivery, interim/low-confidence/chatter ignored, recovery after unexpected end and no-speech errors, MIC button and left-stick mute/resume, Exit VR stops the recogniser, re-enter resumes, permission revoked, microphone refused -> fallback (panel and typed commands still work), no page errors; a browser without SpeechRecognition -> "unsupported" |
| **Physical Meta Quest 2** | - | **Not tested.** Whether Meta Quest Browser exposes speech recognition in an immersive session, real speech accuracy, noise behaviour and comfort are unverified |

### Regression after these changes
| Suite | Result |
|---|---|
| Baseline VR browser suite (`dev/e2e_vr.cjs`), houses g2_0 and g1_0 | 66/66 browser (33 each) + 16/16 simulated-controller (8 each) |
| `tests/test_vr_webxr.py` | 10 passed, 4 skipped (the opt-in browser tests, run directly above) |
| `tsc --noEmit`, `npm run build` | clean / built |
| Walkability audit (89 layouts) | not re-run: navigation, layout and backend files are byte-identical to the previous delivery (only voice, panel, viewer, docs and tests changed); last result 89/89 stands |
| Backend suite | not re-run: backend untouched |
No test was deleted or weakened.

### Limits
* Web Speech in Chromium streams audio to the vendor's online service while listening (stated on the page); a wake phrase does not reduce what the microphone hears. A true on-device wake-word engine would need a native/WASM engine and possibly a licence key.
* Meta Quest Browser support for continuous recognition is **unverified**; the app falls back to the panel, controllers and typed commands with a visible "unsupported" message.
* Speech accuracy for room names and speed numbers was not measured with real voices.
