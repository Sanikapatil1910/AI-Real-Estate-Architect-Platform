"""Exact sizing of a band layout.

A floor is a stack of *bands* along the B axis; each band is a row of *cells*
along the A axis; a cell holds one room, or two rooms stacked across the band
depth.  Given the footprint, this module finds band depths and cell widths on a
6-inch grid so that

  * the bands tile the footprint exactly (no gaps, no overlaps), and
  * every room obeys its dimension rule (short side, long side, area, aspect),

while keeping rooms as close as possible to their target areas.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Dict, List, Optional, Sequence, Tuple

from backend.planner.architect.rules import BATH_MAX_SHARE_OF_PARENT, BEDROOM_TYPES, EPS, GRID, room_ok, rule_for

MAX_SPAN = 64.0


def _pair_ok(t1: str, t2: str, a1: float, a2: float) -> bool:
    """A bathroom stacked with its bedroom stays at most 60 % of the bedroom's area."""
    if t2 == "bathroom" and t1 in BEDROOM_TYPES:
        return a2 <= BATH_MAX_SHARE_OF_PARENT * a1 + EPS
    if t1 == "bathroom" and t2 in BEDROOM_TYPES:
        return a1 <= BATH_MAX_SHARE_OF_PARENT * a2 + EPS
    return True


# --------------------------------------------------------------------------
# Cell bounds
# --------------------------------------------------------------------------
@lru_cache(maxsize=None)
def single_bounds(rtype: str, d: float) -> Optional[Tuple[float, float]]:
    """Allowed A-extent range [lo, hi] for a room in a band of depth d."""
    rule = rule_for(rtype)
    from backend.planner.architect.rules import PARK_MIN_DEPTH
    if rtype in PARK_MIN_DEPTH and d < PARK_MIN_DEPTH[rtype] - EPS:
        return None                      # a porch must be deep enough for the vehicle
    lo = hi = None
    w = GRID * 4
    while w <= MAX_SPAN + EPS:
        if room_ok(rule, w, d):
            if lo is None:
                lo = w
            hi = w
        w += GRID
    return None if lo is None else (lo, hi)


@lru_cache(maxsize=None)
def stack_bounds(t1: str, t2: str, d: float) -> Optional[Tuple[float, float]]:
    r1, r2 = rule_for(t1), rule_for(t2)
    lo = hi = None
    w = GRID * 4
    while w <= 24.0 + EPS:
        ok = False
        e = GRID * 6
        while e <= d - GRID * 6 + EPS:
            if room_ok(r1, w, e) and room_ok(r2, w, d - e) and _pair_ok(t1, t2, w * e, w * (d - e)):
                ok = True
                break
            e += GRID
        if ok:
            if lo is None:
                lo = w
            hi = w
        w += GRID
    return None if lo is None else (lo, hi)


@lru_cache(maxsize=None)
def cell_bounds(types: Tuple[str, ...], d: float):
    if len(types) == 1:
        return single_bounds(types[0], d)
    return stack_bounds(types[0], types[1], d)


@lru_cache(maxsize=None)
def stack_split(t1: str, t2: str, w: float, d: float, a1: float, a2: float) -> Optional[float]:
    """Depth e1 given to the first room of a stack of width w in a band of depth d."""
    r1, r2 = rule_for(t1), rule_for(t2)
    want = d * a1 / (a1 + a2)
    best = None
    e = GRID * 6
    while e <= d - GRID * 6 + EPS:
        if room_ok(r1, w, e) and room_ok(r2, w, d - e) and _pair_ok(t1, t2, w * e, w * (d - e)):
            if best is None or abs(e - want) < abs(best - want):
                best = e
        e += GRID
    return best


# --------------------------------------------------------------------------
# Segment sizing (water filling)
# --------------------------------------------------------------------------
@dataclass
class CellPlan:
    types: Tuple[str, ...]
    targets: Tuple[float, ...]          # target areas, one per room in the cell
    fixed_w: Optional[float] = None     # pinned width (staircase on upper floors)
    min_w: Optional[float] = None       # least width (a car porch must fit its vehicles)


def _clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


def _fill(targets: List[float], los: List[float], his: List[float], total: float) -> List[float]:
    """Continuous widths ~ proportional to targets, clamped, summing to total."""
    lo_s, hi_s = 0.0, 50.0
    for _ in range(50):
        mid = (lo_s + hi_s) / 2
        s = sum(_clamp(t * mid, lo, hi) for t, lo, hi in zip(targets, los, his))
        if s < total:
            lo_s = mid
        else:
            hi_s = mid
    return [_clamp(t * hi_s, lo, hi) for t, lo, hi in zip(targets, los, his)]


