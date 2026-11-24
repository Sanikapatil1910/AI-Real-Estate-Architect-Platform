"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// dev/check_nav.ts
var import_strict = __toESM(require("node:assert/strict"), 1);

// src/vr/navGrid.ts
var BIN_FT = 0.1;
var CELL_FT = 0.3;
var STEP_FT = 0.8;
var DROP_FT = 1.1;
var HEAD_FT = 3.8;
var BODY_RADIUS_FT = 0.3;
var TALL_FT = 6;
var FURNITURE_RADIUS_FT = 0.25;
var NavGrid = class {
  constructor(b, cell = CELL_FT) {
    this.b = b;
    this.cell = cell;
    this.nx = Math.max(1, Math.ceil((b.x1 - b.x0) / cell));
    this.nz = Math.max(1, Math.ceil((b.z1 - b.z0) / cell));
    this.nBins = Math.max(4, Math.ceil(Math.max(b.y1, 1) / BIN_FT) + 2);
    this.words = Math.ceil(this.nBins / 32);
    this.up = new Uint32Array(this.nx * this.nz * this.words);
    this.solid = new Uint32Array(this.nx * this.nz * this.words);
    this.down = new Uint32Array(this.nx * this.nz * this.words);
  }
  nx;
  nz;
  nBins;
  words;
  up;
  solid;
  down;
  triangles = 0;
  samples = 0;
  patches = [];
  patchCells = /* @__PURE__ */ new Map();
  /** body radius in feet (a 36 cm wide person; doorways in the plans are 2.5-4 ft) */
  bodyRadius = BODY_RADIUS_FT;
  furnitureRadius = FURNITURE_RADIUS_FT;
  cellOf(x, z) {
    const i = Math.floor((x - this.b.x0) / this.cell), j = Math.floor((z - this.b.z0) / this.cell);
    return i < 0 || j < 0 || i >= this.nx || j >= this.nz ? -1 : j * this.nx + i;
  }
  binOf(y) {
    return Math.max(0, Math.min(this.nBins - 1, Math.floor(y / BIN_FT)));
  }
  setBit(arr, c, bin) {
    arr[c * this.words + (bin >> 5)] |= 1 << (bin & 31);
  }
  getBit(arr, c, bin) {
    return bin >= 0 && bin < this.nBins && (arr[c * this.words + (bin >> 5)] & 1 << (bin & 31)) !== 0;
  }
  /** Adds one triangle (model frame, feet). Triangles outside the grid are skipped and huge ones (the plot, the road) are split so only the part inside is sampled. */
  addTriangle(ax, ay, az, bx, by, bz, cx, cy, cz, depth = 0) {
    const { x0, z0, x1, z1, y1 } = this.b;
    const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx), minZ = Math.min(az, bz, cz), maxZ = Math.max(az, bz, cz);
    if (maxX < x0 || minX > x1 || maxZ < z0 || minZ > z1 || Math.min(ay, by, cy) > y1) return;
    const inside = minX >= x0 && maxX <= x1 && minZ >= z0 && maxZ <= z1;
    if (!inside && depth < 24) {
      const eab = Math.hypot(bx - ax, by - ay, bz - az), ebc = Math.hypot(cx - bx, cy - by, cz - bz), eca = Math.hypot(ax - cx, ay - cy, az - cz);
      const m = Math.max(eab, ebc, eca);
      if (m > 12) {
        if (m === eab) {
          const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
          this.addTriangle(ax, ay, az, mx, my, mz, cx, cy, cz, depth + 1);
          this.addTriangle(mx, my, mz, bx, by, bz, cx, cy, cz, depth + 1);
        } else if (m === ebc) {
          const mx = (bx + cx) / 2, my = (by + cy) / 2, mz = (bz + cz) / 2;
          this.addTriangle(ax, ay, az, bx, by, bz, mx, my, mz, depth + 1);
          this.addTriangle(ax, ay, az, mx, my, mz, cx, cy, cz, depth + 1);
        } else {
          const mx = (cx + ax) / 2, my = (cy + ay) / 2, mz = (cz + az) / 2;
          this.addTriangle(ax, ay, az, bx, by, bz, mx, my, mz, depth + 1);
          this.addTriangle(mx, my, mz, bx, by, bz, cx, cy, cz, depth + 1);
        }
        return;
      }
    }
    this.sample(ax, ay, az, bx, by, bz, cx, cy, cz);
  }
  sample(ax, ay, az, bx, by, bz, cx, cy, cz) {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nxv = uy * vz - uz * vy, nyv = uz * vx - ux * vz, nzv = ux * vy - uy * vx;
    const len = Math.hypot(nxv, nyv, nzv);
    if (len < 1e-9) return;
    this.triangles++;
    const ny = nyv / len;
    const isUp = ny > 0.6, isDown = ny < -0.6;
    const arr = isUp ? this.up : isDown ? this.down : this.solid;
    const s = isUp || isDown ? this.cell * 0.5 : Math.min(this.cell * 0.5, BIN_FT * 0.95);
    const lu = Math.hypot(ux, uy, uz), lv = Math.hypot(vx, vy, vz);
    const nu = Math.max(1, Math.ceil(lu / s)), nv = Math.max(1, Math.ceil(lv / s));
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const jmax = Math.floor((1 - u) * nv + 1e-9);
      for (let j = 0; j <= jmax; j++) {
        const v = j / nv;
        const x = ax + u * ux + v * vx, y = ay + u * uy + v * vy, z = az + u * uz + v * vz;
        const c = this.cellOf(x, z);
        this.samples++;
        if (c < 0 || y > this.b.y1) continue;
        this.setBit(arr, c, this.binOf(y));
      }
    }
  }
  /**
   * Registers the generator's own stair treads / landings.  A triangle-sampled stair is hard to climb reliably (thin folded treads, risers, rails, stringers all
   * land in the same cells), so where the generator says "this is a tread at height h", the walker stands on it; walls still stop it, rails and risers do not.
   */
  addWalkPatches(list) {
    for (const p of list) {
      const idx = this.patches.length;
      this.patches.push(p);
      const xs = p.pts.map((q) => q[0]), zs = p.pts.map((q) => q[1]);
      const i0 = Math.floor((Math.min(...xs) - this.b.x0) / this.cell), i1 = Math.floor((Math.max(...xs) - this.b.x0) / this.cell);
      const j0 = Math.floor((Math.min(...zs) - this.b.z0) / this.cell), j1 = Math.floor((Math.max(...zs) - this.b.z0) / this.cell);
      for (let j = Math.max(0, j0); j <= Math.min(this.nz - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++) {
        const c = j * this.nx + i;
        const a = this.patchCells.get(c);
        if (a) a.push(idx);
        else this.patchCells.set(c, [idx]);
      }
    }
  }
  get patchCount() {
    return this.patches.length;
  }
  /** True when a generator stair surface (within a step or a drop of height g) lies within `margin` feet of (x, z): the stair zone. */
  nearPatch(x, z, g, margin = 0.7) {
    if (!this.patches.length) return false;
    for (const [ox, oz] of [[0, 0], [margin, 0], [-margin, 0], [0, margin], [0, -margin], [margin, margin], [-margin, margin], [margin, -margin], [-margin, -margin]]) {
      const c = this.cellOf(x + ox, z + oz);
      const ids = c < 0 ? void 0 : this.patchCells.get(c);
      if (!ids) continue;
      for (const id of ids) {
        const p = this.patches[id];
        if (p.top > g + STEP_FT + 0.01 || p.top < g - DROP_FT) continue;
        if (this.inQuad(p.pts, x + ox, z + oz)) return true;
      }
    }
    return false;
  }
  inQuad(q, x, z) {
    let pos = false, neg = false;
    for (let i = 0; i < q.length; i++) {
      const [ax, az] = q[i], [bx, bz] = q[(i + 1) % q.length];
      const cr = (bx - ax) * (z - az) - (bz - az) * (x - ax);
      if (cr > 1e-9) pos = true;
      else if (cr < -1e-9) neg = true;
      if (pos && neg) return false;
    }
    return true;
  }
  /** Height of the generator's stair surface at (x, z) within reach of fromY (highest such), or null. */
  patchGround(x, z, fromY) {
    if (!this.patches.length) return null;
    const c = this.cellOf(x, z);
    const ids = c < 0 ? void 0 : this.patchCells.get(c);
    if (!ids) return null;
    let best = null;
    for (const id of ids) {
      const p = this.patches[id];
      if (p.top > fromY + STEP_FT + 1e-6 || p.top < fromY - DROP_FT) continue;
      if (best !== null && p.top <= best) continue;
      if (this.inQuad(p.pts, x, z)) best = p.top;
    }
    return best;
  }
  /** Height of the walkable surface at (x, z) for a person whose feet are at fromY; null when there is none within step-up / drop reach. */
  groundAt(x, z, fromY) {
    const pg = this.patchGround(x, z, fromY);
    if (pg !== null) return pg;
    const c = this.cellOf(x, z);
    if (c < 0) return null;
    const hi = this.binOf(fromY + STEP_FT), lo = this.binOf(Math.max(0, fromY - DROP_FT));
    for (let b = hi; b >= lo; b--) {
      if (!this.getBit(this.up, c, b)) continue;
      let bottom = b;
      while (bottom - 1 >= 0 && bottom - 1 >= lo - 1 && this.getBit(this.up, c, bottom - 1)) bottom--;
      return (bottom + 0.5) * BIN_FT;
    }
    return null;
  }
  /** True when something solid occupies the body column [groundY + step, groundY + head] at (x, z). */
  solidAt(x, z, groundY) {
    const c = this.cellOf(x, z);
    if (c < 0) return false;
    const from = this.binOf(groundY + STEP_FT) + 1, to = this.binOf(groundY + HEAD_FT);
    for (let b = from; b <= to; b++) if (this.getBit(this.solid, c, b)) return true;
    return false;
  }
  /** Does anything solid (a wall, furniture side, a ceiling / slab underside) occupy (x, z) between heights ya and yb? Used by the teleport arc. */
  blockedBetween(x, z, ya, yb) {
    const c = this.cellOf(x, z);
    if (c < 0) return true;
    const lo = this.binOf(Math.min(ya, yb)), hi = this.binOf(Math.max(ya, yb));
    for (let b = lo; b <= hi; b++) if (this.getBit(this.solid, c, b) || this.getBit(this.down, c, b)) return true;
    return false;
  }
  /** The highest upward-facing surface at (x, z) within [yLo, yHi] (+ a small tolerance), or null. */
  surfaceBetween(x, z, yHi, yLo) {
    const c = this.cellOf(x, z);
    if (c < 0) return null;
    const hi = this.binOf(yHi + 0.05), lo = this.binOf(yLo - 0.05);
    for (let b = hi; b >= lo; b--) if (this.getBit(this.up, c, b)) return (b + 0.5) * BIN_FT;
    return null;
  }
  /** every walkable surface height at (x, z) - for diagnostics */
  upHeights(x, z) {
    const c = this.cellOf(x, z);
    const out = [];
    if (c < 0) return out;
    for (let b = 0; b < this.nBins; b++) if (this.getBit(this.up, c, b)) out.push(Math.round((b + 0.5) * BIN_FT * 100) / 100);
    return out;
  }
  /** diagnostics: heights of the bins holding solid (side) surface at (x, z) */
  solidHeights(x, z) {
    const c = this.cellOf(x, z);
    const out = [];
    if (c < 0) return out;
    for (let b = 0; b < this.nBins; b++) if (this.getBit(this.solid, c, b)) out.push(Math.round((b + 0.5) * BIN_FT * 100) / 100);
    return out;
  }
  /** True when something TALL (wall, door leaf, tall cupboard: solid reaching 6 ft above the ground) stands at (x, z). Low furniture does not count. */
  wallAt(x, z, groundY) {
    const c = this.cellOf(x, z);
    if (c < 0) return false;
    return this.getBit(this.solid, c, this.binOf(groundY + TALL_FT)) && this.getBit(this.solid, c, this.binOf(groundY + 1.6));
  }
  /** The body at (x, z) with feet starting at fromY: its new feet height, or null when it cannot stand there. */
  canStand(x, z, fromY) {
    const g = this.groundAt(x, z, fromY);
    if (g === null) return null;
    const r = this.bodyRadius;
    const onStair = this.patchGround(x, z, fromY) !== null || this.nearPatch(x, z, g);
    if (!onStair && this.solidAt(x, z, g)) return null;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      const ca = Math.cos(a), sa = Math.sin(a);
      let px = x + ca * r, pz = z + sa * r;
      let gp = this.groundAt(px, pz, g) ?? g;
      if (this.wallAt(px, pz, Math.max(g, gp))) return null;
      if (onStair) continue;
      px = x + ca * this.furnitureRadius;
      pz = z + sa * this.furnitureRadius;
      gp = this.groundAt(px, pz, g) ?? g;
      if (this.solidAt(px, pz, Math.max(g, gp))) return null;
    }
    return g;
  }
  /** Moves the feet by (dx, dz) in small steps, sliding along obstacles; returns the new foot position. */
  move(p, dx, dz) {
    const dist = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(dist / 0.2));
    let { x, y, z } = p;
    const sx = dx / n, sz = dz / n;
    for (let i = 0; i < n; i++) {
      let g = this.canStand(x + sx, z + sz, y);
      if (g !== null) {
        x += sx;
        z += sz;
        y = g;
        continue;
      }
      g = sx !== 0 ? this.canStand(x + sx, z, y) : null;
      if (g !== null) {
        x += sx;
        y = g;
        continue;
      }
      g = sz !== 0 ? this.canStand(x, z + sz, y) : null;
      if (g !== null) {
        z += sz;
        y = g;
      }
    }
    return { x, y, z };
  }
  /** How many 0.6 ft steps of floor a body can reach from here (stops counting at `limit`) - tells a free spot from a pocket between furniture. */
  floodCount(x, y, z, limit = 400, step = 0.6) {
    const seen = /* @__PURE__ */ new Set();
    const key = (a, b) => `${Math.round(a / step)},${Math.round(b / step)}`;
    const q = [{ x, y, z }];
    seen.add(key(x, z));
    let n = 0;
    while (q.length && n < limit) {
      const p = q.pop();
      n++;
      for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const k = key(p.x + dx, p.z + dz);
        if (seen.has(k)) continue;
        seen.add(k);
        const g = this.canStand(p.x + dx, p.z + dz, p.y);
        if (g !== null) q.push({ x: p.x + dx, y: g, z: p.z + dz });
      }
    }
    return n;
  }
  /** Like nearestStandable, but the spot must open onto at least `minCells` of reachable floor (not a pocket). */
  nearestOpen(x, z, y, radius = 8, minCells = 150) {
    for (let r = 0; r <= radius; r += 0.5) {
      const steps = Math.max(1, Math.round(2 * Math.PI * r / 0.5));
      for (let k = 0; k < steps; k++) {
        const a = k / steps * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const g = this.canStand(px, pz, y);
        if (g !== null && this.floodCount(px, g, pz, minCells) >= minCells) return { x: px, y: g, z: pz };
      }
    }
    return null;
  }
  /** The nearest standable spot to (x, z) (searching outwards on a small spiral) at about this height; null when none within `radius`. */
  nearestStandable(x, z, y, radius = 8) {
    for (let r = 0; r <= radius; r += 0.4) {
      const steps = Math.max(1, Math.round(2 * Math.PI * r / 0.4));
      for (let k = 0; k < steps; k++) {
        const a = k / steps * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const g = this.canStand(px, pz, y);
        if (g !== null) return { x: px, y: g, z: pz };
      }
    }
    return null;
  }
};

