from copy import deepcopy

from backend.planner.dimension_engine import generate_room_dimensions
from backend.planner.road_aware_optimizer import road_aware_layout
from backend.planner.layout_optimizer import TOPOLOGY_PROFILES


PLAN_STRATEGIES = [
    {
        "name": "Space Efficient",
        "key": "space_efficient",
        "description": "Compact rooms with efficient use of available space.",
    },
    {
        "name": "Balanced",
        "key": "balanced",
        "description": "Practical room sizes with a balanced layout.",
    },
    {
        "name": "Comfort",
        "key": "comfort",
        "description": "Larger rooms with greater comfort and open space.",
    },
    {
        "name": "Luxury",
        "key": "luxury",
        "description": "Spacious rooms with a premium planning approach.",
    },
]


def reorder_rooms(rooms, strategy):
    """
    Change room priority/order for different plan styles.
    This helps the layout optimizer produce different arrangements.
    """

    rooms = deepcopy(rooms)

    if strategy == "space_efficient":
        # Compact/service spaces are prioritized early.
        return sorted(
            rooms,
            key=lambda r: (
                r.get("room_type") in [
                    "living_room",
                    "master_bedroom",
                ],
                r.get("area", 0),
            ),
        )

    if strategy == "balanced":
        # Keep the original logical order.
        return rooms

    if strategy == "comfort":
        # Public spaces first, then private spaces.
        priority = {
            "living_room": 1,
            "dining": 2,
            "kitchen": 3,
            "utility": 4,
            "guest_bedroom": 5,
            "master_bedroom": 6,
            "bedroom": 7,
            "bathroom": 8,
            "puja_room": 9,
        }

        return sorted(
            rooms,
            key=lambda r: priority.get(r.get("room_type"), 99),
        )

    if strategy == "luxury":
        # Private/public zones arranged differently.
        priority = {
            "master_bedroom": 1,
            "living_room": 2,
            "guest_bedroom": 3,
            "dining": 4,
            "bedroom": 5,
            "kitchen": 6,
            "puja_room": 7,
            "utility": 8,
            "bathroom": 9,
        }

        return sorted(
            rooms,
            key=lambda r: priority.get(r.get("room_type"), 99),
        )

    return rooms


def generate_single_plan(
    rooms,
    usable_plot,
    road_side="North",
    strategy="balanced",
    vastu_mode="no_preference",
):
    """
    Generate one complete layout using a specific planning strategy.
    """

    # Step 1: Generate strategy-specific dimensions.
    dimensioned_rooms = generate_room_dimensions(
        rooms=rooms,
        strategy=strategy,
        floor_area=usable_plot["area"],
    )

    # Step 2: Change room priority/order.
    ordered_rooms = reorder_rooms(
        dimensioned_rooms,
        strategy,
    )

    # Step 3: Generate actual room positions.
    layout = road_aware_layout(
        rooms=ordered_rooms,
        usable_plot=usable_plot,
        road_side=road_side,
        strategy=strategy,
        vastu_mode=vastu_mode,
    )

    # Store strategy information inside the layout.
    layout["strategy"] = strategy
    layout["topology"] = TOPOLOGY_PROFILES.get(
        strategy,
        "front_public",
    )

    return layout


def generate_multiple_plans(
    rooms,
    usable_plot,
    road_side="North",
    number_of_plans=4,
    vastu_mode="no_preference",
):
    """
    Generate multiple genuinely different house plans.
    """

    plans = []

    selected_strategies = PLAN_STRATEGIES[:number_of_plans]

    for index, strategy_info in enumerate(selected_strategies, start=1):

        layout = generate_single_plan(
            rooms=rooms,
            usable_plot=usable_plot,
            road_side=road_side,
            strategy=strategy_info["key"],
            vastu_mode=vastu_mode,
        )

        plans.append(
            {
                "plan_number": index,
                "name": strategy_info["name"],
                "strategy": strategy_info["key"],
                "topology": TOPOLOGY_PROFILES.get(
                    strategy_info["key"],
                    "front_public",
                ),
                "description": strategy_info["description"],
                "layout": layout,
            }
        )

    return {
        "total_plans": len(plans),
        "plans": plans,
    }