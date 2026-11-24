# Hands-free (continuous) voice control inside VR

**Status of testing: nothing in this feature has been run on a physical Meta Quest 2.** It was tested with a *scripted* speech recogniser (a fake `SpeechRecognition`, fake microphone permission) in desktop Chromium and in a mocked WebXR session. That proves the lifecycle, the command parsing and the wiring into the Smart House state. It does **not** prove that the Meta Quest Browser offers speech recognition, that it works inside an immersive session, or how accurate it is.

## What it does
* **Starts with VR.** Pressing *Enter VR* starts hands-free listening: the microphone permission is requested explicitly (the page never listens before that), then one speech recogniser keeps running. Nothing needs a *Speak* click and VR is never exited to give a command.
* **Stays on.** If the browser ends the recogniser (silence timeout, network blip) it is restarted after 300 ms; repeated quick failures back off (300 ms, 300, 600, 1.2 s ... up to 5 s) and after 6 in a row it **gives up** with "Voice stopped - tap MIC to retry". It never loops on a refusal: a denied/revoked microphone, a missing microphone, or a browser without the Web Speech API are terminal states with a clear message (no restart).
* **Only complete, new commands run.** Interim ("half-heard") text is shown in the status pill but never executed; each final result runs once (a result delivered twice is ignored; the same phrase twice within 1.5 s runs once); results with a reported confidence under 0.35 are ignored; everyday chatter that is not a Smart House command is ignored silently.
* **Room-specific, without standing in the room.** The existing parser resolves the room *type* from the house ("living room", "kitchen", "dining room", "bedroom(s)", ...), so "Turn on the kitchen lights" works from anywhere. Examples tested: *Turn on the living room lights / Turn off the kitchen lights / Turn on the bedroom lights (all bedrooms) / Turn on all lights / Turn on the living room fan / Set the living room fan speed to 4 / Turn off the dining room fan.* Fan speeds 1, 2, 3, 4 and 5 and OFF are all supported. If a named room has no fan the message says so and nothing else changes.
* **One Smart Home system.** Spoken text goes through `VrEngine.handleCommand` -> the existing `parseCommand` / `SmartHouseState.execute` -> the same lights, `FanModel`, panel, 3D blades and energy meter used by the buttons, wall switches, controller rays, desktop and typed commands.
* **Stops with VR.** Leaving VR (Exit VR, the session ending, leaving the page) aborts the recogniser, clears every timer and shows nothing; a late result from the old recogniser is ignored. Re-entering VR starts a fresh recogniser (the permission is checked again).

## Wake phrase ("Hey Home") - approach and requirements
There is no on-device wake-word engine in a browser page (that needs a native or WASM engine, often with a licence key, running on the raw audio). Instead the wake phrase is matched **in the recognised text** of the same Web Speech recogniser:

* *Requirements:* the browser's `SpeechRecognition` must be available and **listening continuously** (so the recogniser, and in Chromium-based browsers the vendor's online speech service, is active the whole time, not only after a trigger), a working microphone, and internet access for the online service.
* **Default: optional.** "Hey Home, turn on the living room lights" and "Turn on the living room lights" both work. Accepted wake phrases: *hey home, hi home, ok home, okay home, hey smart home*; they are stripped before parsing.
* **Opt-in: required.** The desktop page has the checkbox "Only act on commands that start with Hey Home" (remembered in the browser). Then plain commands are ignored; "Hey Home" alone arms the next phrase for 8 seconds.
* Consequence to be aware of: because recognition runs all the time, a wake phrase does **not** reduce what the microphone hears; it only reduces what the app acts on.

## Status indicator and controls
* **VR:** a small head-locked pill low in the view (about 30 cm wide at 0.6 m): *Listening*, *Hearing: ...*, *Processing command...*, *OK: <what happened>* (3 s), *Mic muted*, *Microphone unavailable (permission)*, *Voice stopped*, *Voice recognition unsupported*. It is shown only in VR and only when there is something to say; the Smart Home panel does not need to be open.
* **Mute / resume:** the **MIC** button on the Smart Home panel (MIC: LISTENING / MUTED / START / N/A), the **left thumbstick click**, or (desktop) the *hands-free* button. Muting releases the recogniser; nothing restarts it until you resume.
* The existing push-to-talk (*Speak* button / right B) still works; if hands-free is on it reports "already listening", if it is muted it resumes it, and two recognisers never run at once.

## Privacy and security
* The microphone is requested only when VR starts (or when you press the hands-free button) and is never opened silently. The permission probe stream is closed immediately; the app never records, stores or sends audio itself.
* **Chrome-based browsers send audio to the browser vendor's online speech service while recognition is on.** The desktop page says so next to the control. Mute or leave VR to stop it.
* A permission withdrawn while listening (Permissions API change event, or a `not-allowed` recognition error) stops listening and shows the reason.

## Browser / Meta Quest Browser compatibility - what is and is not known
* The code feature-detects `SpeechRecognition` / `webkitSpeechRecognition`, a secure (https) page and the microphone. If any is missing the status is "Voice recognition unsupported" with the reason, the MIC button is disabled, and everything else (panel, wall switches, controller rays, typed commands) keeps working. A Quest Browser user agent is recognised and the message adds that hands-free recognition is **not verified there**.
* Reports from Quest developers say the Meta Quest Browser may not expose the Web Speech API, and nobody has verified continuous recognition inside an immersive session. **Continuous listening is not claimed to work on Quest because it works in desktop Chromium.** Please test on the headset and report what the status pill says.

## Files
`src/vr/continuousVoice.ts` (lifecycle, wake phrase, status text), `src/vr/VrEngine.ts` (start/stop with VR, pill, MIC control), `src/vr/smart/voice.ts` (status board: *muted*), `src/vr/smart/panel.ts` (MIC button), `src/pages/VrViewer.tsx` (desktop controls and privacy note).
Tests: `dev/check_voice_continuous.ts` (unit, fake recogniser and virtual clock), `dev/e2e_voice.cjs` (desktop browser + mocked WebXR, scripted speech).