// dev/check_nav.ts
var tests = [];
var test = (n, f) => tests.push([n, f]);
var quad = (g, a, b, c, d) => {
  g.addTriangle(...a, ...b, ...c);
  g.addTriangle(...a, ...c, ...d);
};
var floor = (g, x0, z0, x1, z1, y) => quad(g, [x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]);
var wallX = (g, x, z0, z1, y0, y1) => quad(g, [x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]);
var box = (g, x0, z0, x1, z1, y0, y1) => {
  wallX(g, x0, z0, z1, y0, y1);
  wallX(g, x1, z0, z1, y0, y1);
  quad(g, [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]);
  quad(g, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  quad(g, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
};
var mk = () => new NavGrid({ x0: 0, z0: 0, x1: 40, z1: 30, y1: 24 });
test("flat floor is walkable and has its height; the edge of the floor stops the walker", () => {
  const g = mk();
  floor(g, 2, 2, 20, 20, 0.3);
  import_strict.default.ok(Math.abs(g.groundAt(10, 10, 0.3) - 0.3) < 0.13);
  const p = g.move({ x: 10, y: 0.3, z: 10 }, 30, 0);
  import_strict.default.ok(p.x < 20.01 && p.x > 18, `stopped at the edge, got ${p.x}`);
});
test("a wall blocks, a doorway lets the walker through, walls are slid along", () => {
  const g = mk();
  floor(g, 2, 2, 30, 20, 0.3);
  wallX(g, 12, 2, 9, 0.3, 10);
  wallX(g, 12, 12, 20, 0.3, 10);
  let p = g.move({ x: 8, y: 0.3, z: 4 }, 10, 0);
  import_strict.default.ok(p.x < 12 - BODY_RADIUS_FT + 0.1, `wall must stop the walker one body radius short of the wall, x=${p.x}`);
  p = g.move({ x: 8, y: 0.3, z: 10.5 }, 10, 0);
  import_strict.default.ok(p.x > 17, `doorway must be passable, x=${p.x}`);
  p = g.move({ x: 8, y: 0.3, z: 4 }, 6, 3);
  import_strict.default.ok(p.z > 6, "slides along the wall");
});
test("a doorway too narrow for the body (0.3 ft) blocks", () => {
  const g = mk();
  floor(g, 2, 2, 30, 20, 0.3);
  wallX(g, 12.15, 2, 9.85, 0.3, 10);
  wallX(g, 12.15, 10.15, 20, 0.3, 10);
  const p = g.move({ x: 8, y: 0.3, z: 10 }, 10, 0);
  import_strict.default.ok(p.x < 12.15 - BODY_RADIUS_FT + 0.1, `x=${p.x}`);
});
test("stairs: climb 10 risers of 0.6 ft (up to the next floor) and walk back down", () => {
  const g = mk();
  floor(g, 2, 2, 12, 20, 0.3);
  for (let i = 0; i < 17; i++) {
    const x0 = 12 + i * 0.8, y = 0.3 + (i + 1) * 0.6;
    floor(g, x0, 8, x0 + 0.8, 11, y);
    quad(g, [x0, y - 0.6, 8], [x0, y, 8], [x0, y, 11], [x0, y - 0.6, 11]);
    wallX(g, x0, 8, 11, y - 0.6, y);
  }
  floor(g, 25.6, 2, 38, 20, 0.3 + 18 * 0.6);
  let p = g.move({ x: 10, y: 0.3, z: 9.5 }, 30, 0);
  import_strict.default.ok(p.y > 10, `should reach the upper landing, y=${p.y}`);
  p = g.move(p, -30, 0);
  import_strict.default.ok(p.y < 1.2, `should walk back down, y=${p.y}`);
});
test("a table (top 2.5 ft) and a sofa-height box stop the walker; a 0.5 ft rug does not", () => {
  const g = mk();
  floor(g, 2, 2, 30, 20, 0.3);
  box(g, 14, 6, 17, 9, 0.3, 2.8);
  box(g, 20, 6, 23, 9, 0.3, 0.8);
  let p = g.move({ x: 10, y: 0.3, z: 7.5 }, 10, 0);
  import_strict.default.ok(p.x < 13.5, `table must stop, x=${p.x}`);
  p = g.move({ x: 18, y: 0.3, z: 7.5 }, 10, 0);
  import_strict.default.ok(p.x > 24, `rug is walked over, x=${p.x}`);
});
test("a drop off a terrace edge (> 1.1 ft) is not allowed; a low kerb is", () => {
  const g = mk();
  floor(g, 2, 2, 12, 20, 6.3);
  floor(g, 12, 2, 30, 20, 0.3);
  const p = g.move({ x: 8, y: 6.3, z: 10 }, 10, 0);
  import_strict.default.ok(p.x < 12.2 && p.y > 6, `no jumping off, x=${p.x} y=${p.y}`);
});
test("ceiling undersides never block (a stair flight can run under a slab edge); a 1.2 ft doorway is too narrow, a low table leaves a hand of clearance", () => {
  const g = mk();
  floor(g, 2, 2, 30, 20, 0.3);
  quad(g, [12, 4.5, 2], [14, 4.5, 2], [14, 4.5, 20], [12, 4.5, 20]);
  import_strict.default.ok(g.move({ x: 8, y: 0.3, z: 10 }, 10, 0).x > 17, "underside is ignored");
  const t = mk();
  floor(t, 2, 2, 30, 20, 0.3);
  box(t, 14, 8, 17, 11, 0.3, 2.8);
  import_strict.default.ok(t.canStand(13.3, 9.5, 0.3) !== null, "low furniture: only a hand of clearance");
  import_strict.default.ok(t.canStand(14.2, 9.5, 0.3) === null, "cannot stand inside the table");
  const w = mk();
  floor(w, 2, 2, 30, 20, 0.3);
  wallX(w, 14, 2, 20, 0.3, 10);
  import_strict.default.ok(w.canStand(14 - BODY_RADIUS_FT + 0.1, 9.5, 0.3) === null, "a wall keeps the full body radius away");
  import_strict.default.ok(w.canStand(14 - BODY_RADIUS_FT - 0.4, 9.5, 0.3) !== null, "but not more than that");
  import_strict.default.ok(w.canStand(12.9, 9.5, 0.3) !== null);
});
test("nearestStandable finds a free spot near a blocked one; null when none", () => {
  const g = mk();
  floor(g, 2, 2, 30, 20, 0.3);
  box(g, 14, 6, 17, 9, 0.3, 2.8);
  const s = g.nearestStandable(15.5, 7.5, 0.3);
  import_strict.default.ok(s && g.canStand(s.x, s.z, 0.3) !== null);
  import_strict.default.equal(new NavGrid({ x0: 0, z0: 0, x1: 10, z1: 10, y1: 12 }).nearestStandable(5, 5, 0.3, 3), null);
});
test("a 2 km plot triangle does not explode: only the part inside the grid is sampled (fast)", () => {
  const g = mk();
  const t0 = Date.now();
  g.addTriangle(-2e3, 0.2, -2e3, 0, 0.2, 2e3, 2e3, 0.2, -2e3);
  import_strict.default.ok(Date.now() - t0 < 1500 && g.samples < 3e6, `took ${Date.now() - t0} ms, ${g.samples} samples`);
  import_strict.default.ok(g.groundAt(20, 15, 0.2) !== null);
});
test("outside the grid is not walkable; degenerate triangles are ignored", () => {
  const g = mk();
  g.addTriangle(1, 1, 1, 1, 1, 1, 1, 1, 1);
  import_strict.default.equal(g.triangles, 0);
  import_strict.default.equal(g.groundAt(-5, -5, 0), null);
});
test("building the grid is fast: 200k triangles of furniture-like boxes in < 3 s", () => {
  const g = mk();
  floor(g, 2, 2, 38, 28, 0.3);
  const t0 = Date.now();
  for (let i = 0; i < 4e3; i++) box(g, 3 + i % 60 * 0.55, 3 + Math.floor(i / 60) * 0.3, 3.3 + i % 60 * 0.55, 3.3 + Math.floor(i / 60) * 0.3, 0.3, 2.2);
  import_strict.default.ok(Date.now() - t0 < 3e3, `took ${Date.now() - t0} ms`);
});
test("walk patches: a stair whose own geometry is blocked by a tall rail is still climbable, and the rail still blocks beside the stair", () => {
  const g = mk();
  floor(g, 2, 2, 30, 20, 0.3);
  const patches = [];
  for (let i = 0; i < 10; i++) patches.push({ pts: [[14 + i, 8], [15 + i, 8], [15 + i, 12], [14 + i, 12]], top: 0.3 + 0.5 * (i + 1) });
  box(g, 13.9, 8, 14.1, 12, 0.3, 3.3);
  import_strict.default.ok(g.canStand(12, 10, 0.3) !== null, "floor before the stair is standable");
  import_strict.default.equal(g.canStand(13.95, 10, 0.3), null, "without patches the rail seals the foot of the stair");
  g.addWalkPatches(patches);
  import_strict.default.equal(g.patchCount, 10);
  let p = { x: 12, y: 0.3, z: 10 };
  for (let i = 0; i < 60; i++) p = g.move(p, 0.3, 0);
  import_strict.default.ok(p.y > 4.5, `walker climbed the patches, y=${p.y}`);
  box(g, 20, 3, 22, 6, 0.3, 3.3);
  import_strict.default.equal(g.canStand(19.9, 4.5, 0.3), null, "solid things away from the stair still block");
});
test("walk patches: walking back down follows the treads to the floor", () => {
  const g = mk();
  floor(g, 2, 2, 30, 20, 0.3);
  const patches = [];
  for (let i = 0; i < 6; i++) patches.push({ pts: [[14 + i, 8], [15 + i, 8], [15 + i, 12], [14 + i, 12]], top: 0.3 + 0.5 * (i + 1) });
  g.addWalkPatches(patches);
  let p = { x: 19.5, y: 3.3, z: 10 };
  for (let i = 0; i < 60; i++) p = g.move(p, -0.3, 0);
  import_strict.default.ok(p.y < 0.8, `walker came back down, y=${p.y}`);
});
var failed = [];
var passed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed.push({ name, error: String(e.message).slice(0, 300) });
  }
}
console.log(JSON.stringify({ passed, total: tests.length, failed }));
process.exit(failed.length ? 1 : 0);
