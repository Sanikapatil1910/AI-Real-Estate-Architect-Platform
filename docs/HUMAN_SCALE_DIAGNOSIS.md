# Human-scale diagnosis (does the VR house feel the right size?)

**Method.** No blind enlargement. `frontend-react/dev/e2e_scale.cjs` loads the real house in the viewer and measures the loaded 3D model in metres. 29 checks passed on four
generated layouts (g2_0, g1_0, g2_1, g1_1), run in desktop Chromium. This is **not** a headset measurement.

## Measured (all four layouts gave the same dimensions unless noted)
| Item | Measured | Reasonable? |
|---|---|---|
| Floor-to-floor | 3.05 m | Yes (typical 2.7-3.2 m) |
| Clear ceiling height | 2.96 m | Yes, slightly generous |
| Door leaf height / width | 2.09 m / 0.74-1.19 m | Yes |
| Room sides (min / max) | 1.52 m / 4.57-5.64 m | Yes |
| Stairs | 21 risers, rise 145 mm, tread 300 mm | Comfortable |
| Home group scale | 0.3048 uniform (feet to metres), applied once | Correct |
| Player rig scale | 1 (never scaled) | Correct |
| Desktop eye height | 1.62 m | Correct |
| Extra eye offset in VR | 0 (the headset reports its own height; WebXR `local-floor`) | Correct |

**Conclusion:** no unit or scale bug was found, so nothing was enlarged or shrunk and the XR camera / rig is not scaled.

## One real finding (reported, not changed)
Seat heights measured from the furniture geometry (floor to seat top, metres): chair 0.53, sofa 0.59-0.63, bed 0.69-0.72, stool 0.69, bench 0.41.
Chairs, sofas and the bed are somewhat higher than the common 0.42-0.50 m (chair/sofa) and ~0.55-0.60 m (bed). In VR this can make sofas and chairs read as slightly
"tall"; room and door sizes are fine. I did not change the furniture assets because it would alter the baseline's tested clearance and walkability results; it is a candidate for a follow-up.

## Brightness (the "dark / spooky" part)
The previous default was a dusk (orange, low) environment. The default is now **daylight**: studio environment lighting, a day sky and a white hemisphere light.
The old look stays available as **EVENING** (History tab, or the lighting toggle on the viewer page). Layouts, geometry and navigation are unchanged.
Verified: automated render/probe checks in desktop Chromium and screenshots. **Not verified:** how bright it looks inside a Quest 2 (display, tone mapping and headset exposure differ).

## What needs a headset
* Whether the floor lines up with the real floor (the Quest's own floor calibration).
* Whether the house *feels* human-scale to you; if it does not, say which dimension and the measurements above show where to look.
