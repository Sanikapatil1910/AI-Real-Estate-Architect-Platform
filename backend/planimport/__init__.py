"""Upload a 2D floor-plan image -> Gemini reads it -> editable canonical plan -> deterministic 3D twin.

Gemini only *reads* the drawing (structured output: what is detected, what is inferred, what is unknown).  Everything after that --
scale, snapping, openings, validation and the plan that the 3D viewer builds -- is deterministic code in this package.
"""