def size_segment(cells: Sequence[CellPlan], extent: float, d: float):
    """Return (widths, cost) for one segment of a band, or None if infeasible."""
    if not cells:
        return ([], 0.0) if extent < EPS else None
    los, his, tw = [], [], []
    for c in cells:
        if c.fixed_w is not None:
            b = cell_bounds(c.types, d)
            if b is None or not (b[0] - EPS <= c.fixed_w <= b[1] + EPS):
                return None
            los.append(c.fixed_w); his.append(c.fixed_w); tw.append(c.fixed_w)
            continue
        b = cell_bounds(c.types, d)
        if b is None:
            return None
        lo_ = max(b[0], c.min_w) if c.min_w else b[0]
        if lo_ > b[1] + EPS:
            return None
        los.append(lo_); his.append(b[1]); tw.append(max(sum(c.targets) / d, 1.0))
    if sum(los) > extent + EPS or sum(his) < extent - EPS:
        return None
    cont = _fill(tw, los, his, extent)
    w = [_clamp(round(x / GRID) * GRID, lo, hi) for x, lo, hi in zip(cont, los, his)]
    diff = int(round((extent - sum(w)) / GRID))
    guard = 0
    while diff != 0 and guard < 400:
        guard += 1
        if diff > 0:
            cand = [i for i in range(len(w)) if w[i] + GRID <= his[i] + EPS]
            if not cand:
                return None
            i = max(cand, key=lambda k: cont[k] - w[k])
            w[i] += GRID; diff -= 1
        else:
            cand = [i for i in range(len(w)) if w[i] - GRID >= los[i] - EPS]
            if not cand:
                return None
            i = min(cand, key=lambda k: cont[k] - w[k])
            w[i] -= GRID; diff += 1
    if diff != 0:
        return None
    cost = 0.0
    for wi, t, c in zip(w, tw, cells):
        if c.fixed_w is None:
            cost += t * ((wi - t) / t) ** 2
    return w, cost


@dataclass
class BandSpec:
    segments: List[Tuple[List[CellPlan], float]]     # (cells, A-extent) per segment
    fixed_depth: Optional[float] = None
    min_depth: float = 3.5
    max_depth: float = 30.0
    prefer_depth: Optional[float] = None             # soft preference (corridors)


def size_band_at(band: BandSpec, d: float):
    total = 0.0
    out = []
    for cells, extent in band.segments:
        r = size_segment(cells, extent, d)
        if r is None:
            return None
        out.append(r[0]); total += r[1]
    if band.prefer_depth:
        total += 4.0 * (d - band.prefer_depth) ** 2
    return out, total


def size_bands(bands: List[BandSpec], B: float, core: Optional[Tuple[int, float]] = None):
    """Choose band depths summing to B. Returns [(depth, [segment widths...]), ...] and cost."""
    n = len(bands)
    steps = int(round(B / GRID))
    options: List[Dict[int, Tuple[float, list]]] = []
    for band in bands:
        opts: Dict[int, Tuple[float, list]] = {}
        if band.fixed_depth is not None:
            ds = [band.fixed_depth]
        else:
            ds = []
            d = band.min_depth
            top = min(band.max_depth, B)
            while d <= top + EPS:
                ds.append(d)
                d += GRID
        for d in ds:
            r = size_band_at(band, d)
            if r is not None:
                opts[int(round(d / GRID))] = (r[1], r[0])
        if not opts:
            return None
        options.append(opts)
    INF = float("inf")
    best = [dict() for _ in range(n + 1)]
    best[0][0] = (0.0, None, None)
    for k in range(n):
        for used, (c0, _, _) in best[k].items():
            if core is not None and k == core[0] and used != int(round(core[1] / GRID)):
                continue
            for dk, (ck, _) in options[k].items():
                u2 = used + dk
                if u2 > steps:
                    continue
                c2 = c0 + ck
                cur = best[k + 1].get(u2)
                if cur is None or c2 < cur[0]:
                    best[k + 1][u2] = (c2, used, dk)
    if steps not in best[n]:
        return None
    total_cost = best[n][steps][0]
    chosen = []
    used = steps
    for k in range(n, 0, -1):
        _, prev, dk = best[k][used]
        chosen.append(dk)
        used = prev
    chosen.reverse()
    result = []
    for k, dk in enumerate(chosen):
        result.append((dk * GRID, options[k][dk][1]))
    return result, total_cost


@lru_cache(maxsize=None)
def _seg_feasible_depths(types_key: Tuple[Tuple[str, ...], ...], fixed: Tuple[Optional[float], ...],
                         extent: float, lo: float, hi: float, minw: Tuple[Optional[float], ...] = ()) -> frozenset:
    """Depths (in grid steps) at which the cells can fill `extent` ignoring targets."""
    out = []
    d = lo
    while d <= hi + EPS:
        slo = shi = 0.0
        ok = True
        minw_ = minw or (None,) * len(types_key)
        for t, fw, mw in zip(types_key, fixed, minw_):
            b = cell_bounds(t, d)
            if b is None:
                ok = False
                break
            if fw is not None:
                if not (b[0] - EPS <= fw <= b[1] + EPS):
                    ok = False
                    break
                slo += fw; shi += fw
            else:
                lo_ = max(b[0], mw) if mw else b[0]
                if lo_ > b[1] + EPS:
                    ok = False
                    break
                slo += lo_; shi += b[1]
        if ok and slo <= extent + EPS and shi >= extent - EPS:
            out.append(int(round(d / GRID)))
        d += GRID
    return frozenset(out)


def band_depth_options(band: "BandSpec", B: float) -> frozenset:
    """Cheap feasibility pre-check: depths (grid steps) where every segment fits."""
    if band.fixed_depth is not None:
        lo = hi = band.fixed_depth
    else:
        lo, hi = band.min_depth, min(band.max_depth, B)
    res = None
    for cells, extent in band.segments:
        if not cells:
            if extent >= EPS:
                return frozenset()
            continue
        key = tuple(c.types for c in cells)
        fx = tuple(c.fixed_w for c in cells)
        mw = tuple(c.min_w for c in cells)
        f = _seg_feasible_depths(key, fx, extent, lo, hi, mw)
        res = f if res is None else res & f
        if not res:
            return frozenset()
    return res if res is not None else frozenset()


from backend.planner.architect import rules as _rules  # noqa: E402
_rules._CACHE_HOOKS.extend([single_bounds, stack_bounds, cell_bounds, stack_split, _seg_feasible_depths])
