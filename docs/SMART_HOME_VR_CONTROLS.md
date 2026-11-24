# Smart Home controls in VR and on the desktop (fans, lights, voice)

Everything below drives ONE state (`SmartHouseState`): the wall switches, the ceiling fan, the floating panel, the voice commands and the desktop mouse/keyboard all read and write it, so they cannot disagree.

## Ceiling fan
* **Point at a ceiling fan** with a controller: it highlights. **Trigger** toggles it ON / OFF (ON restores the last speed, first time speed 3).
* A small control opens beside the fan: **OFF | 1 | 2 | 3 | 4 | 5**. Point and press the trigger on a speed. It hides itself after a few seconds.
* The floating Smart House panel has a fan strip with the same OFF / ON / 1 / 2 / 3 / 4 / 5 buttons for the room you are in (or the nearest fan).
* Only the **blades** rotate (the motor housing and downrod stay still). Speeds are visibly different:

| Level | Blade speed (steady) | Angular speed |
|---|---|---|
| 1 | 90 rpm | 540 °/s |
| 2 | 140 rpm | 840 °/s |
| 3 | 190 rpm | 1140 °/s |
| 4 | 240 rpm | 1440 °/s |
| 5 | 300 rpm | 1800 °/s |
(Level 0 = stopped.) Speed 4 is faster than 3 and slower than 5, and it is a real level of the fan state (`MAX_FAN_LEVEL = 5`), so the panel strip, the fan popup, the keyboard (key 4), the voice command "Set fan speed to 4" and the regulator + / − all give the same result. It works inside an immersive session without leaving VR. The speed ramps up and down smoothly (`fan.ts`, frame-rate independent).

## Desktop parity
* Click a fan, a wall switch or a regulator with the mouse. Keyboard: **F** toggles the nearest fan, **0 1 2 3 4 5** set its speed (ignored while typing in a text box).

## Lights
* Wall switches, the panel's per-room buttons and *ALL ON / ALL OFF*, voice commands, and motion lighting in the bedroom / staircase all use the same light bank.

## Voice (browser speech recognition, when the browser offers it)
"fan on", "fan off", "fan speed 1/2/3/4/5" (and the room-specific forms), "light on", "light off", "turn on all lights", "turn off all lights", "fan in the bedroom ..." - each is shown on the panel's status line as it is heard and as it is carried out.
If the microphone is denied or the browser has no speech recognition, the panel says so and every control above still works. (The Quest Browser's speech recognition support is **not** confirmed.)

## Tested vs not tested
* Tested automatically: 44 unit tests of the model, the voice grammar, the panel layout and the fan popup; browser tests on real pages for mouse, keyboard and panel; mocked-WebXR tests with a posed controller ray pressing the fan and each speed.
* **Not tested:** on a real Quest 2 (ray accuracy, haptics, speech recognition in the headset), and no frame-rate claim.

## Hands-free voice (added)
Entering VR starts continuous listening (microphone permission is requested explicitly). The Smart Home panel has a **MIC** button (LISTENING / MUTED / START / N/A) and the **left thumbstick click** toggles mute/resume. A small status pill shows Listening / Processing / result / unavailable messages without opening the panel. Full details, the wake phrase ("Hey Home", optional) and the Quest-compatibility caveats: `docs/HANDS_FREE_VOICE.md`. The Speak button / right B push-to-talk still works.
