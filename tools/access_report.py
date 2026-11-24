"""Builds docs/VR_ACCESSIBILITY_REPORT.md from the JSON written by frontend-react/dev/audit_access.cjs (one file per layout, after the fixes)
and, when given, the same audit run on the build before the fixes.  Also runs the backend circulation rules (planner/architect/circulation.py) over each
stored plan and over the plan the VR model was built from (assumed doors included).

usage: python tools/access_report.py AFTER_DIR [BEFORE_FROM_START_DIR [BEFORE_FROM_OUTSIDE_DIR]] > report.md      (run from the repository root)
"""
import glob, json, os, sys

sys.path.insert(0, os.getcwd())
try:
    from backend.planner.architect.circulation import analyse_building
except Exception:                                    # pragma: no cover
    analyse_building = None

FIX = 'frontend-react/dev/fixtures'


def backend(plan):
    if analyse_building is None or plan is None:
        return 'n/a'
    try:
        r = analyse_building(plan)
    except Exception:
        return 'n/a'
    return 'pass' if r['passed'] else f"{len(r['issues'])} issue(s)"


def load(d):
    out = {}
    for f in sorted(glob.glob(os.path.join(d, '*.json'))):
        j = json.load(open(f))
        out[j['name']] = j
    return out


def fmt_rooms(rs):
    return ', '.join(f"{r['key']}" for r in rs) or '-'


