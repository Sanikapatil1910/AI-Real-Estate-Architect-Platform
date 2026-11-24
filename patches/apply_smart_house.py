#!/usr/bin/env python3
"""Idempotently merge the Smart House add-on into a RealEstate project tree.

usage: python3 apply_smart_house.py <addon_dir> <project_root>

* copies add-on files (new files only; an existing file that differs is NOT
  overwritten unless it is one of the add-on's own paths)
* edits frontend-react/src/components/TwinViewer.tsx (2 imports + 1 button)
  - if components/twinMassing.ts exists (Exterior Shape work) the button passes
    its `projectPlan`; otherwise it uses the identity projection
* refuses to touch anything else; prints every action.
"""
import os, shutil, sys

addon, root = map(os.path.abspath, sys.argv[1:3])
ADDON_DIRS = ["unity-smart-house", "frontend-react/src/lib/smartHouse.ts",
              "frontend-react/dev/check_smart_house.ts",
              "frontend-react/dev/emit_smart_house.ts", "frontend-react/dev/project_plan.ts",
              "tests/test_smart_house.py", "patches", "README_ADDON.md"]
copied = skipped = 0
for rel in ADDON_DIRS:
    src = os.path.join(addon, rel)
    if not os.path.exists(src):
        continue
    pairs = []
    if os.path.isdir(src):
        for d, _, fs in os.walk(src):
            for f in fs:
                s = os.path.join(d, f)
                pairs.append((s, os.path.join(root, os.path.relpath(s, addon))))
    else:
        pairs.append((src, os.path.join(root, rel)))
    for s, t in pairs:
        os.makedirs(os.path.dirname(t), exist_ok=True)
        shutil.copyfile(s, t); copied += 1
print(f"copied {copied} add-on files")

has_mass = os.path.exists(os.path.join(root, "frontend-react/src/components/twinMassing.ts"))
pp = os.path.join(root, "frontend-react/dev/project_plan.ts")
if has_mass:
    open(pp, "w", encoding="utf-8").write("// written by patches/apply_smart_house.py (this project has twinMassing.ts)\nexport { projectPlan } from '../src/components/twinMassing'\n")
    print("dev/project_plan.ts -> twinMassing projection")
else:
    print("dev/project_plan.ts -> identity projection (no twinMassing.ts in this project)")

tv = os.path.join(root, "frontend-react/src/components/TwinViewer.tsx")
txt = open(tv, encoding="utf-8").read()
if "downloadSmartHouse" in txt:
    print("TwinViewer.tsx already has the Smart-house button; unchanged")
else:
    imp = "import DesignPanel from './DesignPanel'\n"
    assert txt.count(imp) == 1, "anchor import not found - apply the button by hand (see README_ADDON.md)"
    add = "import { downloadSmartHouse } from '@/lib/smartHouse'\n"
    if has_mass:
        add += "import { projectPlan } from './twinMassing'\n"
    txt = txt.replace(imp, imp + add)
    anchor = "Download 3D model (.glb)</button>\n"
    assert txt.count(anchor) == 1, "GLB button anchor not found - apply the button by hand"
    call = "downloadSmartHouse(plan, projectPlan)" if has_mass else "downloadSmartHouse(plan)"
    btn = ("        <button style={btn(false)} disabled={!!busy} onClick={() => " + call + "} "
           "title=\"Download the smart-house data (room lights, ceiling fans, wall switches) that goes with the .glb, "
           "for the Unity / Meta Quest demo\">Smart-house data (.json)</button>\n")
    txt = txt.replace(anchor, anchor + btn)
    open(tv, "w", encoding="utf-8").write(txt)
    print("TwinViewer.tsx patched (", "with" if has_mass else "without", "twinMassing projection )")
