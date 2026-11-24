// A ceiling fan built from code.  Hierarchy (local origin = the point on the ceiling the fan hangs from, +Y up):
//
//   CeilingFan                     (root, never rotates)
//     Mount                        canopy, down-rod, motor shroud: STATIONARY
//     BladeAssembly                rotates about its own Y axis, driven by CeilingFanView: hub cap, blade irons, blades
//
// Meshes are merged per material (2 materials on the rotating part, 1 on the fixed part) so one fan costs three draw calls.
using System.Collections.Generic;
using UnityEngine;

namespace RealEstate.SmartHouse
{
    public static class CeilingFanBuilder
    {
        public sealed class Result { public GameObject Root; public Transform Mount; public Transform BladeAssembly; public float BladeRadiusM; }

        /// <param name="bladeRadiusM">Blade tip radius.</param>
        /// <param name="downRodM">Length of the down-rod (0 = close to the ceiling).</param>
        public static Result Build(Transform parent, string name, float bladeRadiusM, float downRodM, int blades, SmartHouseConfig cfg)
        {
            blades = Mathf.Clamp(blades, 3, 6);
            var wood = SmartMaterials.Make("FanWood", Color.white, 0f, 0.28f, SmartMaterials.WoodGrain(new Color(0.24f, 0.14f, 0.07f), new Color(0.48f, 0.31f, 0.17f)), cfg != null ? cfg.woodMaterial : null);
            var bronze = SmartMaterials.Make("FanMetal", new Color(0.17f, 0.15f, 0.13f), 0.85f, 0.42f, null, cfg != null ? cfg.metalMaterial : null);

            var root = new GameObject(name);
            root.transform.SetParent(parent, false);
            var mount = new GameObject("Mount").transform; mount.SetParent(root.transform, false);
            var rot = new GameObject("BladeAssembly").transform; rot.SetParent(root.transform, false);

            // ---- stationary: canopy, rod, shroud -------------------------------------------------------------------------------------------
            var mm = new List<Mesh>(); var mt = new List<Matrix4x4>();
            const float canopyH = 0.05f;
            mm.Add(ProceduralMesh.Lathe(new[] { 0.0f, 0.09f, 0.095f, 0.06f, 0.0f }, new[] { 0f, 0f, -0.02f, -canopyH, -canopyH }, 32, "SH_Canopy")); mt.Add(Matrix4x4.identity);
            float y = -canopyH;
            if (downRodM > 0.01f)
            {
                mm.Add(ProceduralMesh.Cylinder(0.0125f, downRodM, 12)); mt.Add(Matrix4x4.TRS(new Vector3(0, y - downRodM / 2, 0), Quaternion.identity, Vector3.one));
                y -= downRodM;
            }
            // motor shroud (a stationary bell, wider at the bottom where it meets the rotating hub)
            mm.Add(ProceduralMesh.Lathe(new[] { 0.0f, 0.04f, 0.075f, 0.105f, 0.115f, 0.112f, 0.0f }, new[] { y, y, y - 0.03f, y - 0.075f, y - 0.1f, y - 0.115f, y - 0.115f }, 40, "SH_Shroud"));
            mt.Add(Matrix4x4.identity);
            mount.GetComponent<Transform>();
            AddMesh(mount.gameObject, ProceduralMesh.Combine(mm, mt, "SH_FanMount"), bronze);
            float pivotY = y - 0.115f;

            // ---- rotating: hub cap, irons, blades --------------------------------------------------------------------------------------------
            rot.localPosition = new Vector3(0, pivotY, 0);
            var metal = new List<Mesh>(); var metalT = new List<Matrix4x4>();
            var board = new List<Mesh>(); var boardT = new List<Matrix4x4>();
            metal.Add(ProceduralMesh.Lathe(new[] { 0.112f, 0.118f, 0.1f, 0.05f, 0.0f }, new[] { 0f, -0.012f, -0.04f, -0.062f, -0.066f }, 40, "SH_HubCap")); metalT.Add(Matrix4x4.identity);
            float tip = Mathf.Max(0.35f, bladeRadiusM);
            var bladeMesh = ProceduralMesh.Blade(0.27f, tip, 0.115f, 0.15f, 0.13f, 0.014f, 11f);
            var iron = ProceduralMesh.Box(new Vector3(0.20f, 0.004f, 0.034f));
            for (int i = 0; i < blades; i++)
            {
                var q = Quaternion.Euler(0, i * 360f / blades, 0);
                metal.Add(iron); metalT.Add(Matrix4x4.TRS(q * new Vector3(0.20f, -0.006f, 0), q, Vector3.one));
                board.Add(bladeMesh); boardT.Add(Matrix4x4.TRS(new Vector3(0, -0.018f, 0), q, Vector3.one));
            }
            AddMesh(rot.gameObject.AddChild("Hub"), ProceduralMesh.Combine(metal, metalT, "SH_FanIrons"), bronze);
            AddMesh(rot.gameObject.AddChild("Blades"), ProceduralMesh.Combine(board, boardT, "SH_FanBlades"), wood);
            return new Result { Root = root, Mount = mount, BladeAssembly = rot, BladeRadiusM = tip };
        }

        static GameObject AddChild(this GameObject p, string name) { var g = new GameObject(name); g.transform.SetParent(p.transform, false); return g; }

        static void AddMesh(GameObject go, Mesh mesh, Material mat)
        {
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            r.receiveShadows = false;
        }
    }
}