def main():
    after = load(sys.argv[1])
    before = load(sys.argv[2]) if len(sys.argv) > 2 else {}
    before_out = load(sys.argv[3]) if len(sys.argv) > 3 else {}
    rows = []
    tot = dict(layouts=0, rooms=0, unr_a=0, unr_b=0, lay_ok_a=0, lay_ok_b=0, door_a=0, door_b=0, entr_a=0, entr_b=0, added=0, through=0, bed0=0, retried=0, floors_a=0)
    for name, a in after.items():
        A = a['audit']
        b = before.get(name)
        B = b['audit'] if b else None
        src = 'fresh (backend /generate)' if name.startswith(('fresh_', 'gen2_')) else 'stored sample'
        pl = json.load(open(f'{FIX}/{name}.json'))
        orig_circ = backend(pl)
        rep_circ = backend(a.get('repaired')) if a.get('repaired') else orig_circ
        un_a = [r for r in A['rooms'] if not r['reached']]
        un_b = [r for r in B['rooms'] if not r['reached']] if B else None
        entr_a = A['entranceToSpawn']
        bo = before_out.get(name)
        entr_b = bo['audit']['entranceToSpawn'] if bo else None
        out_unr_b = len([r for r in bo['audit']['rooms'] if not r['reached']]) if bo else None
        bedless = [r['room'] for r in a['rooms'] if 'bedroom' in r['type'] and r['seats'] == 0]
        retried = sum(1 for r in a['rooms'] if r['attempts'] > 1)
        floors_ok = all(A['floorsReached'])
        ok_a = not un_a and not A['doorFailures'] and entr_a is not False and floors_ok
        ok_b = None if B is None else (not un_b and not B['doorFailures'] and entr_b is not False and all(B['floorsReached']))
        tot['layouts'] += 1; tot['rooms'] += len(A['rooms'])
        tot['unr_a'] += len(un_a); tot['lay_ok_a'] += ok_a; tot['door_a'] += len(A['doorFailures']); tot['entr_a'] += entr_a is not False; tot['floors_a'] += floors_ok
        if B is not None:
            tot['unr_b'] += len(un_b); tot['lay_ok_b'] += bool(ok_b); tot['door_b'] += len(B['doorFailures']); tot['entr_b'] += entr_b is not False
        tot['added'] += len(a['plan']['added']); tot['through'] += len(a['plan']['through']); tot['bed0'] += len(bedless); tot['retried'] += retried
        rows.append(dict(name=name, src=src, floors=len(A['floorsReached']), rooms=len(A['rooms']), un_b=un_b, un_a=un_a, entr_b=entr_b, out_unr_b=out_unr_b, entr_a=entr_a,
                         df_b=None if B is None else len(B['doorFailures']), df_a=len(A['doorFailures']), added=a['plan']['added'], through=a['plan']['through'], unres=a['plan']['unresolved'],
                         retried=retried, bedless=bedless, circ0=orig_circ, circ1=rep_circ, ok_a=ok_a, ok_b=ok_b))
    P = print
    P('# VR walkability and accessibility report\n')
    P('Every layout below was built exactly the way the VR page builds a house (plan -> twin -> GLB -> loader -> collision grid) and audited with a breadth-first search over the SAME collision grid and movement code the VR walker uses (0.15 ft lattice, body radius 0.3 ft; no teleport, no floor buttons). A room counts as reached only if the search, starting OUTSIDE the front door, gets to standing places inside it; each reached room is then re-walked with `NavGrid.move`. A door counts as usable only when its opening and both sides are reached.\n')
    P('Desktop / headless Chromium (software GL) only. **Nothing here was run on a Meta Quest.**\n')
    P('## Totals\n')
    P('| | before the fixes | after the fixes |\n|---|---|---|')
    have = bool(before)
    P(f"| layouts audited | {len(before) if have else '-'} | {tot['layouts']} |")
    P(f"| rooms audited | - | {tot['rooms']} |")
    P(f"| layouts where EVERY room is reached on foot from the front door, every door usable, every floor reached | {tot['lay_ok_b'] if have else '-'} / {len(before) if have else '-'} | {tot['lay_ok_a']} / {tot['layouts']} |")
    P(f"| rooms NOT reachable on foot (before: counted from the VR start point inside the house; after: counted from OUTSIDE the front door, which is stricter) | {tot['unr_b'] if have else '-'} | {tot['unr_a']} |")
    P(f"| plan doors that cannot be walked through | {tot['door_b'] if have else '-'} | {tot['door_a']} |")
    P(f"| layouts where the walk from outside the front door does not reach the start point | {(len(before) - tot['entr_b']) if have else '-'} | {tot['layouts'] - tot['entr_a']} |")
    P(f"| assumed doors added to the walking model (plan stays unchanged) | - | {tot['added']} |")
    P(f"| rooms reached only by walking THROUGH a bathroom / bedroom / balcony / terrace (walkable, circulation not valid) | - | {tot['through']} |")
    P(f"| bedrooms left without a bed to keep a doorway clear | - | {tot['bed0']} |")
    P(f"| rooms whose furniture had to be re-arranged (retry) | - | {tot['retried']} |\n")
    P('## Every layout\n')
    P('`before` = the build delivered before this work (same audit, same layouts). `circ` = the backend circulation rules (`planner/architect/circulation.py`) on the stored plan -> on the plan the VR model uses. "assumed doors" = doors the VR walking model added because the plan had no door for the room (the stored plan is never changed).\n')
    P('| layout | source | floors | rooms | unreached before (from start point) | unreached before (from outside) | unreached after (from outside) | doors unusable before -> after | start reached before -> after | assumed doors added | via dead end | rooms re-furnished | bedless | circ | result |')
    P('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for r in rows:
        ub = fmt_rooms(r['un_b']) if r['un_b'] is not None else '-'
        ad = '; '.join(f"{d['floor']}:{d['room']}→{d['to']}" for d in r['added']) or '-'
        P(f"| {r['name']} | {r['src']} | {r['floors']} | {r['rooms']} | {ub} | {r['out_unr_b'] if r['out_unr_b'] is not None else '-'} | {fmt_rooms(r['un_a'])} | {r['df_b'] if r['df_b'] is not None else '-'} → {r['df_a']} | {r['entr_b'] if r['entr_b'] is not None else '-'} → {r['entr_a']} | {ad} | {', '.join(r['through']) or '-'} | {r['retried']} | {', '.join(r['bedless']) or '-'} | {r['circ0']} → {r['circ1']} | {'WALKABLE' if r['ok_a'] else 'FAIL'} |")


main()
