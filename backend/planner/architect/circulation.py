"""Building-wide circulation: which spaces a person can really walk through, and the rules every floor must obey.

One small rule set, used twice:

* while doors are chosen (``doors.plan_openings`` asks :func:`may_walk_through` before it lets a room lead on to another one), so a
  layout that would need a terrace or a bedroom as a corridor is never produced, and
* on the finished plan (:func:`analyse_building`, called by ``verify.verify_plan``), re-derived from the real room rectangles and door
  segments, so a plan can only be accepted when its indoor circulation is valid.

Vocabulary
    indoor   every enclosed room: living, dining, kitchen, bedrooms, bathrooms, passage, family lounge, stair, ...
    outdoor  open terrace, balcony, parking porch, garden.  Outdoor space is never part of the indoor circulation graph: a person may
             step out onto it, but no indoor room may depend on crossing it.
    common   spaces that may be walked *through*: passage / corridor, family lounge, living room, dining room and (as the arrival
             landing) the staircase of an upper floor.
    private  everything else.  A bedroom leads only to its own bathroom, a kitchen only to its utility; a bathroom, utility, puja
             room, study or store is a dead end.  None of them is a route to an unrelated room.

An edge of the graph exists only where a door (or open arch) lies on the wall the two rooms really share and is wide enough to pass.
Rooms that merely touch, or whose centres are close, are not connected.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from backend.planner.architect.rules import BEDROOM_TYPES, door_allowed

OUTDOOR = frozenset({"open_terrace", "balcony", "parking", "bike_parking", "garden"})
TERRACE_TYPES = frozenset({"open_terrace", "balcony"})
# indoor spaces that may be walked through to reach other rooms
COMMON = frozenset({"passage", "family_lounge", "living_room", "dining"})
# the spaces that make up an upper floor's arrival circulation (a stair landing leads on to one of these)
LANDING_HUBS = frozenset({"passage", "family_lounge"})
MIN_DOOR_WIDTH = 2.4            # ft: clear opening that a person (and a wheelchair-ish width) can pass
MIN_CORRIDOR = 3.0              # ft: narrowest a walked-through passage may be
TOL = 0.06
# an upper floor with more rooms than this to enter needs a real corridor / lobby; fewer can open straight off the stair landing
MAX_DIRECT_FROM_LANDING = 2


def is_outdoor(room_type: str) -> bool:
    return room_type in OUTDOOR


def may_walk_through(u_type: str, u_id: str, v_type: str, v_attached_to: Optional[str], is_entry: bool) -> bool:
    """May a person who has entered room ``u`` carry on into room ``v`` (and so use ``u`` as part of a route)?

    This is the single definition of "a room is not a corridor": it is used both when doors are planned and when a finished plan
    is checked."""
    if u_type in OUTDOOR:
        return False
    if is_entry:
        return True
    if u_type in COMMON:
        return True
    if u_type in BEDROOM_TYPES:
        return v_type == "bathroom" and v_attached_to == u_id        # a bedroom leads only to its own bathroom
    if u_type == "kitchen":
        return v_type == "utility"                                   # kitchen -> utility is one working area
    return False                                                     # bathroom, utility, puja, study, store, stair (when not the entry)


# --------------------------------------------------------------------------------------------------------------------
# door geometry
# --------------------------------------------------------------------------------------------------------------------
def _shared_edge(a: Dict[str, Any], b: Dict[str, Any]) -> Optional[Tuple[str, float, float, float]]:
    """('v'|'h', coordinate, lo, hi) of the wall two rectangles share, or None."""
    if abs(a["x2"] - b["x"]) < TOL or abs(b["x2"] - a["x"]) < TOL:
        lo, hi = max(a["y"], b["y"]), min(a["y2"], b["y2"])
        if hi - lo > TOL:
            return ("v", a["x2"] if abs(a["x2"] - b["x"]) < TOL else a["x"], lo, hi)
    if abs(a["y2"] - b["y"]) < TOL or abs(b["y2"] - a["y"]) < TOL:
        lo, hi = max(a["x"], b["x"]), min(a["x2"], b["x2"])
        if hi - lo > TOL:
            return ("h", a["y2"] if abs(a["y2"] - b["y"]) < TOL else a["y"], lo, hi)
    return None


def door_is_valid(door: Dict[str, Any], a: Dict[str, Any], b: Dict[str, Any]) -> Optional[str]:
    """None when the door really opens through the wall shared by rooms a and b, else why not."""
    edge = _shared_edge(a, b)
    if edge is None:
        return "the two rooms share no wall"
    kind, at, lo, hi = edge
    x1, y1, x2, y2 = door["x1"], door["y1"], door["x2"], door["y2"]
    width = abs(x2 - x1) + abs(y2 - y1)
    if width < MIN_DOOR_WIDTH - TOL:
        return f"the opening is only {width:.1f} ft wide"
    if kind == "v":
        on, s, e = abs(x1 - at) < TOL and abs(x2 - at) < TOL, min(y1, y2), max(y1, y2)
    else:
        on, s, e = abs(y1 - at) < TOL and abs(y2 - at) < TOL, min(x1, x2), max(x1, x2)
    if not on or s < lo - TOL or e > hi + TOL:
        return "the opening does not lie on the shared wall"
    return None


# --------------------------------------------------------------------------------------------------------------------
# one floor
# --------------------------------------------------------------------------------------------------------------------
def _issue(rule: str, floor: str, message: str, room: Optional[str] = None, **extra) -> Dict[str, Any]:
    out = {"rule": rule, "floor": floor, "message": message}
    if room:
        out["room"] = room
    out.update(extra)
    return out


def _bfs(start: str, adj: Dict[str, Set[str]], by: Dict[str, Dict[str, Any]], expand) -> Dict[str, Optional[str]]:
    """Breadth-first search; ``expand(u, v)`` says whether the walk may go from u into v.  Returns {room: parent}."""
    parent: Dict[str, Optional[str]] = {start: None}
    queue = [start]
    while queue:
        cur = queue.pop(0)
        for nx in sorted(adj.get(cur, ())):
            if nx not in parent and expand(cur, nx):
                parent[nx] = cur
                queue.append(nx)
    return parent


def _path(parent: Dict[str, Optional[str]], target: str) -> List[str]:
    out = [target]
    while parent[out[-1]] is not None:
        out.append(parent[out[-1]])
    return out[::-1]


def arrival_issues(nodes: Dict[str, Tuple[str, Optional[str]]], adj: Dict[str, Set[str]], entry: str,
                   label: Dict[str, str]) -> List[Tuple[str, str, str]]:
    """The stair-arrival rules of an upper floor, on an abstract door graph (``nodes``: id -> (room type, attached_to);
    ``adj``: id -> ids joined to it by a door).  Shared by the generator (canonical rooms) and the verifier (final plan).
    Returns [(rule, room id, message)]."""
    out: List[Tuple[str, str, str]] = []
    nb = [n for n in adj.get(entry, ())]
    if not nb:
        out.append(("stair-arrival", entry, "the staircase has no door: the landing leads nowhere"))
    elif all(is_outdoor(nodes[n][0]) for n in nb):
        out.append(("stair-arrival", entry, f"the stair arrives only onto {label[nb[0]]}, an open outdoor space, not an indoor landing / corridor"))
    indoor = [i for i, (t, _) in nodes.items() if not is_outdoor(t)]
    entered = [i for i in indoor if i != entry and not (nodes[i][0] == "bathroom" and nodes[i][1])]
    hubs = [i for i in entered if nodes[i][0] in LANDING_HUBS]
    if len(entered) > MAX_DIRECT_FROM_LANDING:
        if not hubs:
            out.append(("no-corridor", entry, f"{len(entered)} rooms must be entered but the floor has no corridor, lobby or lounge; "
                                              "the stair landing cannot serve them all"))
        elif not any(h in adj.get(entry, ()) for h in hubs):
            out.append(("stair-arrival", entry, "the stair does not open onto the floor's corridor / lobby"))
        else:
            for i in entered:                                   # every room is entered from a common space, not from another room
                t = nodes[i][0]
                if t in LANDING_HUBS or is_outdoor(t) or not adj.get(i):      # (a room with no door at all is reported as unreachable)
                    continue
                if not any(nodes[n][0] in LANDING_HUBS or n == entry for n in adj.get(i, ())):
                    out.append(("entered-from-private", i, f"{label[i]} is not entered from a corridor, lobby, lounge or the stair landing"))
    return out


def analyse_floor(layout: Dict[str, Any], floor_name: str, entry_id: Optional[str], upper: bool) -> Dict[str, Any]:
    """Check one floor.  ``entry_id`` is the room a person starts in: the stair on an upper floor, the entry room on the ground floor.
    Returns {'issues': [...], 'reachable': [...], 'indoor': [...], 'outdoor': [...]}."""
    rooms = layout["rooms"]
    by = {r["id"]: r for r in rooms}
    issues: List[Dict[str, Any]] = []
    name = lambda i: by[i].get("name") or by[i]["room_type"]          # noqa: E731
    adj: Dict[str, Set[str]] = {r["id"]: set() for r in rooms}
    doors_of: Dict[str, List[Dict[str, Any]]] = {r["id"]: [] for r in rooms}
    for d in layout["openings"]["doors"]:
        if d.get("connects_to") is None:
            continue
        a, b = by.get(d["room"]), by.get(d["connects_to"])
        if a is None or b is None:
            issues.append(_issue("door-target", floor_name, f"a door joins {d['room']} and {d['connects_to']}, one of which does not exist"))
            continue
        why = door_is_valid(d, a, b)
        if why:
            issues.append(_issue("door-geometry", floor_name, f"door between {name(a['id'])} and {name(b['id'])}: {why}", a["id"]))
            continue
        own_bath = (a["room_type"] == "bathroom" and a.get("attached_to") == b["id"]) or \
                   (b["room_type"] == "bathroom" and b.get("attached_to") == a["id"])
        if not own_bath and not door_allowed(a["room_type"], b["room_type"]) and not (a["room_type"] in OUTDOOR or b["room_type"] in OUTDOOR):
            issues.append(_issue("door-compat", floor_name, f"a door between {name(a['id'])} and {name(b['id'])} connects spaces that must not open into each other", a["id"]))
            continue
        if a["room_type"] in OUTDOOR and b["room_type"] in OUTDOOR:
            issues.append(_issue("door-compat", floor_name, f"a door joins two outdoor spaces: {name(a['id'])} and {name(b['id'])}", a["id"]))
            continue
        adj[a["id"]].add(b["id"]); adj[b["id"]].add(a["id"])
        doors_of[a["id"]].append(d); doors_of[b["id"]].append(d)

    indoor = [r["id"] for r in rooms if not is_outdoor(r["room_type"])]
    outdoor = [r["id"] for r in rooms if is_outdoor(r["room_type"])]
    if entry_id is None or entry_id not in by:
        issues.append(_issue("entry", floor_name, "the floor has no entry / stair-arrival room"))
        return {"issues": issues, "reachable": [], "indoor": indoor, "outdoor": outdoor}

    def walk(u: str, v: str) -> bool:                                  # strict: indoor rooms only, common spaces are the only corridors
        if is_outdoor(by[v]["room_type"]) or is_outdoor(by[u]["room_type"]):
            return False
        return may_walk_through(by[u]["room_type"], u, by[v]["room_type"], by[v].get("attached_to"), u == entry_id)

    def walk_outdoor_ok(u: str, v: str) -> bool:                       # diagnosis: what if a terrace could be crossed
        if by[u]["room_type"] in OUTDOOR:
            return u != v
        return may_walk_through(by[u]["room_type"], u, by[v]["room_type"], by[v].get("attached_to"), u == entry_id)

    def walk_private_ok(u: str, v: str) -> bool:                       # diagnosis: what if any indoor room could be a corridor
        return not is_outdoor(by[u]["room_type"]) and not is_outdoor(by[v]["room_type"])

    reach = _bfs(entry_id, adj, by, walk)
    via_out = _bfs(entry_id, adj, by, walk_outdoor_ok)
    via_priv = _bfs(entry_id, adj, by, walk_private_ok)
    for rid in indoor:
        if rid in reach:
            continue
        r = by[rid]
        if rid in via_out:
            p = _path(via_out, rid)
            crossed = next((x for x in p if by[x]["room_type"] in OUTDOOR), None)
            issues.append(_issue("outdoor-route", floor_name,
                                 f"{name(rid)} can only be reached by crossing {name(crossed)} (an open outdoor space); "
                                 "it needs a door to an indoor corridor, lobby or common room",
                                 rid, via=[name(x) for x in p]))
        elif rid in via_priv:
            p = _path(via_priv, rid)
            thru = next((x for x in p[1:-1] if not may_walk_through(by[x]["room_type"], x, by[p[p.index(x) + 1]]["room_type"],
                                                                      by[p[p.index(x) + 1]].get("attached_to"), x == entry_id)), None)
            issues.append(_issue("private-route", floor_name,
                                 f"{name(rid)} can only be reached by walking through {name(thru) if thru else 'a private room'}; "
                                 "a bedroom, bathroom, kitchen or utility must not be a corridor",
                                 rid, via=[name(x) for x in p]))
        else:
            issues.append(_issue("unreachable", floor_name, f"{name(rid)} has no door route from {name(entry_id)}", rid))

    # outdoor spaces keep their own classification: each must be entered through a door from an indoor room
    for rid in outdoor:
        r = by[rid]
        if r["room_type"] not in TERRACE_TYPES:
            continue
        indoor_doors = [d for d in doors_of[rid]
                        if not is_outdoor(by[d["room"] if d["connects_to"] == rid else d["connects_to"]]["room_type"])]
        if not indoor_doors:
            issues.append(_issue("outdoor-entry", floor_name, f"{name(rid)} has no door from an indoor room", rid))

    # stair arrival (upper floors): the stair must open onto indoor circulation; a floor with several rooms needs a real corridor / lobby
    if upper:
        nodes = {r["id"]: (r["room_type"], r.get("attached_to")) for r in rooms}
        label = {r["id"]: name(r["id"]) for r in rooms}
        for rule, rid, msg in arrival_issues(nodes, adj, entry_id, label):
            issues.append(_issue(rule, floor_name, msg, rid))
    # corridors that are walked through must be wide enough
    for rid in indoor:
        r = by[rid]
        if r["room_type"] == "passage" and len([n for n in adj[rid] if not is_outdoor(by[n]["room_type"])]) >= 2:
            if min(r["width"], r["length"]) < MIN_CORRIDOR - TOL:
                issues.append(_issue("corridor-width", floor_name,
                                     f"{name(rid)} is only {min(r['width'], r['length']):.1f} ft wide; a corridor must be at least {MIN_CORRIDOR:g} ft", rid))
    return {"issues": issues, "reachable": sorted(reach), "indoor": indoor, "outdoor": outdoor}


# --------------------------------------------------------------------------------------------------------------------
# the building
# --------------------------------------------------------------------------------------------------------------------
def analyse_building(plan: Dict[str, Any]) -> Dict[str, Any]:
    """Circulation report for a finished plan: every floor on its own, and the stair chain between floors."""
    floors = plan["floors"]
    issues: List[Dict[str, Any]] = []
    per_floor = []
    stairs = []
    for fi, fl in enumerate(floors):
        lay = fl["layout"]
        st = next((r for r in lay["rooms"] if r["room_type"] == "staircase"), None)
        entry = lay["openings"]["circulation"]["entry_room"] if fi == 0 else (st["id"] if st else None)
        rep = analyse_floor(lay, fl["floor"], entry, upper=fi > 0)
        issues += rep["issues"]
        per_floor.append({"floor": fl["floor"], "entry": entry, "indoor_rooms": len(rep["indoor"]),
                          "outdoor_rooms": len(rep["outdoor"]), "reachable_indoor": len(rep["reachable"]),
                          "issues": rep["issues"]})
        if st:
            stairs.append((fl["floor"], st))
        elif len(floors) > 1:
            issues.append(_issue("stair-chain", fl["floor"], "a multi-floor house has no staircase on this floor"))
    for (n0, s0), (n1, s1) in zip(stairs, stairs[1:]):                 # the stair continues where it arrived
        if max(abs(s0[k] - s1[k]) for k in ("x", "y", "x2", "y2")) > TOL:
            issues.append(_issue("stair-chain", n1, f"the staircase on {n1} is not directly above the one on {n0}"))
    return {"passed": not issues, "issues": issues, "floors": per_floor,
            "errors": [f"{i['floor']}: {i['message']}" for i in issues]}
