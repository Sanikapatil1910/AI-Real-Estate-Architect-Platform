# VR walkability and accessibility report

Every layout below was built exactly the way the VR page builds a house (plan -> twin -> GLB -> loader -> collision grid) and audited with a breadth-first search over the SAME collision grid and movement code the VR walker uses (0.15 ft lattice, body radius 0.3 ft; no teleport, no floor buttons). A room counts as reached only if the search, starting OUTSIDE the front door, gets to standing places inside it; each reached room is then re-walked with `NavGrid.move`. A door counts as usable only when its opening and both sides are reached.

Desktop / headless Chromium (software GL) only. **Nothing here was run on a Meta Quest.**


## What was wrong (root causes found by the audit)

1. **Pockets inside rooms.** A bed and a wardrobe could leave a ~0.7 ft crack beside an open door leaf. The doorway of an en-suite bathroom then belonged to a sealed part of the bedroom, so the bathroom could not be walked to, although every rectangle looked fine on the plan.
2. **A corridor door folded across another door.** The open leaf of a corridor door was hinged 0.5 ft from the wall that held the bathroom door, so it lay across that doorway (found on a freshly generated plan, `gen2_16`).
3. **The front door was shut by the compound gate** on plans without a front setback (closed bars across the door), and by the compound wall on uploaded plans whose main door is not on the road side.
4. **The start point could be on furniture** (a sofa top counted as standable), which cut the start point off from the rest of the house.
5. **Uploaded plans without doors.** The two `upload_demo*` samples simply have no door for the bathroom and the master bedroom.
6. **Stored legacy samples whose circulation is invalid:** rooms (up to 12 in one plan) can only be reached through a bathroom, a bedroom, a balcony or a terrace.

## What was changed

