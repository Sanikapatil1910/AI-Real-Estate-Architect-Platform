// Builds the smart-house objects (lights, fans, wall switches, regulators) for an imported house model, from the sidecar data.
// All generated objects live under ONE container at the scene root, which sits at the model root's pose; the model itself is never edited
// (apart from the optional feet-to-metres scale of its root).  Calling Bind again destroys the previous container first, so it is idempotent.
using System.Collections.Generic;
using RealEstate.SmartHouse.Core;
using UnityEngine;

namespace RealEstate.SmartHouse
{
    public sealed class BindResult
    {
        public Transform Container;
        public MirrorAxis Axis;
        public bool AxisAmbiguous;
        public int Lights, Fans, Switches, Regulators;
        public readonly List<string> Warnings = new List<string>();
        public readonly Dictionary<string, RoomLightView> LightViews = new Dictionary<string, RoomLightView>();
        public readonly Dictionary<string, CeilingFanView> FanViews = new Dictionary<string, CeilingFanView>();
        public readonly Dictionary<string, WallSwitchView> SwitchViews = new Dictionary<string, WallSwitchView>();
        public readonly Dictionary<string, FanRegulatorView> RegulatorViews = new Dictionary<string, FanRegulatorView>();
    }

    public static class HouseBinder
    {
        public const string ContainerName = "SmartHouse_Generated";
        const float Ft = (float)GltfSpace.FeetToMeters;

        static Vector3 V(MirrorAxis m, Vec3 p)
        {
            double x, y, z; GltfSpace.ToUnity(m, p.X, p.Y, p.Z, out x, out y, out z);
            return new Vector3((float)x, (float)y, (float)z);
        }
        static Vector3 D(MirrorAxis m, Vec3 p)
        {
            double x, y, z; GltfSpace.DirToUnity(m, p.X, p.Y, p.Z, out x, out y, out z);
            return new Vector3((float)x, (float)y, (float)z);
        }

        /// <summary>World-space renderer bounds of the model, expressed in the container's frame (metres).</summary>
        public static bool ModelBounds(Transform houseRoot, Transform frame, out Vector3 min, out Vector3 max)
        {
            min = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue); max = -min;
            bool any = false;
            foreach (var r in houseRoot.GetComponentsInChildren<Renderer>(false))
            {
                if (r is LineRenderer || r is TrailRenderer) continue;
                var b = r.bounds;
                for (int i = 0; i < 8; i++)
                {
                    var c = new Vector3((i & 1) == 0 ? b.min.x : b.max.x, (i & 2) == 0 ? b.min.y : b.max.y, (i & 4) == 0 ? b.min.z : b.max.z);
                    var l = frame.InverseTransformPoint(c);
                    min = Vector3.Min(min, l); max = Vector3.Max(max, l); any = true;
                }
            }
            return any;
        }

