"""Architect engine: tiled, verified residential floor plans.

Unlike the legacy heuristic placer, every floor is a complete tiling of the
building footprint (rooms + circulation, no gaps and no overlaps), sized from
architectural dimension rules, wired with doors on shared walls, and verified
by an independent checker before a plan is returned.

Coordinate convention (shared with the renderers and the 3D viewer):
x grows east, y grows SOUTH (screen coordinates), so north is the small-y edge.
All lengths are feet.
"""
