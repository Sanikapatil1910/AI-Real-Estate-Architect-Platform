
import json
import streamlit as st

from backend.planner.plot_rules import create_plot
from backend.planner.multi_floor_multi_layout import generate_project_plans
from backend.renderer.floorplan_svg import render_floor_plan
from backend.ai.requirement_parser import parse_requirements
from backend.ai.requirement_summary import summarize_requirements, build_clarification_questions
from backend.ai.requirement_adapter import plan_from_text

st.set_page_config(
    page_title="AI Real Estate Architect",
    page_icon="🏠",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown("""
<style>
[data-testid="stAppViewContainer"] {
    background: linear-gradient(180deg, #f7f9fc 0%, #ffffff 45%);
}
.hero {
    padding: 2rem 2.2rem;
    border-radius: 24px;
    background: linear-gradient(135deg, #172033, #263a5a);
    color: white;
    margin-bottom: 1.2rem;
}
.hero h1 { margin: 0; font-size: 2.4rem; }
.hero p { margin: .5rem 0 0; opacity: .85; font-size: 1.05rem; }
.section-card {
    padding: 1rem 1.2rem;
    border: 1px solid #e5e9f0;
    border-radius: 16px;
    background: white;
}
.plan-card {
    padding: 1rem;
    border: 1px solid #e2e7ef;
    border-radius: 18px;
    background: white;
    box-shadow: 0 5px 20px rgba(20,30,50,.06);
}
.small-muted { color: #687386; font-size: .88rem; }
</style>
""", unsafe_allow_html=True)

st.markdown("""
<div class="hero">
  <h1>🏠 AI Real Estate Architect</h1>
  <p>Architectural decision-making system for functional, Vastu-aware and explainable house planning.</p>
</div>
""", unsafe_allow_html=True)

# ----------------------------- INPUTS -----------------------------
st.sidebar.title("Project Configuration")

with st.sidebar.expander("📍 1. Site & Plot", expanded=True):
    unit = st.selectbox("Unit", ["Feet", "Meters"])
    plot_width = st.number_input("Plot Width", 10.0, 300.0, 40.0, 1.0)
    plot_length = st.number_input("Plot Length", 10.0, 300.0, 50.0, 1.0)
    road_side = st.selectbox("Road Side", ["North", "South", "East", "West"])
    location = st.text_input("Location", "Kolhapur, Maharashtra")
    automatic = st.checkbox("Automatic setbacks", True)

if automatic:
    # Values are expressed in the selected input unit.
    if unit == "Meters":
        front_setback, rear_setback = 1.5, 1.0
        left_setback, right_setback = 1.0, 1.0
    else:
        front_setback, rear_setback = 5.0, 3.0
        left_setback, right_setback = 3.0, 3.0
else:
    with st.sidebar.expander("Setbacks"):
        front_setback = st.number_input("Front", 0.0, 50.0, 5.0, .5)
        rear_setback = st.number_input("Rear", 0.0, 50.0, 3.0, .5)
        left_setback = st.number_input("Left", 0.0, 50.0, 3.0, .5)
        right_setback = st.number_input("Right", 0.0, 50.0, 3.0, .5)

# Convert all geometry to feet internally.
factor = 3.28084 if unit == "Meters" else 1.0
w_ft, l_ft = plot_width * factor, plot_length * factor
fs_ft, rs_ft = front_setback * factor, rear_setback * factor
ls_ft, rgs_ft = left_setback * factor, right_setback * factor

with st.sidebar.expander("🏡 2. House", expanded=True):
    house_type = st.selectbox("House Type", ["1 BHK", "2 BHK", "3 BHK", "4 BHK", "Custom"], index=2)
    building_type = st.selectbox("Building Type", ["Ground", "G+1", "G+2", "Duplex", "Villa"], index=0)
    default_bedrooms = {"1 BHK": 1, "2 BHK": 2, "3 BHK": 3, "4 BHK": 4}.get(house_type, 3)
    bedrooms = st.number_input("Bedrooms", 1, 8, default_bedrooms, 1)
    bathrooms = st.number_input("Bathrooms", 1, 8, max(1, int(bedrooms)), 1)
    parking = st.selectbox("Parking", ["No Parking", "1 Car", "2 Cars", "Bikes", "Car + Bikes"])
    living = st.checkbox("Living room", True)
    dining = st.checkbox("Dining room", True)
    kitchen = st.checkbox("Kitchen", True)
    utility = st.checkbox("Utility / laundry", True)
    puja = st.checkbox("Puja room", True)
    guest = st.checkbox("Guest bedroom", False)
    kitchen_type = st.selectbox("Kitchen type", ["Open", "Closed", "Modular", "Traditional"])

with st.sidebar.expander("👨‍👩‍👧 3. Family & Lifestyle"):
    family_size = st.number_input("Total people", 1, 20, 4, 1)
    adults = st.number_input("Adults", 1, 20, 2, 1)
    children = st.number_input("Children", 0, 10, 1, 1)
    elderly = st.number_input("Elderly family members", 0, 10, 0, 1)
    frequent_guests = st.checkbox("Guests frequently visit", False)
    lifestyle = st.selectbox("Lifestyle", ["Small family", "Joint family", "Working professionals", "Large family", "Frequent guests"])

with st.sidebar.expander("🧭 4. Vastu"):
    vastu_label = st.selectbox("Vastu Preference", ["No Preference", "Basic", "Strict"])
    vastu_mode = {"No Preference": "no_preference", "Basic": "basic", "Strict": "strict"}[vastu_label]

with st.sidebar.expander("🏛️ 5. Architectural Style", expanded=True):
    style = st.selectbox("Architectural Style", ["Modern Minimalistic", "Traditional Indian", "Maharashtrian Wada"])

with st.sidebar.expander("🌦️ 6. Environment"):
    climate = st.selectbox("Climate", ["Auto", "Hot & Dry", "Warm & Humid", "Moderate", "Cold / Hilly", "Heavy Rainfall"])
    light_pref = st.selectbox("Natural light", ["Balanced", "High", "Maximum"])
    ventilation_pref = st.selectbox("Ventilation", ["Balanced", "High", "Cross ventilation"])

with st.sidebar.expander("🌿 7. Open Space"):
    courtyard = st.checkbox("Prefer courtyard", style in ("Traditional Indian", "Maharashtrian Wada"))
    garden = st.checkbox("Front / rear garden", True)
    balcony = st.checkbox("Balcony on upper floor", building_type != "Ground")

floor_height = st.sidebar.number_input("Floor height (ft)", 8.0, 15.0, 10.0, .5)
stair_width = st.sidebar.number_input("Stair width (ft)", 3.0, 6.0, 3.5, .5)

# ----------------------------- SITE VALIDATION -----------------------------
plot_result = create_plot(
    plot_width=w_ft, plot_length=l_ft, road_side=road_side,
    front_setback=fs_ft, rear_setback=rs_ft,
    left_setback=ls_ft, right_setback=rgs_ft,
)

if not plot_result.get("valid"):
    st.error("The plot/setback configuration is infeasible.")
    st.write(plot_result.get("errors", []))
    st.stop()

plot = plot_result["plot"]
usable_plot = plot_result["usable_plot"]
usable_plot["x"] = ls_ft
usable_plot["y"] = fs_ft
usable_plot["area"] = usable_plot["width"] * usable_plot["length"]

parking_spaces = 0 if parking == "No Parking" else (2 if parking == "2 Cars" else 1)
parking_required = parking != "No Parking"

# ----------------------------- AI ARCHITECT INPUT -----------------------------
st.subheader("AI Architect")
ai_text = st.text_area(
    "Describe your dream house",
    placeholder=(
        "I have a 40 by 50 north-facing plot. I want a 3 BHK G+1 house "
        "for a family of four with strict Vastu, traditional Maharashtrian "
        "style and good ventilation in a hot and humid climate."
    ),
    height=130,
)
ai_generate_requested = False

if "ai_parse_result" not in st.session_state:
    st.session_state.ai_parse_result = None
if "ai_summary" not in st.session_state:
    st.session_state.ai_summary = None

if st.button("Understand Requirements", use_container_width=True):
    if not ai_text.strip():
        st.warning("Describe your house requirements first.")
    else:
        parse_result = parse_requirements(ai_text)
        st.session_state.ai_parse_result = parse_result
        st.session_state.ai_summary = summarize_requirements(parse_result)

if st.session_state.ai_summary:
    ai_summary = st.session_state.ai_summary
    st.markdown("### What I Understood")
    summary = ai_summary["summary"]
    for label, key in (
        ("Plot", "plot"), ("Road", "road"), ("Bedrooms", "bedrooms"),
        ("Building type", "building_type"), ("Family", "family"),
        ("Elderly", "elderly"), ("Vastu", "vastu"), ("Style", "style"),
        ("Climate", "climate"), ("Ventilation", "ventilation"),
    ):
        if key in summary:
            st.write(f"**{label}:** {summary[key]}")

    clarification_questions = build_clarification_questions(st.session_state.ai_parse_result)
    if clarification_questions:
        st.info("Before I design your plan, I need a few more details:")
        for question in clarification_questions:
            st.write(f"• {question}")

    if ai_summary["ready_for_planning"]:
        ai_generate_requested = st.button(
            "Generate Plan from Requirements",
            type="primary",
            use_container_width=True,
        )

# ----------------------------- DASHBOARD -----------------------------
st.subheader("Project Snapshot")
c1, c2, c3, c4, c5 = st.columns(5)
c1.metric("Plot", f"{w_ft:.0f} × {l_ft:.0f} ft")
c2.metric("Plot Area", f"{plot['area']:.0f} sq.ft")
c3.metric("Usable Area", f"{usable_plot['area']:.0f} sq.ft")
c4.metric("House", house_type)
c5.metric("Road", road_side)

st.caption(
    f"📍 {location}  •  🧭 {vastu_label}  •  🏛️ {style}  •  🌦️ {climate}  •  "
    f"Family: {family_size}"
)

rooms = []
if living: rooms.append({"room_type": "living_room"})
if dining: rooms.append({"room_type": "dining"})
if kitchen: rooms.append({"room_type": "kitchen"})
if utility: rooms.append({"room_type": "utility"})
for i in range(int(bedrooms)):
    rooms.append({"room_type": "master_bedroom" if i == 0 else "bedroom"})
for _ in range(int(bathrooms)):
    rooms.append({"room_type": "bathroom"})
if puja: rooms.append({"room_type": "puja_room"})
if guest or frequent_guests: rooms.append({"room_type": "guest_bedroom"})

family_context = {
    "family_size": family_size,
    "adults": adults,
    "children": children,
    "elderly": elderly,
    "frequent_guests": frequent_guests,
    "lifestyle": lifestyle,
}

if courtyard:
    st.info("🌿 Courtyard preference is active. The selected architectural style and topology will try to preserve a meaningful open zone.")

manual_generate_requested = st.button("✨ Generate 4 Architectural Concepts", type="primary", use_container_width=True)

if manual_generate_requested or ai_generate_requested:
    if not rooms:
        if manual_generate_requested:
            st.error("Select at least one room.")
        st.stop()

    with st.spinner("AI Architect is evaluating requirements, topology, circulation, Vastu and site constraints..."):
        try:
            if ai_generate_requested:
                result = plan_from_text(ai_text)
            else:
                result = generate_project_plans(
                    rooms=rooms,
                    plot=plot,
                    usable_plot=usable_plot,
                    building_type=building_type,
                    road_side=road_side,
                    number_of_plans=4,
                    include_terrace=True,
                    parking_required=parking_required,
                    parking_spaces=parking_spaces,
                    floor_height=floor_height,
                    stair_width=stair_width,
                    vastu_mode=vastu_mode,
                    architectural_style=style,
                    family_context=family_context,
                    climate=climate,
                    balcony_required=balcony,
                    garden_required=garden,
                )
        except Exception as exc:
            st.error("Plan generation failed.")
            if manual_generate_requested:
                st.exception(exc)
            st.stop()

    if ai_generate_requested and result.get("success") is False:
        st.error("I could not generate a plan from those requirements.")
        for question in build_clarification_questions(st.session_state.ai_parse_result):
            st.write(f"• {question}")
        for warning in result.get("warnings", []):
            st.warning(warning)
        st.stop()

    st.success(f"Generated {result['total_plans']} architectural concepts.")

    # ----------------------------- PLAN CARDS -----------------------------
    plans = result.get("plans", [])
    cols = st.columns(4)
    for col, plan in zip(cols, plans):
        with col:
            st.markdown('<div class="plan-card">', unsafe_allow_html=True)
            st.subheader(f"Concept {plan['plan_number']}")
            st.write(f"**{plan['topology'].replace('_', ' ').title()}**")
            st.caption(plan["strategy"].replace("_", " ").title())
            st.markdown("</div>", unsafe_allow_html=True)

    # ----------------------------- DETAILS -----------------------------
    for plan in plans:
        st.divider()
        st.header(f"Concept {plan['plan_number']} — {plan['topology'].replace('_', ' ').title()}")
        plan_layout = next(
            (floor["layout"] for floor in plan.get("floors", []) if floor.get("layout")),
            {},
        )
        plan_plot = plan_layout.get("plot", plot)
        plan_usable_plot = plan_layout.get("usable_plot", usable_plot)
        plan_road_side = plan_layout.get("road_side", plan.get("road_side", road_side))
        validation_items = [x for x in plan.get("validation", []) if x.get("validation")]
        validations = [item["validation"] for item in validation_items]
        m2, m3, m4 = st.columns(3)
        m2.metric("Topology", plan["topology"].replace("_", " ").title())
        m3.metric("Vastu", plan.get("vastu_mode", vastu_mode).replace("_", " ").title())
        m4.metric("Built-up", f"{sum(float(f['layout'].get('used_room_area',0)) for f in plan['floors']):.0f} sq.ft")
        st.caption(
            f"Style: {plan.get('architectural_style', style)}  •  "
            f"Climate: {plan.get('energy', {}).get(next(iter(plan.get('energy', {})), ''), {}).get('climate', climate)}"
        )

        tabs = st.tabs([f["floor"] for f in plan["floors"]] + ["Analysis"])
        for tab, floor in zip(tabs[:-1], plan["floors"]):
            with tab:
                layout = floor["layout"]
                if not layout.get("rooms"):
                    st.info("No rooms allocated to this floor.")
                    continue
                svg = render_floor_plan(
                    layout=layout, plot=plan_plot,
                    usable_plot=plan_usable_plot, road_side=plan_road_side
                )
                st.components.v1.html(svg, height=760, scrolling=False)

                a, b, c = st.columns(3)
                a.metric("Rooms", len(layout["rooms"]))
                b.metric("Used area", f"{layout.get('used_room_area',0):.0f} sq.ft")
                c.metric("Open area", f"{layout.get('remaining_area',0):.0f} sq.ft")

                with st.expander("Room schedule"):
                    rows = []
                    for r in layout["rooms"]:
                        rows.append({
                            "Room": r["room_type"].replace("_", " ").title(),
                            "Width (ft)": r["width"],
                            "Length (ft)": r["length"],
                            "Area (sq.ft)": r["area"],
                        })
                    st.dataframe(rows, use_container_width=True, hide_index=True)

                openings = layout.get("openings", {})
                st.caption(
                    f"🚪 Doors: {len(openings.get('doors', []))}  |  "
                    f"🪟 Windows: {len(openings.get('windows', []))}"
                )

        with tabs[-1]:
            st.subheader("🧠 Why this concept was generated")
            for reason in plan.get("explanation", []):
                st.write("• " + reason)

            st.subheader("🌦️ Energy / Passive Design")
            energy = plan.get("energy", {})
            for floor_name, data in energy.items():
                st.write(
                    f"**{floor_name} ({data.get('climate', climate)}):** {_band(data.get('score'))}  "
                    f"(Light: {_band(data.get('light_score'))}, Ventilation: {_band(data.get('ventilation_score'))})"
                )
                for rec in data.get("recommendations", []):
                    st.caption("— " + rec)

            st.subheader("💰 Indicative Construction Cost")
            cost = plan.get("cost", {})
            st.write(f"Estimated total: **₹{cost.get('estimated_total_cost',0):,.0f}**")
            st.caption(cost.get("note", ""))

            st.subheader("📋 Validation")
            for item in validation_items:
                v = item["validation"]
                scores = v.get("scores", {})
                st.write(
                    f"**{item['floor']}:** {'VALID' if v.get('valid') else 'REVIEW'}  "
                    f"Functional: {_band(scores.get('functional'))} • "
                    f"Vastu: {_band(scores.get('vastu'))}"
                )
                for error in v.get("errors", []):
                    st.error(error)
                for warning in v.get("warnings", []):
                    st.warning(warning)

        # Downloads
        first_layout = next((f["layout"] for f in plan["floors"] if f["layout"].get("rooms")), None)
        if first_layout:
            svg = render_floor_plan(
                first_layout,
                first_layout.get("plot", plan_plot),
                first_layout.get("usable_plot", plan_usable_plot),
                first_layout.get("road_side", plan_road_side),
            )
            st.download_button(
                "⬇️ Download floor plan (SVG)",
                svg,
                file_name=f"concept_{plan['plan_number']}_floorplan.svg",
                mime="image/svg+xml",
            )
        st.download_button(
            "⬇️ Download concept data (JSON)",
            json.dumps(plan, indent=2, default=str),
            file_name=f"concept_{plan['plan_number']}.json",
            mime="application/json",
        )


def _band(v):
    """Plain-word reading of an internal 0-100 value; the number is never shown."""
    try:
        n = float(v)
    except (TypeError, ValueError):
        return "Not assessed"
    return "Excellent" if n >= 85 else "Good" if n >= 70 else "Fair" if n >= 50 else "Needs attention"


import json
import streamlit as st

from backend.planner.plot_rules import create_plot
from backend.planner.multi_floor_multi_layout import generate_project_plans
from backend.renderer.floorplan_svg import render_floor_plan
from backend.ai.requirement_parser import parse_requirements
from backend.ai.requirement_summary import summarize_requirements, build_clarification_questions
from backend.ai.requirement_adapter import plan_from_text

st.set_page_config(
    page_title="AI Real Estate Architect",
    page_icon="🏠",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown("""
<style>
[data-testid="stAppViewContainer"] {
    background: linear-gradient(180deg, #f7f9fc 0%, #ffffff 45%);
}
.hero {
    padding: 2rem 2.2rem;
    border-radius: 24px;
    background: linear-gradient(135deg, #172033, #263a5a);
    color: white;
    margin-bottom: 1.2rem;
}
.hero h1 { margin: 0; font-size: 2.4rem; }
.hero p { margin: .5rem 0 0; opacity: .85; font-size: 1.05rem; }
.section-card {
    padding: 1rem 1.2rem;
    border: 1px solid #e5e9f0;
    border-radius: 16px;
    background: white;
}
.plan-card {
    padding: 1rem;
    border: 1px solid #e2e7ef;
    border-radius: 18px;
    background: white;
    box-shadow: 0 5px 20px rgba(20,30,50,.06);
}
.small-muted { color: #687386; font-size: .88rem; }
</style>
""", unsafe_allow_html=True)

st.markdown("""
<div class="hero">
  <h1>🏠 AI Real Estate Architect</h1>
  <p>Architectural decision-making system for functional, Vastu-aware and explainable house planning.</p>
</div>
""", unsafe_allow_html=True)

# ----------------------------- INPUTS -----------------------------
st.sidebar.title("Project Configuration")

with st.sidebar.expander("📍 1. Site & Plot", expanded=True):
    unit = st.selectbox("Unit", ["Feet", "Meters"])
    plot_width = st.number_input("Plot Width", 10.0, 300.0, 40.0, 1.0)
    plot_length = st.number_input("Plot Length", 10.0, 300.0, 50.0, 1.0)
    road_side = st.selectbox("Road Side", ["North", "South", "East", "West"])
    location = st.text_input("Location", "Kolhapur, Maharashtra")
    automatic = st.checkbox("Automatic setbacks", True)

if automatic:
    # Values are expressed in the selected input unit.
    if unit == "Meters":
        front_setback, rear_setback = 1.5, 1.0
        left_setback, right_setback = 1.0, 1.0
    else:
        front_setback, rear_setback = 5.0, 3.0
        left_setback, right_setback = 3.0, 3.0
else:
    with st.sidebar.expander("Setbacks"):
        front_setback = st.number_input("Front", 0.0, 50.0, 5.0, .5)
        rear_setback = st.number_input("Rear", 0.0, 50.0, 3.0, .5)
        left_setback = st.number_input("Left", 0.0, 50.0, 3.0, .5)
        right_setback = st.number_input("Right", 0.0, 50.0, 3.0, .5)

# Convert all geometry to feet internally.
factor = 3.28084 if unit == "Meters" else 1.0
w_ft, l_ft = plot_width * factor, plot_length * factor
fs_ft, rs_ft = front_setback * factor, rear_setback * factor
ls_ft, rgs_ft = left_setback * factor, right_setback * factor

with st.sidebar.expander("🏡 2. House", expanded=True):
    house_type = st.selectbox("House Type", ["1 BHK", "2 BHK", "3 BHK", "4 BHK", "Custom"], index=2)
    building_type = st.selectbox("Building Type", ["Ground", "G+1", "G+2", "Duplex", "Villa"], index=0)
    default_bedrooms = {"1 BHK": 1, "2 BHK": 2, "3 BHK": 3, "4 BHK": 4}.get(house_type, 3)
    bedrooms = st.number_input("Bedrooms", 1, 8, default_bedrooms, 1)
    bathrooms = st.number_input("Bathrooms", 1, 8, max(1, int(bedrooms)), 1)
    parking = st.selectbox("Parking", ["No Parking", "1 Car", "2 Cars", "Bikes", "Car + Bikes"])
    living = st.checkbox("Living room", True)
    dining = st.checkbox("Dining room", True)
    kitchen = st.checkbox("Kitchen", True)
    utility = st.checkbox("Utility / laundry", True)
    puja = st.checkbox("Puja room", True)
    guest = st.checkbox("Guest bedroom", False)
    kitchen_type = st.selectbox("Kitchen type", ["Open", "Closed", "Modular", "Traditional"])

with st.sidebar.expander("👨‍👩‍👧 3. Family & Lifestyle"):
    family_size = st.number_input("Total people", 1, 20, 4, 1)
    adults = st.number_input("Adults", 1, 20, 2, 1)
    children = st.number_input("Children", 0, 10, 1, 1)
    elderly = st.number_input("Elderly family members", 0, 10, 0, 1)
    frequent_guests = st.checkbox("Guests frequently visit", False)
    lifestyle = st.selectbox("Lifestyle", ["Small family", "Joint family", "Working professionals", "Large family", "Frequent guests"])

with st.sidebar.expander("🧭 4. Vastu"):
    vastu_label = st.selectbox("Vastu Preference", ["No Preference", "Basic", "Strict"])
    vastu_mode = {"No Preference": "no_preference", "Basic": "basic", "Strict": "strict"}[vastu_label]

with st.sidebar.expander("🏛️ 5. Architectural Style", expanded=True):
    style = st.selectbox("Architectural Style", ["Modern Minimalistic", "Traditional Indian", "Maharashtrian Wada"])

with st.sidebar.expander("🌦️ 6. Environment"):
    climate = st.selectbox("Climate", ["Auto", "Hot & Dry", "Warm & Humid", "Moderate", "Cold / Hilly", "Heavy Rainfall"])
    light_pref = st.selectbox("Natural light", ["Balanced", "High", "Maximum"])
    ventilation_pref = st.selectbox("Ventilation", ["Balanced", "High", "Cross ventilation"])

with st.sidebar.expander("🌿 7. Open Space"):
    courtyard = st.checkbox("Prefer courtyard", style in ("Traditional Indian", "Maharashtrian Wada"))
    garden = st.checkbox("Front / rear garden", True)
    balcony = st.checkbox("Balcony on upper floor", building_type != "Ground")

floor_height = st.sidebar.number_input("Floor height (ft)", 8.0, 15.0, 10.0, .5)
stair_width = st.sidebar.number_input("Stair width (ft)", 3.0, 6.0, 3.5, .5)

# ----------------------------- SITE VALIDATION -----------------------------
plot_result = create_plot(
    plot_width=w_ft, plot_length=l_ft, road_side=road_side,
    front_setback=fs_ft, rear_setback=rs_ft,
    left_setback=ls_ft, right_setback=rgs_ft,
)

if not plot_result.get("valid"):
    st.error("The plot/setback configuration is infeasible.")
    st.write(plot_result.get("errors", []))
    st.stop()

plot = plot_result["plot"]
usable_plot = plot_result["usable_plot"]
usable_plot["x"] = ls_ft
usable_plot["y"] = fs_ft
usable_plot["area"] = usable_plot["width"] * usable_plot["length"]

parking_spaces = 0 if parking == "No Parking" else (2 if parking == "2 Cars" else 1)
parking_required = parking != "No Parking"

# ----------------------------- AI ARCHITECT INPUT -----------------------------
st.subheader("AI Architect")
ai_text = st.text_area(
    "Describe your dream house",
    placeholder=(
        "I have a 40 by 50 north-facing plot. I want a 3 BHK G+1 house "
        "for a family of four with strict Vastu, traditional Maharashtrian "
        "style and good ventilation in a hot and humid climate."
    ),
    height=130,
)
ai_generate_requested = False

if "ai_parse_result" not in st.session_state:
    st.session_state.ai_parse_result = None
if "ai_summary" not in st.session_state:
    st.session_state.ai_summary = None

if st.button("Understand Requirements", use_container_width=True):
    if not ai_text.strip():
        st.warning("Describe your house requirements first.")
    else:
        parse_result = parse_requirements(ai_text)
        st.session_state.ai_parse_result = parse_result
        st.session_state.ai_summary = summarize_requirements(parse_result)

if st.session_state.ai_summary:
    ai_summary = st.session_state.ai_summary
    st.markdown("### What I Understood")
    summary = ai_summary["summary"]
    for label, key in (
        ("Plot", "plot"), ("Road", "road"), ("Bedrooms", "bedrooms"),
        ("Building type", "building_type"), ("Family", "family"),
        ("Elderly", "elderly"), ("Vastu", "vastu"), ("Style", "style"),
        ("Climate", "climate"), ("Ventilation", "ventilation"),
    ):
        if key in summary:
            st.write(f"**{label}:** {summary[key]}")

    clarification_questions = build_clarification_questions(st.session_state.ai_parse_result)
    if clarification_questions:
        st.info("Before I design your plan, I need a few more details:")
        for question in clarification_questions:
            st.write(f"• {question}")

    if ai_summary["ready_for_planning"]:
        ai_generate_requested = st.button(
            "Generate Plan from Requirements",
            type="primary",
            use_container_width=True,
        )

# ----------------------------- DASHBOARD -----------------------------
st.subheader("Project Snapshot")
c1, c2, c3, c4, c5 = st.columns(5)
c1.metric("Plot", f"{w_ft:.0f} × {l_ft:.0f} ft")
c2.metric("Plot Area", f"{plot['area']:.0f} sq.ft")
c3.metric("Usable Area", f"{usable_plot['area']:.0f} sq.ft")
c4.metric("House", house_type)
c5.metric("Road", road_side)

st.caption(
    f"📍 {location}  •  🧭 {vastu_label}  •  🏛️ {style}  •  🌦️ {climate}  •  "
    f"Family: {family_size}"
)

rooms = []
if living: rooms.append({"room_type": "living_room"})
if dining: rooms.append({"room_type": "dining"})
if kitchen: rooms.append({"room_type": "kitchen"})
if utility: rooms.append({"room_type": "utility"})
for i in range(int(bedrooms)):
    rooms.append({"room_type": "master_bedroom" if i == 0 else "bedroom"})
for _ in range(int(bathrooms)):
    rooms.append({"room_type": "bathroom"})
if puja: rooms.append({"room_type": "puja_room"})
if guest or frequent_guests: rooms.append({"room_type": "guest_bedroom"})

family_context = {
    "family_size": family_size,
    "adults": adults,
    "children": children,
    "elderly": elderly,
    "frequent_guests": frequent_guests,
    "lifestyle": lifestyle,
}

if courtyard:
    st.info("🌿 Courtyard preference is active. The selected architectural style and topology will try to preserve a meaningful open zone.")

manual_generate_requested = st.button("✨ Generate 4 Architectural Concepts", type="primary", use_container_width=True)

if manual_generate_requested or ai_generate_requested:
    if not rooms:
        if manual_generate_requested:
            st.error("Select at least one room.")
        st.stop()

    with st.spinner("AI Architect is evaluating requirements, topology, circulation, Vastu and site constraints..."):
        try:
            if ai_generate_requested:
                result = plan_from_text(ai_text)
            else:
                result = generate_project_plans(
                    rooms=rooms,
                    plot=plot,
                    usable_plot=usable_plot,
                    building_type=building_type,
                    road_side=road_side,
                    number_of_plans=4,
                    include_terrace=True,
                    parking_required=parking_required,
                    parking_spaces=parking_spaces,
                    floor_height=floor_height,
                    stair_width=stair_width,
                    vastu_mode=vastu_mode,
                    architectural_style=style,
                    family_context=family_context,
                    climate=climate,
                    balcony_required=balcony,
                    garden_required=garden,
                )
        except Exception as exc:
            st.error("Plan generation failed.")
            if manual_generate_requested:
                st.exception(exc)
            st.stop()

    if ai_generate_requested and result.get("success") is False:
        st.error("I could not generate a plan from those requirements.")
        for question in build_clarification_questions(st.session_state.ai_parse_result):
            st.write(f"• {question}")
        for warning in result.get("warnings", []):
            st.warning(warning)
        st.stop()

    st.success(f"Generated {result['total_plans']} architectural concepts.")

    # ----------------------------- PLAN CARDS -----------------------------
    plans = result.get("plans", [])
    cols = st.columns(4)
    for col, plan in zip(cols, plans):
        with col:
            st.markdown('<div class="plan-card">', unsafe_allow_html=True)
            st.subheader(f"Concept {plan['plan_number']}")
            st.write(f"**{plan['topology'].replace('_', ' ').title()}**")
            st.caption(plan["strategy"].replace("_", " ").title())
            st.markdown("</div>", unsafe_allow_html=True)

    # ----------------------------- DETAILS -----------------------------
    for plan in plans:
        st.divider()
        st.header(f"Concept {plan['plan_number']} — {plan['topology'].replace('_', ' ').title()}")
        plan_layout = next(
            (floor["layout"] for floor in plan.get("floors", []) if floor.get("layout")),
            {},
        )
        plan_plot = plan_layout.get("plot", plot)
        plan_usable_plot = plan_layout.get("usable_plot", usable_plot)
        plan_road_side = plan_layout.get("road_side", plan.get("road_side", road_side))
        validation_items = [x for x in plan.get("validation", []) if x.get("validation")]
        validations = [item["validation"] for item in validation_items]
        m2, m3, m4 = st.columns(3)
        m2.metric("Topology", plan["topology"].replace("_", " ").title())
        m3.metric("Vastu", plan.get("vastu_mode", vastu_mode).replace("_", " ").title())
        m4.metric("Built-up", f"{sum(float(f['layout'].get('used_room_area',0)) for f in plan['floors']):.0f} sq.ft")
        st.caption(
            f"Style: {plan.get('architectural_style', style)}  •  "
            f"Climate: {plan.get('energy', {}).get(next(iter(plan.get('energy', {})), ''), {}).get('climate', climate)}"
        )

        tabs = st.tabs([f["floor"] for f in plan["floors"]] + ["Analysis"])
        for tab, floor in zip(tabs[:-1], plan["floors"]):
            with tab:
                layout = floor["layout"]
                if not layout.get("rooms"):
                    st.info("No rooms allocated to this floor.")
                    continue
                svg = render_floor_plan(
                    layout=layout, plot=plan_plot,
                    usable_plot=plan_usable_plot, road_side=plan_road_side
                )
                st.components.v1.html(svg, height=760, scrolling=False)

                a, b, c = st.columns(3)
                a.metric("Rooms", len(layout["rooms"]))
                b.metric("Used area", f"{layout.get('used_room_area',0):.0f} sq.ft")
                c.metric("Open area", f"{layout.get('remaining_area',0):.0f} sq.ft")

                with st.expander("Room schedule"):
                    rows = []
                    for r in layout["rooms"]:
                        rows.append({
                            "Room": r["room_type"].replace("_", " ").title(),
                            "Width (ft)": r["width"],
                            "Length (ft)": r["length"],
                            "Area (sq.ft)": r["area"],
                        })
                    st.dataframe(rows, use_container_width=True, hide_index=True)

                openings = layout.get("openings", {})
                st.caption(
                    f"🚪 Doors: {len(openings.get('doors', []))}  |  "
                    f"🪟 Windows: {len(openings.get('windows', []))}"
                )

        with tabs[-1]:
            st.subheader("🧠 Why this concept was generated")
            for reason in plan.get("explanation", []):
                st.write("• " + reason)

            st.subheader("🌦️ Energy / Passive Design")
            energy = plan.get("energy", {})
            for floor_name, data in energy.items():
                st.write(
                    f"**{floor_name} ({data.get('climate', climate)}):** {_band(data.get('score'))}  "
                    f"(Light: {_band(data.get('light_score'))}, Ventilation: {_band(data.get('ventilation_score'))})"
                )
                for rec in data.get("recommendations", []):
                    st.caption("— " + rec)

            st.subheader("💰 Indicative Construction Cost")
            cost = plan.get("cost", {})
            st.write(f"Estimated total: **₹{cost.get('estimated_total_cost',0):,.0f}**")
            st.caption(cost.get("note", ""))

            st.subheader("📋 Validation")
            for item in validation_items:
                v = item["validation"]
                scores = v.get("scores", {})
                st.write(
                    f"**{item['floor']}:** {'VALID' if v.get('valid') else 'REVIEW'}  "
                    f"Functional: {_band(scores.get('functional'))} • "
                    f"Vastu: {_band(scores.get('vastu'))}"
                )
                for error in v.get("errors", []):
                    st.error(error)
                for warning in v.get("warnings", []):
                    st.warning(warning)

        # Downloads
        first_layout = next((f["layout"] for f in plan["floors"] if f["layout"].get("rooms")), None)
        if first_layout:
            svg = render_floor_plan(
                first_layout,
                first_layout.get("plot", plan_plot),
                first_layout.get("usable_plot", plan_usable_plot),
                first_layout.get("road_side", plan_road_side),
            )
            st.download_button(
                "⬇️ Download floor plan (SVG)",
                svg,
                file_name=f"concept_{plan['plan_number']}_floorplan.svg",
                mime="image/svg+xml",
            )
        st.download_button(
            "⬇️ Download concept data (JSON)",
            json.dumps(plan, indent=2, default=str),
            file_name=f"concept_{plan['plan_number']}.json",
            mime="application/json",
        )