        public static BindResult Bind(Transform houseRoot, SmartHouseDocument doc, SmartHouseState state, SmartHouseConfig cfg, Transform oldContainer)
        {
            var res = new BindResult();
            if (oldContainer != null) { oldContainer.gameObject.SetActive(false); Object.Destroy(oldContainer.gameObject); }

            var container = new GameObject(ContainerName).transform;
            container.SetPositionAndRotation(houseRoot.position, houseRoot.rotation);
            res.Container = container;

            // ---- units ------------------------------------------------------------------------------------------------------------------------
            Vector3 mn, mx;
            bool haveBounds = ModelBounds(houseRoot, container, out mn, out mx);
            double footW = doc.FootX1 - doc.FootX0, footD = doc.FootZ1 - doc.FootZ0;
            if (haveBounds && footW > 1 && footD > 1)
            {
                double ratio = System.Math.Max(mx.x - mn.x, mx.z - mn.z) / System.Math.Max(footW, footD);     // ~0.3048 in metres, ~1 when still in feet
                if (cfg.applyFeetToMetres && ratio > 0.8 && ratio < 1.3)
                {
                    houseRoot.localScale *= Ft;
                    haveBounds = ModelBounds(houseRoot, container, out mn, out mx);
                    res.Warnings.Add("The model root was scaled by 0.3048 (feet to metres).");
                }
                else if (ratio < 0.2 || ratio > 0.45)
                    res.Warnings.Add("The model's size does not match the data file (width ratio " + ratio.ToString("0.00") + ", expected about 0.30 for a model in metres). Is this the house the data file belongs to?");
            }

            // ---- mirror axis --------------------------------------------------------------------------------------------------------------------
            var axis = MirrorAxis.X;
            if (cfg.mirror == MirrorChoice.X) axis = MirrorAxis.X;
            else if (cfg.mirror == MirrorChoice.Z) axis = MirrorAxis.Z;
            else if (haveBounds)
            {
                var cal = GltfSpace.Calibrate(doc.Rooms, mn.x, mn.z, mx.x, mx.z);
                axis = cal.Axis; res.AxisAmbiguous = cal.Ambiguous;
                res.Warnings.Add(cal.Message);
            }
            else res.Warnings.Add("The model has no renderers yet, so the mirror axis could not be calibrated; using X. Bind again after the model has loaded.");
            res.Axis = axis;

            if (doc.Rooms.Count == 0) { BindMaster(container, mn, mx, haveBounds, state, cfg, res); ApplyAnchors(container, state, cfg, res); return res; }

            // ---- rooms ----------------------------------------------------------------------------------------------------------------------------
            foreach (var r in doc.Rooms)
            {
                string key = SmartHouseDocument.Key(r);
                BuildLight(container, key, V(axis, r.LightPos), (float)(r.LightRangeFt * Ft), state, cfg, res);
                if (r.Fan != null && cfg.addFans)
                {
                    var p = V(axis, new Vec3(r.Fan.Pos.X, r.CeilingY, r.Fan.Pos.Z));       // the canopy is on the ceiling; Fan.Pos.y is the bottom of the rod
                    BuildFan(container, key, p, (float)(r.Fan.BladeRadiusFt * Ft), (float)(r.Fan.DownRodFt * Ft), state, cfg, res);
                }
                if (r.Switch != null)
                    BuildSwitch(container, key, PlatePose(axis, r.Switch, cfg, out var rot), rot, state, cfg, res);
                if (r.Regulator != null && r.Fan != null && cfg.addFans)
                    BuildRegulator(container, key, PlatePose(axis, r.Regulator, cfg, out var rot2), rot2, state, cfg, res);
                if (r.Switch == null) res.Warnings.Add(key + " (" + r.Name + "): no automatic switch position - add a SmartAnchor (WallSwitch) with roomKey " + key);
            }
            ApplyAnchors(container, state, cfg, res);
            return res;
        }

        static Vector3 PlatePose(MirrorAxis axis, AnchorData a, SmartHouseConfig cfg, out Quaternion rot)
        {
            var n = D(axis, a.Normal).normalized;
            rot = Quaternion.LookRotation(n, Vector3.up);
            // the data position is on the wall's centre line: move it out to the room-side face, plus a hair so it never z-fights
            return V(axis, a.Pos) + n * ((float)a.WallThicknessFt * Ft * 0.5f + cfg.plateOffsetM);
        }

        // ---- individual objects --------------------------------------------------------------------------------------------------------------------
        static void BuildLight(Transform parent, string key, Vector3 pos, float rangeM, SmartHouseState state, SmartHouseConfig cfg, BindResult res)
        {
            var go = new GameObject("Light_" + key);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = pos;
            var l = go.AddComponent<Light>();
            l.type = LightType.Point; l.shadows = cfg.shadows; l.range = Mathf.Max(1f, rangeM * cfg.rangeScale);
            l.color = cfg.lightColor; l.intensity = 0f; l.enabled = false;
            l.renderMode = LightRenderMode.Auto;

            var fx = new GameObject("Fixture");
            fx.transform.SetParent(go.transform, false);
            fx.transform.localPosition = new Vector3(0, 0.12f * Ft, 0);          // the light sits 0.12 ft under the ceiling: the dome hangs from the ceiling plane
            var mat = SmartMaterials.MakeEmissive(new Color(0.95f, 0.94f, 0.9f), cfg.fixtureMaterial);
            fx.AddComponent<MeshFilter>().sharedMesh = ProceduralMesh.Lathe(new[] { 0f, 0.19f, 0.18f, 0.12f, 0f }, new[] { 0f, 0f, -0.02f, -0.055f, -0.055f }, 28, "SH_Fixture");
            var mr = fx.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat; mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; mr.receiveShadows = false;

            var v = go.AddComponent<RoomLightView>();
            v.pointLight = l; v.fixture = mr; v.config = cfg;
            v.Bind(state, key);
            res.LightViews[key] = v; res.Lights++;
        }

