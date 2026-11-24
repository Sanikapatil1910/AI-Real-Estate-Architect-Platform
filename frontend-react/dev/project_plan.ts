// The projection the 3D view applies to a plan before drawing it.  This file is written by patches/apply_smart_house.py:
//  - project WITHOUT components/twinMassing.ts (Exterior Shape work): identity, as below;
//  - project WITH it: `export { projectPlan } from '../src/components/twinMassing'`.
export const projectPlan = <T,>(p: T): T => p
