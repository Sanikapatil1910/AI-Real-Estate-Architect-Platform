# Can the architecture take the next smart-home features? (Phase 7 audit)

Assessed by reading the current code. **Nothing in this list is implemented**, on purpose: the core had to be reliable first.

| Feature | Fits today? | What would have to change | Risk |
|---|---|---|---|
| **More than one fan in a house** | **Yes** (already: one fan per room that has one, each with its own `FanModel`, regulator and panel row) | — | none |
| **More than one fan in a room** | No | Sidecar `fan` → `fans[]` (generator `smartHouse.ts`), key `room#i`; `SmartHouseState` already keys fans by string, so only the document model, `HouseBinder`, voice grammar ("the fan above the bed") and the panel row need work | medium |
| **Multiple lights in one room** | No | `light` → `lights[]`; `LightBank` is keyed by a string, so keys like `0:living#2` fit; voice "living room light" must switch all of a room's fixtures; panel shows one toggle per room | medium |
| **Additional room automation** | **Mostly yes** | `AutoLighting` is a pure class driven by `CurrentRoomKey`; the same enter/leave/hold rules can drive fans (auto-off after leaving). Add a second instance or generalise it over "devices" | low |
| **Day / night lighting modes** | Partly | Not present. A small `TimeOfDay` service in the Unity layer could set ambient light, skybox/sun and a multiplier on `onIntensity`; `RoomLightView` already reads intensity from the config. The GLB's own materials are lit, so it needs a visual check on the headset | low–medium |
| **Smart curtains** | No | The sidecar has no windows. The web app knows every window (`walls.ts` / plan), so the generator can write `windows[]` (position, size, wall); the Unity side needs a curtain mesh + a clip/scale animation + a state object like `FanModel` | medium |
| **TV / appliance control** | No | `LightBank` and `FanModel` are device-specific. Introduce a small `Device` abstraction (key, kind, state, `ISmartInteractable` view, voice nouns) and register lights/fans through it first, so new kinds are additions rather than edits of the parser/panel | medium–high |

Constraint that applies to all of them: the panel shows 6 rooms per page; adding device types means either more rows per room or a second page type.
The generator stays separate from floor-plan generation — extensions only add fields to `realestate.smart-house/1` (bump the schema version if a field becomes required).