* **Validation after furniture placement** (`twinAccess.ts`, `twinInterior.ts`): after a room is furnished, the walkable space is computed (0.25 ft grid) from the walls, the open door leaves, the claimed footprints AND the bounding boxes of every piece actually drawn, each kept a clear walking margin away. Every doorway must connect to every other doorway of the room and be enterable. A failure re-furnishes the room with corridors reserved between the doorways (narrower each time, never piled up) and validates again; a bedroom that loses its bed keeps retrying with narrower corridors. A room that still fails is logged as failed (none did).
* **Door leaves** (`twinDoorsStairs.ts`, `twinFloor.ts`): one shared hinge rule is used by the drawn door and by the furniture planner, so the leaf that is drawn is the leaf that is kept clear. A leaf is never hinged where it would fold across another doorway. In the walking model leaves stand open at 90°, square to the wall.
* **Front door** (`twinBuild.ts`): in the walking model the front gate stands open; the compound wall gets a pedestrian opening in front of a main door that is not on the road side. The viewer model is unchanged.
* **Plan-level door repair** (`planAccess.ts`): builds the door graph (doors, stairs between stacked staircases), starts at the front door and adds a door only where a room has none. Rules: bathrooms, balconies and terraces are dead ends (nobody walks through them), a car bay is not a corridor, open-air rooms (courtyard, garden, terrace) need no door, a bathroom already joined to a cut-off bedroom waits for it. Added doors are marked `source: assumed_access`, listed in the report and in a notice on the VR page; **the stored plan is never changed.** (The upload import used to promise it never invents doors; this is applied only to the walking model, and is disclosed.)
* **Start point** (`houseLoader.ts`): a spot on the floor of the living room with a free foot of floor around it, not a seat or a bed.
* **Strict audit** (`access.ts`): breadth-first search over the real collision grid (same `canStand` / `move` as the VR walker), starting OUTSIDE the front door. Wall and furniture collisions are **not** disabled anywhere.
* **Backend:** the existing planner circulation rules (`planner/architect/circulation.py`, used by the generator's `verify_plan`) already reject plans that route through bathrooms and bedrooms; every one of the 68 plans generated for this audit passes them. They are unchanged.

## Results in short

* **89 / 89 layouts walkable** from outside the front door to every room on every floor (previous build: 29 / 89 counted from the VR start point). 0 rooms unreachable, 0 unusable plan doors.
* All 68 freshly generated layouts also pass the backend circulation rules. 7 older stored samples do not (33 rooms are reached only through a bathroom, bedroom, balcony or terrace); they are walkable but should be regenerated, and the VR page says so. The assumed doors do not make those plans valid for the backend rules — they only make the model walkable.
* 97 rooms had their furniture re-arranged to keep doorways clear; 1 bedroom (`pk_g1`, first floor, 10 × 13 ft with three doors) ended without a bed because no bed position kept all its doorways clear.
* Honest limits: this is a desktop audit of the collision model on 89 layouts, not a proof for every possible plan; the "comfortable" 0.8 ft margin is not met in most furnished rooms (the hard minimum is a 1.4 ft clear gap, the walker needs 0.6 ft); small pieces tucked into corners can have a boxed-in front (they are reported in the log, not a walking problem). **Nothing was run on a Meta Quest.**

## Totals

| | before the fixes | after the fixes |
|---|---|---|
| layouts audited | 89 | 89 |
| rooms audited | - | 1145 |
| layouts where EVERY room is reached on foot from the front door, every door usable, every floor reached | 29 / 89 | 89 / 89 |
| rooms NOT reachable on foot (before: counted from the VR start point inside the house; after: counted from OUTSIDE the front door, which is stricter) | 148 | 0 |
| plan doors that cannot be walked through | 179 | 0 |
| layouts where the walk from outside the front door does not reach the start point | 36 | 0 |
| assumed doors added to the walking model (plan stays unchanged) | - | 8 |
| rooms reached only by walking THROUGH a bathroom / bedroom / balcony / terrace (walkable, circulation not valid) | - | 33 |
| bedrooms left without a bed to keep a doorway clear | - | 1 |
| rooms whose furniture had to be re-arranged (retry) | - | 97 |

## Every layout

`before` = the build delivered before this work (same audit, same layouts). `circ` = the backend circulation rules (`planner/architect/circulation.py`) on the stored plan -> on the plan the VR model uses. "assumed doors" = doors the VR walking model added because the plan had no door for the room (the stored plan is never changed).

| layout | source | floors | rooms | unreached before (from start point) | unreached before (from outside) | unreached after (from outside) | doors unusable before -> after | start reached before -> after | assumed doors added | via dead end | rooms re-furnished | bedless | circ | result |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cf_bad_terrace_route | stored sample | 2 | 18 | 0:bath_2, 1:bath_3 | 18 | - | 3 → 0 | False → True | - | 1:bedroom_2, 1:bath_3, 1:balcony_1, 1:master_bedroom, 1:bath_master | 2 | - | 6 issue(s) → 6 issue(s) | WALKABLE |
| cf_g1_terrace | stored sample | 2 | 13 | 1:bath_master | 13 | - | 2 → 0 | False → True | - | - | 1 | - | pass → pass | WALKABLE |
| cf_g1_wide | stored sample | 2 | 12 | - | 12 | - | 1 → 0 | False → True | - | - | 1 | - | pass → pass | WALKABLE |
| cf_g2 | stored sample | 3 | 19 | 0:bath_2 | 19 | - | 2 → 0 | False → True | - | - | 3 | - | pass → pass | WALKABLE |
| fresh_25x45_g1_wada_p0 | fresh (backend /generate) | 2 | 11 | - | 11 | - | 1 → 0 | False → True | - | - | 0 | - | pass → pass | WALKABLE |
| fresh_25x45_g1_wada_p1 | fresh (backend /generate) | 2 | 11 | - | 11 | - | 1 → 0 | False → True | - | - | 0 | - | pass → pass | WALKABLE |
| fresh_30x30_g1_p0 | fresh (backend /generate) | 2 | 9 | - | 9 | - | 1 → 0 | False → True | - | - | 0 | - | pass → pass | WALKABLE |
| fresh_30x30_g1_p1 | fresh (backend /generate) | 2 | 9 | - | 9 | - | 1 → 0 | False → True | - | - | 0 | - | pass → pass | WALKABLE |
| fresh_30x40_g_p0 | fresh (backend /generate) | 1 | 7 | - | 7 | - | 1 → 0 | False → True | - | - | 0 | - | pass → pass | WALKABLE |
| fresh_30x40_g_p1 | fresh (backend /generate) | 1 | 7 | - | 7 | - | 1 → 0 | False → True | - | - | 0 | - | pass → pass | WALKABLE |
| fresh_35x50_g1_p0 | fresh (backend /generate) | 2 | 11 | - | 11 | - | 1 → 0 | False → True | - | - | 0 | - | pass → pass | WALKABLE |
| fresh_35x50_g1_p1 | fresh (backend /generate) | 2 | 11 | - | 11 | - | 1 → 0 | False → True | - | - | 0 | - | pass → pass | WALKABLE |
| fresh_36x48_g1_trad_p0 | fresh (backend /generate) | 2 | 12 | - | 12 | - | 1 → 0 | False → True | - | - | 1 | - | pass → pass | WALKABLE |
| fresh_36x48_g1_trad_p1 | fresh (backend /generate) | 2 | 12 | - | 12 | - | 1 → 0 | False → True | - | - | 1 | - | pass → pass | WALKABLE |
| fresh_40x60_g2_vastu_p0 | fresh (backend /generate) | 3 | 14 | - | 14 | - | 1 → 0 | False → True | - | - | 0 | - | pass → pass | WALKABLE |
| fresh_40x60_g2_vastu_p1 | fresh (backend /generate) | 3 | 14 | - | 14 | - | 1 → 0 | False → True | - | - | 0 | - | pass → pass | WALKABLE |
| fresh_45x55_g2_terrace_p0 | fresh (backend /generate) | 3 | 14 | - | 14 | - | 0 → 0 | False → True | - | - | 0 | - | pass → pass | WALKABLE |
| fresh_45x55_g2_terrace_p1 | fresh (backend /generate) | 3 | 14 | - | 14 | - | 0 → 0 | False → True | - | - | 0 | - | pass → pass | WALKABLE |
| fresh_50x70_g1_garden_p0 | fresh (backend /generate) | 2 | 13 | - | 0 | - | 1 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| fresh_50x70_g1_garden_p1 | fresh (backend /generate) | 2 | 13 | - | 0 | - | 1 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| g1_0 | stored sample | 2 | 16 | - | 0 | - | 0 → 0 | True → True | 0:kitchen→living_room | - | 2 | - | 6 issue(s) → 7 issue(s) | WALKABLE |
| g1_1 | stored sample | 2 | 16 | 1:bath_master | 1 | - | 1 → 0 | True → True | 0:kitchen→living_room | 1:bath_3, 1:bedroom_2 | 3 | - | 9 issue(s) → 10 issue(s) | WALKABLE |
| g2_0 | stored sample | 3 | 24 | 1:bath_master | 0 | - | 1 → 0 | True → True | - | 0:bath_common_1, 0:lounge_fill, 1:passage_889028 | 2 | - | 3 issue(s) → 3 issue(s) | WALKABLE |
| g2_1 | stored sample | 3 | 24 | 1:passage_889028 | 0 | - | 1 → 0 | True → True | - | 0:bath_common_1, 0:lounge_fill, 1:passage_889028 | 2 | - | 3 issue(s) → 3 issue(s) | WALKABLE |
| gen2_00_p0 | fresh (backend /generate) | 3 | 18 | 0:dining, 0:kitchen, 0:staircase, 0:passage_324318, 0:bedroom_4, 0:bath_2, 1:bedroom_2, 1:bath_3, 1:study, 1:corridor_1, 1:staircase, 1:bath_master, 1:master_bedroom, 2:corridor_2, 2:staircase, 2:bath_4, 2:bedroom_3 | 0 | - | 18 → 0 | False → True | - | - | 2 | - | pass → pass | WALKABLE |
| gen2_00_p1 | fresh (backend /generate) | 3 | 18 | 0:dining, 0:kitchen, 0:staircase, 0:passage_324318, 0:bedroom_4, 0:bath_2, 1:bedroom_2, 1:bath_3, 1:study, 1:corridor_1, 1:staircase, 1:bath_master, 1:master_bedroom, 2:corridor_2, 2:staircase, 2:bath_4, 2:bedroom_3 | 0 | - | 18 → 0 | False → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_01_p0 | fresh (backend /generate) | 2 | 14 | - | 0 | - | 0 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_01_p1 | fresh (backend /generate) | 2 | 14 | - | 0 | - | 0 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_02_p0 | fresh (backend /generate) | 1 | 13 | - | 0 | - | 0 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_02_p1 | fresh (backend /generate) | 1 | 13 | - | 0 | - | 0 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_03_p0 | fresh (backend /generate) | 1 | 12 | 0:bath_master, 0:bath_2 | 1 | - | 2 → 0 | True → True | - | - | 3 | - | pass → pass | WALKABLE |
| gen2_03_p1 | fresh (backend /generate) | 1 | 12 | 0:bath_2 | 1 | - | 1 → 0 | True → True | - | - | 3 | - | pass → pass | WALKABLE |
| gen2_04_p0 | fresh (backend /generate) | 1 | 6 | - | 0 | - | 0 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_04_p1 | fresh (backend /generate) | 1 | 6 | 0:bath_master | 1 | - | 1 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_05_p0 | fresh (backend /generate) | 1 | 9 | - | 0 | - | 0 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_05_p1 | fresh (backend /generate) | 1 | 9 | - | 0 | - | 0 → 0 | True → True | - | - | 2 | - | pass → pass | WALKABLE |
| gen2_06_p0 | fresh (backend /generate) | 2 | 12 | 1:bath_master | 1 | - | 1 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_06_p1 | fresh (backend /generate) | 2 | 12 | 1:bath_master | 1 | - | 1 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_07_p0 | fresh (backend /generate) | 2 | 15 | - | 0 | - | 0 → 0 | True → True | - | - | 2 | - | pass → pass | WALKABLE |
| gen2_07_p1 | fresh (backend /generate) | 2 | 15 | - | 0 | - | 0 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_09_p0 | fresh (backend /generate) | 3 | 14 | - | 0 | - | 1 → 0 | True → True | - | - | 3 | - | pass → pass | WALKABLE |
| gen2_09_p1 | fresh (backend /generate) | 3 | 14 | - | 0 | - | 1 → 0 | True → True | - | - | 3 | - | pass → pass | WALKABLE |
| gen2_10_p0 | fresh (backend /generate) | 1 | 9 | 0:bath_master | 1 | - | 1 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_10_p1 | fresh (backend /generate) | 1 | 9 | - | 0 | - | 0 → 0 | True → True | - | - | 2 | - | pass → pass | WALKABLE |
| gen2_11_p0 | fresh (backend /generate) | 3 | 13 | 0:staircase, 0:dining, 0:kitchen, 0:corridor_0, 1:staircase, 1:master_bedroom, 1:bath_master, 1:corridor_1, 2:staircase, 2:bedroom_2, 2:bath_2, 2:corridor_2 | 0 | - | 12 → 0 | False → True | - | - | 0 | - | pass → pass | WALKABLE |
| gen2_11_p1 | fresh (backend /generate) | 3 | 13 | - | 0 | - | 0 → 0 | True → True | - | - | 0 | - | pass → pass | WALKABLE |
| gen2_12_p0 | fresh (backend /generate) | 1 | 11 | - | 0 | - | 0 → 0 | True → True | - | - | 0 | - | pass → pass | WALKABLE |
| gen2_12_p1 | fresh (backend /generate) | 1 | 11 | 0:bath_2 | 1 | - | 1 → 0 | True → True | - | - | 0 | - | pass → pass | WALKABLE |
| gen2_13_p0 | fresh (backend /generate) | 2 | 14 | 1:bath_master | 14 | - | 2 → 0 | False → True | - | - | 2 | - | pass → pass | WALKABLE |
| gen2_13_p1 | fresh (backend /generate) | 2 | 13 | 0:bath_2, 1:bath_3 | 13 | - | 4 → 0 | False → True | - | - | 3 | - | pass → pass | WALKABLE |
| gen2_14_p0 | fresh (backend /generate) | 3 | 14 | 0:staircase, 0:corridor_0, 0:dining, 0:kitchen, 0:bath_common_1, 1:bedroom_2, 1:staircase, 1:corridor_1, 1:master_bedroom, 1:bath_master, 2:staircase, 2:corridor_2, 2:bedroom_3 | 0 | - | 14 → 0 | False → True | - | - | 0 | - | pass → pass | WALKABLE |
| gen2_14_p1 | fresh (backend /generate) | 3 | 14 | 0:staircase, 0:corridor_0, 0:dining, 0:kitchen, 0:bath_common_1, 1:bedroom_2, 1:staircase, 1:corridor_1, 1:master_bedroom, 1:bath_master, 2:staircase, 2:corridor_2, 2:bedroom_3 | 1 | - | 14 → 0 | False → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_15_p0 | fresh (backend /generate) | 1 | 9 | - | 0 | - | 0 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_15_p1 | fresh (backend /generate) | 1 | 9 | - | 0 | - | 0 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_16_p0 | fresh (backend /generate) | 3 | 14 | - | 14 | - | 1 → 0 | False → True | - | - | 0 | - | pass → pass | WALKABLE |
| gen2_16_p1 | fresh (backend /generate) | 3 | 14 | - | 14 | - | 1 → 0 | False → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_17_p0 | fresh (backend /generate) | 3 | 15 | 0:staircase, 0:kitchen, 0:dining, 0:bath_2, 0:bedroom_3, 0:corridor_0, 1:staircase, 1:bath_master, 1:master_bedroom, 1:corridor_1, 2:staircase, 2:bath_3, 2:bedroom_2, 2:corridor_2 | 0 | - | 13 → 0 | False → True | - | - | 0 | - | pass → pass | WALKABLE |
| gen2_17_p1 | fresh (backend /generate) | 3 | 15 | 0:staircase, 0:kitchen, 0:dining, 0:bath_2, 0:bedroom_3, 0:corridor_0, 1:staircase, 1:bath_master, 1:master_bedroom, 1:corridor_1, 2:staircase, 2:bath_3, 2:bedroom_2, 2:corridor_2 | 0 | - | 13 → 0 | False → True | - | - | 0 | - | pass → pass | WALKABLE |
| gen2_18_p0 | fresh (backend /generate) | 1 | 11 | 0:bath_2, 0:bath_master | 3 | - | 2 → 0 | True → True | - | - | 3 | - | pass → pass | WALKABLE |
| gen2_18_p1 | fresh (backend /generate) | 1 | 11 | - | 1 | - | 0 → 0 | True → True | - | - | 2 | - | pass → pass | WALKABLE |
| gen2_19_p0 | fresh (backend /generate) | 1 | 11 | - | 0 | - | 0 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_19_p1 | fresh (backend /generate) | 1 | 11 | - | 0 | - | 0 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_20_p0 | fresh (backend /generate) | 2 | 13 | - | 13 | - | 1 → 0 | False → True | - | - | 2 | - | pass → pass | WALKABLE |
| gen2_20_p1 | fresh (backend /generate) | 2 | 13 | - | 13 | - | 1 → 0 | False → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_21_p0 | fresh (backend /generate) | 1 | 11 | - | 0 | - | 0 → 0 | True → True | - | - | 0 | - | pass → pass | WALKABLE |
| gen2_21_p1 | fresh (backend /generate) | 1 | 11 | - | 0 | - | 0 → 0 | True → True | - | - | 2 | - | pass → pass | WALKABLE |
| gen2_22_p0 | fresh (backend /generate) | 3 | 15 | 1:bath_master | 1 | - | 1 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_22_p1 | fresh (backend /generate) | 3 | 15 | - | 0 | - | 0 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_23_p0 | fresh (backend /generate) | 1 | 11 | - | 0 | - | 0 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_23_p1 | fresh (backend /generate) | 1 | 11 | - | 0 | - | 0 → 0 | True → True | - | - | 0 | - | pass → pass | WALKABLE |
| gen2_24_p0 | fresh (backend /generate) | 2 | 14 | 1:bath_3 | 1 | - | 2 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_24_p1 | fresh (backend /generate) | 2 | 14 | 1:bath_3 | 1 | - | 2 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_25_p0 | fresh (backend /generate) | 3 | 15 | 1:bath_master | 1 | - | 1 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_25_p1 | fresh (backend /generate) | 3 | 15 | 0:dining, 0:passage_9723327, 0:bath_common_1, 0:utility, 0:kitchen, 0:staircase, 1:master_bedroom, 1:bath_master, 1:bedroom_2, 1:passage_9727840, 1:staircase, 2:bedroom_3, 2:passage_9720589, 2:staircase | 1 | - | 13 → 0 | False → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_26_p0 | fresh (backend /generate) | 1 | 12 | - | 0 | - | 0 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| gen2_26_p1 | fresh (backend /generate) | 1 | 12 | 0:bath_master | 1 | - | 1 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| pk_east | stored sample | 1 | 10 | - | 10 | - | 1 → 0 | False → True | 0:master_bedroom→kitchen | 0:corridor_0, 0:bedroom_2, 0:bath_2, 0:utility | 0 | - | 6 issue(s) → 7 issue(s) | WALKABLE |
| pk_g1 | stored sample | 2 | 17 | 1:bath_3 | 17 | - | 3 → 0 | False → True | - | 0:staircase, 0:lounge_fill, 0:bedroom_3, 0:bath_2, 1:staircase, 1:family_lounge_f1, 1:passage_126115, 1:bath_master, 1:master_bedroom, 1:bedroom_2, 1:bath_3, 1:balcony_1 | 3 | master_bedroom | 8 issue(s) → 8 issue(s) | WALKABLE |
| pk_south | stored sample | 1 | 10 | - | 10 | - | 1 → 0 | False → True | 0:master_bedroom→kitchen | 0:corridor_0, 0:bedroom_2, 0:bath_2, 0:utility | 0 | - | 6 issue(s) → 7 issue(s) | WALKABLE |
| sc_a_f50 | stored sample | 2 | 15 | - | 0 | - | 0 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| sc_b_f60 | stored sample | 2 | 15 | 0:bath_2, 1:bath_master | 2 | - | 2 → 0 | True → True | - | - | 2 | - | pass → pass | WALKABLE |
| sc_balcony | stored sample | 2 | 15 | - | 0 | - | 0 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| sc_car | stored sample | 2 | 14 | - | 0 | - | 0 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| sc_g2 | stored sample | 3 | 18 | - | 0 | - | 0 → 0 | True → True | - | - | 2 | - | pass → pass | WALKABLE |
| sc_g2_balcony | stored sample | 3 | 19 | 1:bath_master | 1 | - | 1 → 0 | True → True | - | - | 2 | - | pass → pass | WALKABLE |
| sc_terrace | stored sample | 2 | 15 | 1:bath_master | 1 | - | 1 → 0 | True → True | - | - | 1 | - | pass → pass | WALKABLE |
| upload_demo | stored sample | 1 | 5 | 0:bathroom_1, 0:master_bedroom_1 | 5 | - | 1 → 0 | False → True | 0:bathroom_1→bedroom_1; 0:master_bedroom_1→kitchen_1 | - | 1 | - | 4 issue(s) → 6 issue(s) | WALKABLE |
| upload_demo_margin | stored sample | 1 | 5 | 0:bathroom_1, 0:master_bedroom_1 | 2 | - | 0 → 0 | True → True | 0:bathroom_1→bedroom_1; 0:master_bedroom_1→kitchen_1 | - | 1 | - | 4 issue(s) → 6 issue(s) | WALKABLE |
| wada_court | stored sample | 1 | 14 | - | 0 | - | 0 → 0 | True → True | - | - | 0 | - | n/a → n/a | WALKABLE |
