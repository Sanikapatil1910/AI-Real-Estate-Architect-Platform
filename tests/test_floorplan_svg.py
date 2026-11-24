import copy
import unittest

from backend.renderer.floorplan_svg import furniture_svg, render_floor_plan


class FloorPlanSvgTests(unittest.TestCase):
    def test_rendering_does_not_modify_room_geometry(self):
        rooms = [
            {
                "room_type": "master_bedroom",
                "x": 3,
                "y": 5,
                "width": 12,
                "length": 14,
                "x2": 15,
                "y2": 19,
            },
        ]
        original = copy.deepcopy(rooms)
        render_floor_plan(
            {"rooms": rooms},
            {"width": 40, "length": 50},
            {"x": 3, "y": 5, "width": 34, "length": 42},
            "North",
        )
        self.assertEqual(rooms, original)

    def test_furniture_branches_include_architectural_symbols(self):
        symbols = {
            "living_room": ("<path", "<ellipse", "#6c9a63"),
            "master_bedroom": ("#b4875b", "<path", "#d3cbc0"),
            "dining": ("rx=\"3\"", "#d8c5ae"),
            "kitchen": ("#4a90a4", "#555", "#e8eef0"),
            "bathroom": ("#4a90a4", "<ellipse", "stroke-dasharray"),
            "utility": ("#4a90a4", "<circle", "#e6e8e6"),
        }
        for room_type, expected in symbols.items():
            with self.subTest(room_type=room_type):
                svg = furniture_svg(room_type, 0, 0, 120, 120, 12)
                for marker in expected:
                    self.assertIn(marker, svg)

    def test_outdoor_features_render_as_geometry(self):
        layout = {
            "rooms": [],
            "balcony": {"exists": True, "x": 3, "y": 20, "width": 6, "length": 5},
            "garden": {"exists": True, "x": 3, "y": 5, "width": 10, "length": 8},
            "terrace": {
                "exists": True, "x": 3, "y": 5, "width": 34, "length": 42,
                "solar_panels": {"x": 5, "y": 7, "width": 8, "length": 6},
                "garden": {"x": 25, "y": 35, "width": 8, "length": 8},
            },
        }
        svg = render_floor_plan(
            layout, {"width": 40, "length": 50},
            {"x": 3, "y": 5, "width": 34, "length": 42}, "North",
        )
        for marker in ("BALCONY", "GARDEN", "TERRACE", "SOLAR", "TERRACE GARDEN"):
            self.assertIn(marker, svg)

    def test_renders_open_space_regions_and_labels(self):
        plot = {"width": 40, "length": 50}
        usable_plot = {
            "x": 3,
            "y": 5,
            "width": 34,
            "length": 42,
        }
        layout = {
            "rooms": [
                {
                    "room_type": "living_room",
                    "x": 3,
                    "y": 32,
                    "width": 12,
                    "length": 10,
                    "x2": 15,
                    "y2": 42,
                },
            ],
            "open_spaces": {
                "regions": [
                    {
                        "type": "front_open_space",
                        "x": 3,
                        "y": 37,
                        "width": 10,
                        "length": 5,
                    },
                    {
                        "type": "rear_open_space",
                        "x": 3,
                        "y": 5,
                        "width": 10,
                        "length": 5,
                    },
                    {
                        "type": "side_open_space",
                        "x": 25,
                        "y": 15,
                        "width": 5,
                        "length": 8,
                    },
                    {
                        "type": "courtyard",
                        "x": 14,
                        "y": 15,
                        "width": 10,
                        "length": 10,
                    },
                    {
                        "type": "circulation",
                        "x": 14,
                        "y": 27,
                        "width": 4,
                        "length": 8,
                    },
                    {
                        "type": "future_expansion",
                        "x": 0,
                        "y": 0,
                        "width": 50,
                        "length": 60,
                    },
                ],
            },
        }

        svg = render_floor_plan(
            layout=layout,
            plot=plot,
            usable_plot=usable_plot,
            road_side="North",
        )

        for label in (
            "FRONT OPEN SPACE",
            "REAR OPEN SPACE",
            "SIDE OPEN SPACE",
            "COURTYARD",
            "CIRCULATION",
            "FUTURE EXPANSION",
        ):
            self.assertIn(label, svg)

        self.assertIn("url(#open-space-hatch)", svg)
        self.assertIn("10 × 5 ft", svg)
        self.assertNotIn('width="600.0"', svg)
        self.assertNotIn('height="720.0"', svg)

    def test_layout_without_open_spaces_still_renders(self):
        svg = render_floor_plan(
            layout={
                "rooms": [
                    {
                        "room_type": "living_room",
                        "x": 3,
                        "y": 5,
                        "width": 12,
                        "length": 10,
                        "x2": 15,
                        "y2": 15,
                    },
                ],
            },
            plot={"width": 40, "length": 50},
            usable_plot={
                "x": 3,
                "y": 5,
                "width": 34,
                "length": 42,
            },
        )

        self.assertIn("<svg", svg)
        self.assertNotIn("open-space-hatch", svg)

    def test_furnished_rooms_and_openings_are_rendered(self):
        rooms = [
            {"room_type": "living_room", "x": 3, "y": 5, "width": 12, "length": 10, "x2": 15, "y2": 15},
            {"room_type": "bedroom", "x": 15, "y": 5, "width": 10, "length": 10, "x2": 25, "y2": 15},
        ]
        layout = {
            "rooms": rooms,
            "openings": {
                "doors": [
                    {"door_type": "main", "room": "living_room", "wall": "bottom", "width": 4, "position": 4},
                    {"door_type": "internal", "room": "living_room", "connects_to": "bedroom", "wall": "right", "width": 3, "position": 3},
                ],
                "windows": [
                    {"room": "living_room", "wall": "left", "width": 5, "position": 2},
                ],
            },
        }
        svg = render_floor_plan(layout, {"width": 40, "length": 50},
                                {"x": 3, "y": 5, "width": 34, "length": 42}, "South")
        self.assertIn("room-clip-living-room", svg)
        self.assertIn("stroke=\"#9a6842\"", svg)
        self.assertIn("stroke=\"#4a90a4\"", svg)
        self.assertIn("url(#room-shadow)", svg)

    def test_doors_have_leaf_and_swing_symbols(self):
        layout = {
            "rooms": [
                {"room_type": "living_room", "x": 3, "y": 5, "width": 12, "length": 10, "x2": 15, "y2": 15},
            ],
            "openings": {
                "doors": [
                    {"door_type": "main", "room": "living_room", "wall": "bottom", "width": 4, "position": 4},
                    {"door_type": "internal", "room": "living_room", "wall": "right", "width": 3, "position": 3},
                ],
            },
        }
        svg = render_floor_plan(layout, {"width": 40, "length": 50}, {"x": 3, "y": 5, "width": 34, "length": 42}, "South")
        self.assertEqual(svg.count('data-opening="door-leaf"'), 2)
        self.assertEqual(svg.count('data-opening="door-swing"'), 2)
        self.assertIn('data-opening="door-gap"', svg)

    def test_windows_have_parallel_frame_lines_and_opening_coordinates_are_unchanged(self):
        window = {"room": "living_room", "wall": "left", "width": 5, "position": 2}
        layout = {
            "rooms": [
                {"room_type": "living_room", "x": 3, "y": 5, "width": 12, "length": 10, "x2": 15, "y2": 15},
            ],
            "openings": {"windows": [window]},
        }
        original = copy.deepcopy(window)
        svg = render_floor_plan(layout, {"width": 40, "length": 50}, {"x": 3, "y": 5, "width": 34, "length": 42}, "North")
        self.assertIn('data-opening="window-frame"', svg)
        self.assertEqual(svg.count('stroke="#4a90a4"'), 3)
        self.assertEqual(window, original)

    def test_parking_and_material_patterns_are_rendered(self):
        layout = {
            "rooms": [
                {"room_type": "kitchen", "x": 3, "y": 5, "width": 10, "length": 10, "x2": 13, "y2": 15},
            ],
            "openings": {},
        }
        usable = {
            "x": 3, "y": 5, "width": 34, "length": 42,
            "reserved_regions": [
                {"room_type": "parking", "x": 15, "y": 5, "width": 9, "length": 18},
            ],
        }
        svg = render_floor_plan(layout, {"width": 40, "length": 50}, usable, "South")
        self.assertIn("parking-pattern", svg)
        self.assertIn('data-parking="0"', svg)
        self.assertIn("tile-pattern", svg)


if __name__ == "__main__":
    unittest.main()
