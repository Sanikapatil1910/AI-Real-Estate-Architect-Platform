"""Prompt contract for a future semantic requirement provider.

The current parser is deterministic because this project has no configured LLM
provider. Any future provider must return this schema and must never emit geometry.
"""

REQUIREMENT_EXTRACTION_PROMPT = """
Extract only architectural requirements from the user's text as JSON.
Return plot, house, family, preferences, planning, and rooms fields when known.
Do not invent missing values. Do not return coordinates, room geometry, or layouts.
Canonical values: road_side North/South/East/West; vastu_mode no_preference/basic/strict;
architectural_style uses the project's display names; climate uses the project's display names.
""".strip()
