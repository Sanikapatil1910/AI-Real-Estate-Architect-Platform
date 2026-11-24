"""Site model and the canonical <-> real coordinate mapping.

Planning is done in a *canonical frame* seen from the street:
    u : across the frontage, measured to the viewer's right (0 = left corner)
    v : into the plot, measured from the road (0 = road edge)
Real coordinates use the screen convention (x east, y south, north = small y).
A viewer standing on the road looks into the plot:
    road South -> looks north : x = u,        y = L - v
    road North -> looks south : x = W - u,    y = v
    road East  -> looks west  : x = W - v,    y = L - u
    road West  -> looks east  : x = v,        y = u
(all four are rotations, never reflections, so Vastu directions stay true).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Tuple

from backend.planner.architect.rules import CAR_BAY_L, CAR_BAY_W, GRID

PARKING_BAY_W = CAR_BAY_W                 # 9 ft: car + door clearance (see rules.VEHICLE_FT / BAY_CLEARANCE_FT)
PARKING_BAY_L = CAR_BAY_L + 3.0           # 18 ft: the comfortable length the planner aims for; the least it accepts is CAR_BAY_L


_PARKING_MIX = {"1 Car": (1, 0), "2 Cars": (2, 0), "Bikes": (0, 3), "Car + Bikes": (1, 2)}


def parking_mix(parking_required: bool, parking_spaces, parking_type: str = "") -> Tuple[int, int]:
    """(cars, bikes) the user wants parked."""
    if not parking_required:
        return 0, 0
    n = int(parking_spaces or 1)
    return _PARKING_MIX.get(str(parking_type or ""), (n, 0))


def snap_down(value: float, grid: float = GRID) -> float:
    return int(value / grid + 1e-9) * grid


def snap_up(value: float, grid: float = GRID) -> float:
    q = value / grid
    n = int(q)
    if q - n > 1e-9:
        n += 1
    return n * grid


@dataclass
class Site:
    plot_w: float
    plot_l: float
    road_side: str
    front: float = 0.0
    rear: float = 0.0
    left: float = 0.0     # viewer's left, looking from the road into the plot
    right: float = 0.0
    parking_spaces: int = 0
    garden_required: bool = False
    cars: int = 0
    bikes: int = 0

    # ---- canonical dimensions ------------------------------------------
    @property
    def frontage(self) -> float:
        return self.plot_w if self.road_side in ("North", "South") else self.plot_l

    @property
    def depth(self) -> float:
        return self.plot_l if self.road_side in ("North", "South") else self.plot_w

    @property
    def usable_frontage(self) -> float:
        return max(0.0, self.frontage - self.left - self.right)

    @property
    def usable_depth(self) -> float:
        return max(0.0, self.depth - self.front - self.rear)

    @property
    def parking_depth(self) -> float:
        return PARKING_BAY_L if self.parking_spaces else 0.0

    # ---- mapping ----------------------------------------------------------
    def rect_to_real(self, u: float, v: float, w: float, d: float) -> Tuple[float, float, float, float]:
        """Canonical rect (u, v, w across, d deep) -> real (x, y, width, length)."""
        W, L = self.plot_w, self.plot_l
        r = self.road_side
        if r == "South":
            return (u, L - v - d, w, d)
        if r == "North":
            return (W - u - w, v, w, d)
        if r == "East":
            return (W - v - d, L - u - w, d, w)
        if r == "West":
            return (v, u, d, w)
        raise ValueError(f"bad road side {r}")

    def usable_real(self) -> Dict[str, float]:
        x, y, w, l = self.rect_to_real(self.left, self.front, self.usable_frontage, self.usable_depth)
        return {"x": round(x, 2), "y": round(y, 2), "width": round(w, 2),
                "length": round(l, 2), "area": round(w * l, 2)}

    def wall_toward_road(self) -> str:
        return {"North": "top", "South": "bottom", "East": "right", "West": "left"}[self.road_side]


def site_from_request(plot_w, plot_l, road_side, setbacks=None, parking_required=False,
                      parking_spaces=1, garden_required=False, parking_type="") -> Site:
    """Build a Site. setbacks are given as front/rear/left/right where *front*
    is the road side and *left/right* are seen from the road."""
    sb = setbacks or {}
    return Site(
        plot_w=float(plot_w), plot_l=float(plot_l), road_side=road_side,
        front=float(sb.get("front", 0) or 0), rear=float(sb.get("rear", 0) or 0),
        left=float(sb.get("left", 0) or 0), right=float(sb.get("right", 0) or 0),
        parking_spaces=int(parking_spaces) if parking_required else 0,
        garden_required=bool(garden_required),
        cars=parking_mix(parking_required, parking_spaces, parking_type)[0],
        bikes=parking_mix(parking_required, parking_spaces, parking_type)[1],
    )