        static void BuildFan(Transform parent, string key, Vector3 canopyPos, float radiusM, float rodM, SmartHouseState state, SmartHouseConfig cfg, BindResult res)
        {
            var fan = CeilingFanBuilder.Build(parent, "Fan_" + key, radiusM, rodM, cfg.blades, cfg);
            fan.Root.transform.localPosition = canopyPos;
            var v = fan.Root.AddComponent<CeilingFanView>();
            v.bladeAssembly = fan.BladeAssembly; v.direction = cfg.spinDirection;
            v.Bind(state, key);
            res.FanViews[key] = v; res.Fans++;
        }

        static void BuildSwitch(Transform parent, string key, Vector3 pos, Quaternion rot, SmartHouseState state, SmartHouseConfig cfg, BindResult res)
        {
            var sw = WallControlBuilder.BuildSwitch(parent, "Switch_" + key, cfg);
            sw.transform.localPosition = pos; sw.transform.localRotation = rot;
            sw.Bind(state, key);
            res.SwitchViews[key] = sw; res.Switches++;
        }

        static void BuildRegulator(Transform parent, string key, Vector3 pos, Quaternion rot, SmartHouseState state, SmartHouseConfig cfg, BindResult res)
        {
            var rg = WallControlBuilder.BuildRegulator(parent, "Regulator_" + key, cfg);
            rg.transform.localPosition = pos; rg.transform.localRotation = rot;
            rg.Bind(state, key);
            foreach (var pad in rg.GetComponentsInChildren<FanRegulatorPad>()) pad.Bind(state, key, rg.pads[pad.level]);
            res.RegulatorViews[key] = rg; res.Regulators++;
        }

        // ---- no room data: one master light -------------------------------------------------------------------------------------------------------
        static void BindMaster(Transform container, Vector3 mn, Vector3 mx, bool haveBounds, SmartHouseState state, SmartHouseConfig cfg, BindResult res)
        {
            var c = haveBounds ? (mn + mx) * 0.5f : Vector3.zero;
            float y = haveBounds ? Mathf.Min(mn.y + 2.6f, mx.y) : 2.6f;
            float range = haveBounds ? Mathf.Max(6f, new Vector2(mx.x - mn.x, mx.z - mn.z).magnitude * 0.7f) : 8f;
            BuildLight(container, "master", new Vector3(c.x, y, c.z), range, state, cfg, res);
            res.Warnings.Add("No room data: one MASTER light for the whole house, no fans. Provide the .smarthouse.json for per-room lights, or place SmartAnchors by hand.");
        }

        // ---- manual anchors ---------------------------------------------------------------------------------------------------------------------
        static void ApplyAnchors(Transform container, SmartHouseState state, SmartHouseConfig cfg, BindResult res)
        {
            var anchors = Compat.All<SmartAnchor>();
            foreach (var a in anchors)
            {
                if (!state.Lights.Has(a.roomKey)) { res.Warnings.Add("SmartAnchor '" + a.name + "' names an unknown room " + a.roomKey); continue; }
                var local = container.InverseTransformPoint(a.transform.position);
                var lrot = Quaternion.Inverse(container.rotation) * a.transform.rotation;
                switch (a.kind)
                {
                    case SmartAnchor.Kind.WallSwitch:
                        if (res.SwitchViews.TryGetValue(a.roomKey, out var old)) { Object.Destroy(old.gameObject); res.Switches--; res.SwitchViews.Remove(a.roomKey); }
                        BuildSwitch(container, a.roomKey, local, lrot, state, cfg, res); break;
                    case SmartAnchor.Kind.FanRegulator:
                        if (res.RegulatorViews.TryGetValue(a.roomKey, out var oldR)) { Object.Destroy(oldR.gameObject); res.Regulators--; res.RegulatorViews.Remove(a.roomKey); }
                        BuildRegulator(container, a.roomKey, local, lrot, state, cfg, res); break;
                    case SmartAnchor.Kind.CeilingLight:
                        if (res.LightViews.TryGetValue(a.roomKey, out var oldL)) { Object.Destroy(oldL.gameObject); res.Lights--; res.LightViews.Remove(a.roomKey); }
                        BuildLight(container, a.roomKey, local, 6f, state, cfg, res); break;
                    case SmartAnchor.Kind.CeilingFan:
                        if (state.Fan(a.roomKey) == null) { res.Warnings.Add("SmartAnchor fan for room " + a.roomKey + ": the room has no fan in the data (state has no fan model)"); break; }
                        if (res.FanViews.TryGetValue(a.roomKey, out var oldF)) { Object.Destroy(oldF.gameObject); res.Fans--; res.FanViews.Remove(a.roomKey); }
                        BuildFan(container, a.roomKey, local, a.bladeRadiusM, a.downRodM, state, cfg, res); break;
                }
            }
        }
    }
}
