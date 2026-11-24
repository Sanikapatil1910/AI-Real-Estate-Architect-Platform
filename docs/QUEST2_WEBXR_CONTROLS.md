# Smart House VR — controls (Meta Quest 2 browser, WebXR)

## Moving
| Input | Action |
|---|---|
| Your head / body | Look and lean in place (the headset is tracked by the browser). Real walking is tracked within your play area. |
| **Left thumbstick** | Walk (relative to where you are looking). Walls, furniture edges and floor edges stop you. Steps/stairs are climbed when the geometry allows. |
| **Right thumbstick** (flick left/right) | Snap-turn 30°. |
| **Right thumbstick pushed forward**, then released | **Teleport.** While you hold it, a green arc leaves the right controller and a ring shows where you will land (red = you cannot land there: a wall, a ceiling, furniture or a table top is in the way). Release to go: the view blinks (dims 0.12 s, moves, brightens 0.2 s) and you are standing at the ring. Pull the stick **back** to cancel. Works on every floor and on the stairs; to reach an upper floor stand on the stairs / landing, or aim down onto it. |
| Panel **GO** button | Teleports to a room (a backup, an "unstuck" tool). |
| Panel **Go G / Go 1F …** | Teleports to a floor (a backup). |
| Stairs | Walk up and down the generated staircase with the left stick (every flight the generator draws: straight, L, U, double-L, spiral). |

## Sitting
Small blue discs appear on the seats near you (sofa cushions, armchairs, dining and desk chairs, the foot of a bed, the bench at the end of a bed, kitchen stools).
Point a controller at a disc and pull the **trigger** to sit (or panel **SIT NEAREST**, which takes the nearest seat in front of you). Your view drops to about 75 cm above the seat and you face the way the seat faces.
**To stand up:** push the left stick (walking stands you up first), press panel **STAND UP**, or teleport / use **GO**. You return to where you were standing when that spot is free, otherwise to free floor in front of / beside the seat.
Height: the lowering is worked out from your headset height at the moment you sit. If you physically sit on a real chair, press **SIT NEAREST** again (it says *Seat height re-set*) and the height is recalibrated.

## Smart House control panel (floating, 1 m in front of you)
| Input | Action |
|---|---|
| **Left Y** | Show / hide the panel. |
| **Left X** | Bring the panel back in front of you. |
| Point a controller at a button, press the **trigger** | Press that button (the controller buzzes). |

Panel buttons: **ALL LIGHTS ON / ALL LIGHTS OFF**, **AUTO LIGHTS** (simulated motion detection), per-room **LIGHT** toggles, per-room fan **−  FAN n (rpm)  +** (levels 0–5), **◀ ▶** pages,
**Go G / Go 1F**, **GO** (per room), **EXIT VR**, **Close**, a *simulated* energy read-out (watts now, Wh this session) and the voice status line.

## In-world switches
Every room has a wall **light switch** plate and (where it has a ceiling fan) a **fan regulator** plate at hand height near a door.
Point and pull the trigger: switch = toggle the light; regulator upper half **+** / lower half **−** = fan speed 0–5. The blades visibly spin faster with each level
(90 / 140 / 190 / 240 / 300 rpm — a modelled speed, not a measurement of a real fan).

## Automatic lighting (simulated motion detection)
Panel → **AUTO LIGHTS: ON**: entering a room turns its light on; leaving turns it off after 30 s. A room you switched **manually** keeps that state while you are in it (manual overrides automatic).
Off by default. It is a simulation: "motion" is you being inside the room.

## Energy panel
Simulated: 9 W per light and 0/18/28/40/55/75 W per fan level; Wh accumulates while you are in the session. It is labelled *Simulated* on the panel. It is not a measurement.

## Voice
Push-to-talk is **right B**, only if the browser offers speech recognition. If it does not, the page and the panel say *"Microphone unavailable"* with the reason and every manual control keeps working.
See the voice section of `docs/QUEST2_WEBXR_COMPATIBILITY.md`.
Commands understood (typed or spoken, English): "turn on / off the kitchen light", "all lights on/off", "fan level 3 in the living room", "turn off all fans", "show / hide panel", …

## Desktop fallback (no headset / WebXR unavailable)
Drag to look, **W A S D** or arrow keys to move (**Shift** faster), click the wall plates, use the Smart House panel beside the view, or type a command in the box.
**T** (hold, then release) teleports to the green marker the arc shows (Esc cancels). **E** sits on the nearest seat in front of you and stands up again; walking (W/S) also stands you up; click a blue disc to sit on that seat.
Typed commands also understand "sit down" and "stand up".
