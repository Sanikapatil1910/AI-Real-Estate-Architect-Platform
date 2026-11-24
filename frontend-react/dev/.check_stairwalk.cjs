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

// dev/check_stairwalk.ts
var import_strict = __toESM(require("node:assert/strict"), 1);

// src/components/stairSpec.ts
var MM = 304.8;
function normShape(s) {
  const t = String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (t === "straight" || t === "single") return "straight";
  if (t === "l" || t === "lshape" || t === "quarter") return "l";
  if (t === "doublel" || t === "dl" || t === "wrap" || t === "wraparound" || t === "threeflight") return "double_l";
  if (t === "spiral" || t === "circular" || t === "helical") return "spiral";
  return "u";
}
function stairSpec(info, storeyH) {
  const tread = (info?.tread_depth_mm ?? 300) / MM;
  const S = info?.entry_landing_feet ?? 1e3 / MM;
  let n2 = info?.riser_count ?? Math.max(2, Math.ceil(storeyH * MM / 150 - 1e-9));
  let r1 = info?.flights?.[0]?.riser_count ?? Math.floor(n2 / 2);
  let r2 = info?.flights?.[1]?.riser_count ?? n2 - r1;
  if (r1 + r2 !== n2) {
    n2 = r1 + r2;
  }
  return {
    r1,
    r2,
    n: n2,
    riser: storeyH / n2,
    tread,
    S,
    widthFt: info?.stair_width_feet ?? 3.5,
    storeyH,
    shape: normShape(info?.shape),
    axis: info?.axis,
    mirror: !!info?.mirror,
    weights: info?.flight_weights ?? void 0
  };
}
var clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function splitRisers(n2, k, w) {
  const ws = (w && w.length >= k ? w.slice(0, k) : Array(k).fill(1)).map((x) => Math.max(0.5, x));
  const sum = ws.reduce((a, b) => a + b, 0);
  const out = ws.map((x) => Math.max(3, Math.round(n2 * x / sum)));
  let diff = n2 - out.reduce((a, b) => a + b, 0);
  const order = k === 3 ? [1, 0, 2] : k === 2 ? [1, 0] : [0];
  let guard = 0;
  while (diff !== 0 && guard++ < 200) {
    for (const i of order) {
      if (diff === 0) break;
      if (diff > 0) {
        out[i] += 1;
        diff -= 1;
      } else if (out[i] > 2) {
        out[i] -= 1;
        diff += 1;
      }
    }
  }
  return out;
}
function mirrorV(G) {
  const W = G.W;
  const mr = (r) => ({ u0: r.u0, u1: r.u1, v0: W - r.v1, v1: W - r.v0 });
  return {
    ...G,
    laneA: [W - G.laneA[1], W - G.laneA[0]],
    laneB: [W - G.laneB[1], W - G.laneB[0]],
    landing: { ...G.landing, ...mr(G.landing) },
    landings: G.landings.map((l) => ({ ...l, ...mr(l) })),
    treads: G.treads.map((t) => ({
      ...t,
      ...mr(t),
      rot: t.rot ? { ...t.rot, cv: W - t.rot.cv, ang: -t.rot.ang } : void 0
    })),
    head: mr(G.head),
    foot: mr(G.foot),
    well: G.well ? mr(G.well) : null,
    arrow: G.arrow.map(([u, v]) => [u, W - v]),
    rails: G.rails.map((r) => ({ ...r, pts: r.pts.map(([u, v, h]) => [u, W - v, h]) })),
    guard: G.guard.map((q) => ({ a: [q.a[0], W - q.a[1]], b: [q.b[0], W - q.b[1]] })),
    column: G.column ? { ...G.column, v: W - G.column.v } : void 0
  };
}
function stairLocal(spec, L, W) {
  let G;
  switch (spec.shape) {
    case "straight":
      G = straightLocal(spec, L, W);
      break;
    case "l":
      G = lLocal(spec, L, W);
      break;
    case "double_l":
      G = doubleLLocal(spec, L, W);
      break;
    case "spiral":
      G = spiralLocal(spec, L, W);
      break;
    default:
      G = uLocal(spec, L, W);
  }
  return spec.mirror ? mirrorV(G) : G;
}
function uLocal(spec, L, W) {
  const gap = 0.2;
  const lane = Math.max(2.2, (W - gap) / 2);
  const t1 = Math.max(1, spec.r1 - 1);
  const t2 = Math.max(1, spec.r2 - 1);
  const landD = Math.max(2.5, Math.min(lane, 3.5));
  let S = spec.S;
  let T = spec.tread;
  if (S + t2 * T + landD > L + 1e-6) {
    S = Math.min(S, 2);
    T = Math.max(0.45, (L - S - landD) / t2);
  }
  const uF = S + t2 * T;
  const laneA = [0, lane];
  const laneB = [W - lane, W];
  const treads = [];
  for (let j = 1; j <= t1; j++) {
    treads.push({ flight: 1, j, u0: S + (j - 1) * T, u1: S + j * T, v0: laneA[0], v1: laneA[1], top: j * spec.riser });
  }
  for (let j = 1; j <= t2; j++) {
    treads.push({ flight: 2, j, u0: uF - j * T, u1: uF - (j - 1) * T, v0: laneB[0], v1: laneB[1], top: (spec.r1 + j) * spec.riser });
  }
  const landing = { u0: S + t1 * T, u1: Math.max(uF + landD, L), v0: 0, v1: W, top: spec.r1 * spec.riser };
  const HR = 3;
  const f1 = treads.filter((t) => t.flight === 1).map((t) => [(t.u0 + t.u1) / 2, laneA[1], t.top]);
  const f2 = treads.filter((t) => t.flight === 2).map((t) => [(t.u0 + t.u1) / 2, laneB[0], t.top]);
  return {
    L,
    W,
    lane,
    gap,
    laneA,
    laneB,
    S,
    uF,
    landing,
    landings: [landing],
    treads,
    nFlights: 2,
    head: { u0: 0, u1: S, v0: 0, v1: W },
    foot: { u0: 0, u1: S, v0: 0, v1: W },
    well: { u0: S, u1: landing.u0, v0: laneA[1], v1: laneB[0] },
    arrow: [[S * 0.45, lane / 2], [(landing.u0 + landing.u1) / 2, lane / 2], [(landing.u0 + landing.u1) / 2, W - lane / 2], [S * 0.45 + 0.8, W - lane / 2]],
    rails: [
      { pts: f1, posts: true },
      { pts: f2, posts: true },
      // The half landing's only open edge is the one that faces the well (between the two flights). The walking path crosses the
      // landing from lane A to lane B, so no rail may run along the landing in the travel direction (that used to wall the flights off).
      { pts: [[landing.u0, laneA[1], landing.top], [landing.u0, laneB[0], landing.top]], posts: true }
    ],
    // upstairs the whole stair room except the arrival landing is open: guard its edge from lane A across the well up to flight 2
    guard: [{ a: [S, 0.1], b: [S, laneB[0]] }]
  };
}
function straightLocal(spec, L, W) {
  const lane = Math.min(W, Math.max(spec.widthFt, 2.5));
  const t = Math.max(1, spec.n - 1);
  let S = spec.S;
  if (L - 2 * S < t * 0.45) S = Math.min(S, 1.5);
  const T = clamp((L - 2 * S) / t, 0.45, 1.5);
  const treads = [];
  for (let j = 1; j <= t; j++) {
    treads.push({ flight: 1, j, u0: S + (j - 1) * T, u1: S + j * T, v0: 0, v1: lane, top: j * spec.riser });
  }
  const uEnd = S + t * T;
  const rails = [];
  if (lane < W - 0.3) rails.push({ pts: treads.map((q) => [(q.u0 + q.u1) / 2, lane, q.top]), posts: true });
  return {
    L,
    W,
    lane,
    gap: 0,
    laneA: [0, lane],
    laneB: [0, lane],
    S,
    uF: S,
    landing: { u0: uEnd, u1: L, v0: 0, v1: lane, top: spec.n * spec.riser },
    landings: [],
    treads,
    nFlights: 1,
    head: { u0: uEnd, u1: L, v0: 0, v1: lane },
    foot: { u0: 0, u1: S, v0: 0, v1: W },
    well: null,
    arrow: [[S * 0.45, lane / 2], [uEnd - 0.4, lane / 2]],
    rails,
    guard: []
  };
}
function lLocal(spec, L, W) {
  const lane = clamp(Math.max(spec.widthFt, 2.5), 2.5, Math.max(2.5, Math.min(L, W) / 2));
  const [r1, r2] = splitRisers(spec.n, 2, spec.weights);
  const t1 = Math.max(1, r1 - 1);
  const t2 = Math.max(1, r2 - 1);
  let S = spec.S;
  if (L - lane - S < t1 * 0.45) S = Math.min(S, 1.5);
  const T1 = clamp((L - lane - S) / t1, 0.45, 1.5);
  const T2 = clamp((W - 2 * lane) / t2, 0.45, 1.5);
  const treads = [];
  for (let j = 1; j <= t1; j++) treads.push({ flight: 1, j, u0: S + (j - 1) * T1, u1: S + j * T1, v0: 0, v1: lane, top: j * spec.riser });
  const uL = S + t1 * T1;
  const landing = { u0: uL, u1: L, v0: 0, v1: lane, top: r1 * spec.riser };
  for (let j = 1; j <= t2; j++) {
    treads.push({ flight: 2, j, u0: L - lane, u1: L, v0: lane + (j - 1) * T2, v1: Math.min(W, lane + j * T2), top: (r1 + j) * spec.riser });
  }
  const vEnd = Math.min(W, lane + t2 * T2);
  const f1 = treads.filter((t) => t.flight === 1).map((t) => [(t.u0 + t.u1) / 2, lane, t.top]);
  const f2 = treads.filter((t) => t.flight === 2).map((t) => [L - lane, (t.v0 + t.v1) / 2, t.top]);
  return {
    L,
    W,
    lane,
    gap: 0,
    laneA: [0, lane],
    laneB: [0, lane],
    S,
    uF: S,
    landing,
    landings: [landing],
    treads,
    nFlights: 2,
    head: { u0: L - lane, u1: L, v0: vEnd, v1: W },
    foot: { u0: 0, u1: S, v0: 0, v1: lane },
    well: { u0: S, u1: L - lane, v0: lane, v1: W },
    arrow: [[S * 0.45, lane / 2], [L - lane / 2, lane / 2], [L - lane / 2, Math.max(vEnd - 0.4, lane)]],
    rails: [{ pts: [...f1, [L - lane, lane, landing.top], ...f2], posts: true }],
    guard: vEnd < W - 0.3 ? [{ a: [L - lane, vEnd], b: [L - lane, W - 0.1] }] : []
  };
}
function doubleLLocal(spec, L, W) {
  const lane = clamp(Math.max(spec.widthFt, 2.5), 2.5, Math.max(2.5, Math.min(L, W / 2 - 0.4)));
  const [r1, r2, r3] = splitRisers(spec.n, 3, spec.weights);
  const t1 = Math.max(1, r1 - 1);
  const t2 = Math.max(1, r2 - 1);
  const t3 = Math.max(1, r3 - 1);
  let S = spec.S;
  if (L - lane - S < Math.max(t1, t3) * 0.45) S = Math.min(S, 1);
  const T1 = clamp((L - lane - S) / t1, 0.45, 1.5);
  const T3 = clamp((L - lane - S) / t3, 0.45, 1.5);
  const T2 = clamp((W - 2 * lane) / t2, 0.45, 1.5);
  const treads = [];
  for (let j = 1; j <= t1; j++) treads.push({ flight: 1, j, u0: S + (j - 1) * T1, u1: S + j * T1, v0: 0, v1: lane, top: j * spec.riser });
  const landing1 = { u0: S + t1 * T1, u1: L, v0: 0, v1: lane, top: r1 * spec.riser };
  for (let j = 1; j <= t2; j++) {
    treads.push({ flight: 2, j, u0: L - lane, u1: L, v0: lane + (j - 1) * T2, v1: Math.min(W - lane, lane + j * T2), top: (r1 + j) * spec.riser });
  }
  const vE2 = Math.min(W - lane, lane + t2 * T2);
  const landing2 = { u0: L - lane, u1: L, v0: vE2, v1: W, top: (r1 + r2) * spec.riser };
  for (let j = 1; j <= t3; j++) {
    treads.push({ flight: 3, j, u0: L - lane - j * T3, u1: L - lane - (j - 1) * T3, v0: W - lane, v1: W, top: (r1 + r2 + j) * spec.riser });
  }
  const f1 = treads.filter((t) => t.flight === 1).map((t) => [(t.u0 + t.u1) / 2, lane, t.top]);
  const f2 = treads.filter((t) => t.flight === 2).map((t) => [L - lane, (t.v0 + t.v1) / 2, t.top]);
  const f3 = treads.filter((t) => t.flight === 3).map((t) => [(t.u0 + t.u1) / 2, W - lane, t.top]);
  return {
    L,
    W,
    lane,
    gap: 0,
    laneA: [0, lane],
    laneB: [W - lane, W],
    S,
    uF: S,
    landing: landing1,
    landings: [landing1, landing2],
    treads,
    nFlights: 3,
    head: { u0: 0, u1: S, v0: 0, v1: W },
    foot: { u0: 0, u1: S, v0: 0, v1: W },
    well: { u0: S, u1: L - lane, v0: lane, v1: W - lane },
    arrow: [[S * 0.45, lane / 2], [L - lane / 2, lane / 2], [L - lane / 2, W - lane / 2], [S * 0.45 + 0.8, W - lane / 2]],
    rails: [{ pts: [...f1, [L - lane, lane, landing1.top], ...f2, [L - lane, W - lane, landing2.top], ...f3], posts: true }],
    guard: [{ a: [S, 0.1], b: [S, W - lane] }]
  };
}
function spiralLocal(spec, L, W) {
  const S = Math.min(spec.S, Math.max(1.5, L - 5));
  const R = clamp(Math.min(W / 2, (L - S) / 2), 2, 6);
  const rc = 0.4;
  const cu = S + R;
  const cv = W / 2;
  const t = Math.max(3, spec.n - 1);
  const da = 2 * Math.PI * 0.94 / t;
  const rm = (R + rc) / 2;
  const treads = [];
  const rail = [];
  for (let j = 1; j <= t; j++) {
    const ang = Math.PI + (j - 0.5) * da;
    const wid = rm * da * 1.04;
    const len = R - rc;
    const cx = cu + rm * Math.cos(ang);
    const cy = cv + rm * Math.sin(ang);
    const top = j * spec.riser;
    const ex = Math.abs(Math.cos(ang)) * len / 2 + Math.abs(Math.sin(ang)) * wid / 2;
    const ey = Math.abs(Math.sin(ang)) * len / 2 + Math.abs(Math.cos(ang)) * wid / 2;
    treads.push({ flight: 1, j, u0: cx - ex, u1: cx + ex, v0: cy - ey, v1: cy + ey, top, rot: { cu: cx, cv: cy, ang, len, wid } });
    rail.push([cu + (R - 0.05) * Math.cos(ang), cv + (R - 0.05) * Math.sin(ang), top]);
  }
  return {
    L,
    W,
    lane: R,
    gap: 0,
    laneA: [0, W],
    laneB: [0, W],
    S,
    uF: S,
    landing: { u0: 0, u1: 0, v0: 0, v1: 0, top: 0 },
    landings: [],
    treads,
    nFlights: 1,
    head: { u0: 0, u1: S, v0: 0, v1: W },
    foot: { u0: 0, u1: S, v0: 0, v1: W },
    well: null,
    arrow: Array.from({ length: 13 }, (_, i) => {
      const a = Math.PI + i / 12 * (2 * Math.PI * 0.9);
      return [cu + rm * Math.cos(a), cv + rm * Math.sin(a)];
    }),
    rails: [{ pts: rail, posts: true }],
    guard: [],
    column: { u: cu, v: cv, r: rc }
  };
}
function toPlanRect(r, entryHigh, axis) {
  const w = r.x2 - r.x;
  const h = r.y2 - r.y;
  const horiz = axis ? axis === "x" : w >= h;
  const L = horiz ? w : h;
  const W = horiz ? h : w;
  return {
    horiz,
    L,
    W,
    map: (u0, u1, v0, v1) => {
      const a = entryHigh ? L - u1 : u0;
      const b = entryHigh ? L - u0 : u1;
      return horiz ? { x0: r.x + a, x1: r.x + b, y0: r.y + v0, y1: r.y + v1 } : { x0: r.x + v0, x1: r.x + v1, y0: r.y + a, y1: r.y + b };
    },
    /** a local point -> plan point */
    pt: (u, v) => {
      const a = entryHigh ? L - u : u;
      return horiz ? { x: r.x + a, y: r.y + v } : { x: r.x + v, y: r.y + a };
    }
  };
}

