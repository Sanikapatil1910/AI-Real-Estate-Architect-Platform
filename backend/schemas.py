import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

_proj = Path(__file__).resolve().parents[1]
_local_deps = _proj / "_pydeps"
if _local_deps.exists():
    sys.path.insert(0, str(_local_deps))

from pydantic import BaseModel, EmailStr, Field, field_validator

from backend.models import UserRole
from backend.planner.style_knowledge import canonical_style


class SignupRequest(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=128)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)
    role: UserRole

    @field_validator("full_name")
    @classmethod
    def full_name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("full_name cannot be empty")
        return v.strip()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: int
    full_name: str
    email: str
    role: UserRole
    created_at: datetime

    class Config:
        from_attributes = True


class SetbacksRequest(BaseModel):
    front: float = 0
    rear: float = 0
    left: float = 0
    right: float = 0


class FamilyContext(BaseModel):
    family_size: Optional[int] = None
    adults: Optional[int] = None
    children: Optional[int] = None
    elderly: Optional[int] = None
    frequent_guests: Optional[bool] = None
    lifestyle: Optional[str] = None


class RoomRequest(BaseModel):
    room_type: str


class GenerateRequest(BaseModel):
    plot_width: float
    plot_length: float
    frontage_ft: Optional[float] = None             # which plot dimension faces the road (must equal plot_width or plot_length)
    road_side: str = "North"
    setbacks: SetbacksRequest = Field(default_factory=SetbacksRequest)
    rooms: List[RoomRequest] = Field(default_factory=list)
    building_type: str = "Ground"
    number_of_plans: int = 4
    include_terrace: bool = False                   # a terrace only when asked for: the roof terrace over the top floor
    parking_required: bool = False
    parking_spaces: int = 1
    parking_type: str = ""          # '1 Car' | '2 Cars' | 'Bikes' | 'Car + Bikes' (what the twin shows)
    floor_height: float = 10
    stair_width: float = 3.5
    vastu_mode: str = "no_preference"
    architectural_style: str = "Modern Minimalistic"      # "Modern Minimalistic", "Traditional Indian" or "Maharashtrian Wada"; names of earlier versions are mapped
    family_context: Optional[FamilyContext] = None
    climate: str = "Auto"
    balcony_required: bool = False
    garden_required: bool = False
    terrace_features: Optional[Any] = None
    ventilation: str = "Balanced"                   # Balanced | High | Cross ventilation (High/Cross: puja and dining open, no walls)
    puja_style: str = "closed"                      # closed | open
    strict: bool = True                              # exact brief: never add/drop rooms, floors or parking behind the user's back
    floor_rooms: Optional[List[List[str]]] = None   # exact rooms per floor (index 0 = ground); overrides automatic floor placement
    common_toilet: str = "attached"   # "attached" = toilet + bath in one room (default) | "separate" = WC and bath apart
    chajja_projection_ft: Optional[float] = None   # chajja (sun-shade) projection over every window; default 1.5 ft
    chajja_thickness_ft: Optional[float] = None    # chajja slab thickness; default 0.33 ft
    roof_overhang_ft: Optional[float] = None       # how far flat roof slabs project beyond the walls (0.5-3 ft, default 1.5), limited by the plot edge
    balcony_projection_ft: Optional[float] = None  # how far an upper-floor balcony may cantilever beyond the enclosed floor (0-4 ft, default 3), limited by the setback
    approved_adjustments: List[str] = []   # ids of the preference changes the user approved (see POST /adjustments); nothing else is ever changed
    closest_if_infeasible: bool = False  # strict mode: when the exact brief cannot be planned, also return the closest valid alternative (labelled)

    @field_validator("architectural_style", mode="before")
    @classmethod
    def only_supported_styles(cls, v: Any) -> str:
        """Saved projects and old clients may still send a removed style name: it becomes the supported style it stands for."""
        return canonical_style(v)

    def to_payload(self) -> Dict[str, Any]:
        ctx: Optional[Dict[str, Any]] = None
        if self.family_context is not None:
            ctx = {
                k: v for k, v in self.family_context.model_dump().items()
                if v is not None
            }
        return {
            "plot_width": self.plot_width,
            "plot_length": self.plot_length,
            "frontage_ft": self.frontage_ft,
            "road_side": self.road_side,
            "setbacks": self.setbacks.model_dump(),
            "rooms": [r.model_dump() for r in self.rooms],
            "building_type": self.building_type,
            "number_of_plans": self.number_of_plans,
            "include_terrace": self.include_terrace,
            "parking_required": self.parking_required,
            "parking_spaces": self.parking_spaces,
            "parking_type": self.parking_type,
            "floor_height": self.floor_height,
            "stair_width": self.stair_width,
            "vastu_mode": self.vastu_mode,
            "architectural_style": self.architectural_style,
            "family_context": ctx,
            "climate": self.climate,
            "balcony_required": self.balcony_required,
            "garden_required": self.garden_required,
            "terrace_features": self.terrace_features,
            "floor_rooms": self.floor_rooms,
            "strict": self.strict,
            "ventilation": self.ventilation,
            "puja_style": "open" if str(self.puja_style).lower() == "open" else "closed",
            "common_toilet": "separate" if str(self.common_toilet).lower() == "separate" else "attached",
            "closest_if_infeasible": bool(self.closest_if_infeasible),
            "approved_adjustments": list(self.approved_adjustments or []),
            "chajja_projection_ft": self.chajja_projection_ft,
            "chajja_thickness_ft": self.chajja_thickness_ft,
            "roof_overhang_ft": self.roof_overhang_ft,
            "balcony_projection_ft": self.balcony_projection_ft,
        }
