"""Rectangles, shared walls and exterior sides in the canonical frame."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from backend.planner.architect.rules import EPS


@dataclass
class Room:
    id: str
    type: str
    name: str
    floor: int
    u: float
    v: float
    w: float            # extent along u (across the frontage)
    d: float            # extent along v (depth into the plot)
    attached_to: Optional[str] = None
    role: str = ""

    @property
    def u2(self) -> float:
        return self.u + self.w

    @property
    def v2(self) -> float:
        return self.v + self.d

    @property
    def area(self) -> float:
        return self.w * self.d

    @property
    def cu(self) -> float:
        return self.u + self.w / 2

    @property
    def cv(self) -> float:
        return self.v + self.d / 2

    def key(self) -> Tuple:
        return (self.type, self.u, self.v, self.w, self.d)


def shared_wall(a: Room, b: Room) -> Optional[Dict]:
    """Shared wall between two rooms.

    Returns {'axis': 'v'|'u', 'at': coordinate, 'lo': start, 'hi': end,
             'a_side': side of a, 'b_side': side of b}.  A wall with axis 'u'
    runs along u at a fixed v (a horizontal wall in canonical view).
    Sides are 'front' (small v), 'rear' (large v), 'left' (small u), 'right' (large u).
    """
    # walls running along v (vertical in canonical view): rooms side by side in u
    if abs(a.u2 - b.u) < EPS or abs(b.u2 - a.u) < EPS:
        lo = max(a.v, b.v)
        hi = min(a.v2, b.v2)
        if hi - lo > EPS:
            if abs(a.u2 - b.u) < EPS:
                return {"axis": "v", "at": a.u2, "lo": lo, "hi": hi, "a_side": "right", "b_side": "left"}
            return {"axis": "v", "at": a.u, "lo": lo, "hi": hi, "a_side": "left", "b_side": "right"}
    # walls running along u: rooms one behind the other in v
    if abs(a.v2 - b.v) < EPS or abs(b.v2 - a.v) < EPS:
        lo = max(a.u, b.u)
        hi = min(a.u2, b.u2)
        if hi - lo > EPS:
            if abs(a.v2 - b.v) < EPS:
                return {"axis": "u", "at": a.v2, "lo": lo, "hi": hi, "a_side": "rear", "b_side": "front"}
            return {"axis": "u", "at": a.v, "lo": lo, "hi": hi, "a_side": "front", "b_side": "rear"}
    return None


def exterior_sides(room: Room, F: float, D: float) -> Dict[str, float]:
    """Sides of a room lying on the footprint boundary -> wall length."""
    out = {}
    if room.v < EPS:
        out["front"] = room.w
    if abs(room.v2 - D) < EPS:
        out["rear"] = room.w
    if room.u < EPS:
        out["left"] = room.d
    if abs(room.u2 - F) < EPS:
        out["right"] = room.d
    return out


def overlap(a: Room, b: Room) -> bool:
    return not (a.u2 <= b.u + EPS or b.u2 <= a.u + EPS or a.v2 <= b.v + EPS or b.v2 <= a.v + EPS)


def tiles_exactly(rooms: List[Room], F: float, D: float, tol: float = 1e-4) -> bool:
    """True when rooms exactly tile [0,F]x[0,D] (area sum + no overlap + inside)."""
    area = 0.0
    for r in rooms:
        if r.u < -tol or r.v < -tol or r.u2 > F + tol or r.v2 > D + tol:
            return False
        area += r.area
    if abs(area - F * D) > 1e-3:
        return False
    for i in range(len(rooms)):
        for j in range(i + 1, len(rooms)):
            if overlap(rooms[i], rooms[j]):
                return False
    return True