// src/components/stairWalk.ts
function stairWalkPatches(r, lvl, spec, entryHigh = false) {
  const P = toPlanRect(r, entryHigh, spec.axis);
  const G = stairLocal(spec, P.L, P.W);
  const out = [];
  const rect = (u0, u1, v0, v1, top, kind) => {
    const b = P.map(u0, u1, v0, v1);
    out.push({ pts: [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]], top: lvl + top, kind });
  };
  for (const t of G.treads) {
    if (t.rot) {
      const { cu, cv, ang, len, wid } = t.rot;
      const c = Math.cos(ang), s = Math.sin(ang);
      const q = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => {
        const p = P.pt(cu + a * len * c / 2 - b * wid * s / 2, cv + a * len * s / 2 + b * wid * c / 2);
        return [p.x, p.y];
      });
      out.push({ pts: q, top: lvl + t.top, kind: "tread" });
    } else rect(t.u0, t.u1, t.v0, t.v1, t.top, "tread");
  }
  for (const ld of G.landings) rect(ld.u0, ld.u1, ld.v0, ld.v1, ld.top, "landing");
  return out;
}

// dev/check_stairwalk.ts
var fails = [];
var n = 0;
for (const shape of ["u", "straight", "l", "double_l", "spiral"]) for (const mirror of [false, true]) for (const entryHigh of [false, true]) for (const [L, W] of [[17, 7.5], [16, 8], [14, 7], [12, 10]]) {
  const tag = `${shape}${mirror ? "-m" : ""}${entryHigh ? "-hi" : ""} ${L}x${W}`;
  n++;
  try {
    const spec = { ...stairSpec(null, 10), shape, mirror };
    const room = { room_type: "staircase", x: 5, y: 7, x2: 5 + L, y2: 7 + W };
    const lvl = 0.3;
    const patches = stairWalkPatches(room, lvl, spec, entryHigh);
    import_strict.default.ok(patches.length >= spec.n - 2, `too few patches (${patches.length} for ${spec.n} risers)`);
    for (const p of patches) {
      import_strict.default.equal(p.pts.length, 4);
      for (const [x, z] of p.pts) import_strict.default.ok(x >= 5 - 0.2 && x <= 5 + L + 0.2 && z >= 7 - 0.2 && z <= 7 + W + 0.2, `patch corner more than 0.2 ft outside the stair room: ${x},${z}`);
      import_strict.default.ok(p.top >= lvl - 1e-6 && p.top <= lvl + spec.n * spec.riser + 1e-6, `patch height out of range: ${p.top}`);
    }
    const tops = [...new Set(patches.map((p) => +p.top.toFixed(3)))].sort((a, b) => a - b);
    for (let i = 1; i < tops.length; i++) import_strict.default.ok(tops[i] - tops[i - 1] <= spec.riser * 1.02 + 1e-6, `gap of ${(tops[i] - tops[i - 1]).toFixed(2)} ft between walk levels`);
    import_strict.default.ok(tops[tops.length - 1] >= lvl + (spec.n - 1) * spec.riser - 1e-6, "the patches reach the upper floor");
  } catch (e) {
    fails.push(`${tag}: ${e.message}`);
  }
}
console.log(JSON.stringify({ passed: n - fails.length, total: n, failed: fails.slice(0, 10) }));
process.exit(fails.length ? 1 : 0);
