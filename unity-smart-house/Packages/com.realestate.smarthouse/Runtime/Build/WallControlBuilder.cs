// Builds the wall switch plate and the fan regulator panel.  Both are authored in "plate space": +Z points INTO THE ROOM (out of the wall), Y is up,
// X is along the wall; features that stand proud of the plate are at +Z.  Labels are rotated to read from the room.
using UnityEngine;

namespace RealEstate.SmartHouse
{
    public static class WallControlBuilder
    {
        const float PlateW = 0.086f, PlateH = 0.086f, PlateD = 0.012f;

        static BoxCollider AddCollider(GameObject go, Vector3 size, Vector3 center)
        {
            var c = go.AddComponent<BoxCollider>();
            c.size = size; c.center = center;
            return c;
        }

        static GameObject Part(Transform parent, string name, Mesh mesh, Material mat, Vector3 pos, Quaternion rot, out Renderer r)
        {
            var g = new GameObject(name);
            g.transform.SetParent(parent, false);
            g.transform.localPosition = pos; g.transform.localRotation = rot;
            g.AddComponent<MeshFilter>().sharedMesh = mesh;
            r = g.AddComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            r.receiveShadows = false;
            return g;
        }

        public static WallSwitchView BuildSwitch(Transform parent, string name, SmartHouseConfig cfg)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent, false);
            var plateMat = SmartMaterials.MakeEmissive(new Color(0.93f, 0.92f, 0.88f), cfg != null ? cfg.plateMaterial : null);
            var rockerMat = SmartMaterials.Make("SwitchRocker", new Color(0.97f, 0.96f, 0.93f), 0f, 0.55f);
            Renderer plateR, rockerR, ledR;
            Part(root.transform, "Plate", ProceduralMesh.Box(new Vector3(PlateW, PlateH, PlateD)), plateMat, new Vector3(0, 0, PlateD / 2), Quaternion.identity, out plateR);
            var rockerPivot = new GameObject("RockerPivot").transform;
            rockerPivot.SetParent(root.transform, false);
            rockerPivot.localPosition = new Vector3(0, 0.005f, PlateD);
            Part(rockerPivot, "Rocker", ProceduralMesh.Box(new Vector3(0.034f, 0.05f, 0.01f)), rockerMat, new Vector3(0, 0, 0.005f), Quaternion.identity, out rockerR);
            var ledMat = SmartMaterials.MakeEmissive(new Color(0.1f, 0.1f, 0.1f));
            Renderer led;
            Part(root.transform, "Led", ProceduralMesh.Cylinder(0.0035f, 0.003f, 10), ledMat, new Vector3(0, -0.033f, PlateD + 0.0015f), Quaternion.Euler(90, 0, 0), out led);
            ledR = led;

            // a collider larger than the plate: easy to hit from 1-3 m with a ray, and it stands in front of the wall only (never inside it)
            AddCollider(root, new Vector3(0.14f, 0.14f, 0.06f), new Vector3(0, 0, 0.03f));

            var view = root.AddComponent<WallSwitchView>();
            view.rocker = rockerPivot; view.led = ledR; view.plate = plateR;
            if (cfg == null || cfg.showLabels)
            {
                var tm = UiText.Create(root.transform, "Label", "LIGHT OFF", 0.016f, Color.white, TextAnchor.UpperCenter);
                tm.transform.localPosition = new Vector3(0, -0.05f, 0.002f);
                tm.transform.localRotation = Quaternion.Euler(0, 180, 0);          // text faces -Z by default: turn it to face +Z (into the room)
                view.label = tm;
            }
            return view;
        }

        /// <summary>Six pads in a column (0 at the bottom, 5 at the top) and a read-out above.</summary>
        public static FanRegulatorView BuildRegulator(Transform parent, string name, SmartHouseConfig cfg)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent, false);
            const float w = 0.095f, h = 0.30f, padH = 0.034f, gap = 0.008f;
            var plateMat = SmartMaterials.Make("RegulatorPlate", new Color(0.93f, 0.92f, 0.88f), 0f, 0.5f, null, cfg != null ? cfg.plateMaterial : null);
            Renderer pr;
            Part(root.transform, "Plate", ProceduralMesh.Box(new Vector3(w, h, PlateD)), plateMat, new Vector3(0, 0, PlateD / 2), Quaternion.identity, out pr);
            var view = root.AddComponent<FanRegulatorView>();
            float y0 = -h / 2 + 0.032f;
            for (int lvl = 0; lvl <= 5; lvl++)
            {
                var padMat = SmartMaterials.MakeEmissive(lvl == 0 ? new Color(0.55f, 0.2f, 0.18f) : new Color(0.3f, 0.3f, 0.32f));
                Renderer rr;
                var padGo = Part(root.transform, "Pad" + lvl, ProceduralMesh.Box(new Vector3(0.062f, padH, 0.008f)), padMat, new Vector3(0, y0 + lvl * (padH + gap), PlateD + 0.004f), Quaternion.identity, out rr);
                // a generous collider: the ray has to land on one pad out of six
                AddCollider(padGo, new Vector3(0.085f, padH + gap, 0.06f), new Vector3(0, 0, 0.026f));
                var pad = padGo.AddComponent<FanRegulatorPad>();
                pad.level = lvl; pad.owner = view;
                view.pads[lvl] = rr;
                if (cfg == null || cfg.showLabels)
                {
                    var t = UiText.Create(padGo.transform, "Digit", lvl.ToString(), 0.022f, Color.white);
                    t.transform.localPosition = new Vector3(0, 0, 0.0055f);
                    t.transform.localRotation = Quaternion.Euler(0, 180, 0);
                }
            }
            if (cfg == null || cfg.showLabels)
            {
                var ro = UiText.Create(root.transform, "Readout", "FAN OFF\n0 rpm", 0.016f, new Color(0.15f, 0.15f, 0.15f), TextAnchor.LowerCenter);
                ro.transform.localPosition = new Vector3(0, h / 2 + 0.008f, 0.002f);
                ro.transform.localRotation = Quaternion.Euler(0, 180, 0);
                view.readout = ro;
            }
            return view;
        }
    }
}
