using System.Collections.Generic;
using RealEstate.SmartHouse.Core;
using UnityEngine;

namespace RealEstate.SmartHouse
{
    /// <summary>
    /// A STAND-IN for the imported house, built from the smart-house data itself (floors, ceilings and solid walls round every room, no doors).
    /// It lets the lights, switches, fan and regulator be tried in a headset BEFORE a real .glb has been imported.  It is laid out the way the real
    /// model is: feet, plan x mirrored (as glTFast delivers it), so the binder goes through exactly the same unit and mirror calibration.
    /// It is NOT the generated house and has no doors.
    /// </summary>
    public sealed class DemoHouseBuilder : MonoBehaviour
    {
        public TextAsset sidecar;
        public bool mirrorX = true;
        public Transform Root { get; private set; }

        public Transform Build()
        {
            var doc = SmartHouseDocument.FromJson(sidecar.text);
            if (Root != null) Destroy(Root.gameObject);
            Root = new GameObject("DemoHouse (stand-in model)").transform;
            Root.SetParent(transform, false);
            var meshes = new List<Mesh>(); var xf = new List<Matrix4x4>();
            float t = (float)doc.InteriorWallFt, slab = (float)doc.SlabFt;
            foreach (var r in doc.Rooms)
            {
                float x0 = (float)r.X0, x1 = (float)r.X1, z0 = (float)r.Z0, z1 = (float)r.Z1, y0 = (float)r.FloorY, y1 = (float)r.CeilingY;
                Add(meshes, xf, x0, x1, y0 - slab, y0, z0, z1);                                   // floor
                Add(meshes, xf, x0, x1, y1, y1 + slab, z0, z1);                                    // ceiling slab
                Add(meshes, xf, x0 - t / 2, x1 + t / 2, y0, y1, z0 - t / 2, z0 + t / 2);           // walls centred on the room edges
                Add(meshes, xf, x0 - t / 2, x1 + t / 2, y0, y1, z1 - t / 2, z1 + t / 2);
                Add(meshes, xf, x0 - t / 2, x0 + t / 2, y0, y1, z0, z1);
                Add(meshes, xf, x1 - t / 2, x1 + t / 2, y0, y1, z0, z1);
            }
            var go = new GameObject("Walls"); go.transform.SetParent(Root, false);
            go.AddComponent<MeshFilter>().sharedMesh = ProceduralMesh.Combine(meshes, xf, "SH_DemoHouse");
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = SmartMaterials.Make("DemoWall", new Color(0.82f, 0.8f, 0.76f), 0f, 0.15f);
            return Root;
        }

        void Add(List<Mesh> meshes, List<Matrix4x4> xf, float x0, float x1, float y0, float y1, float z0, float z1)
        {
            float cx = (x0 + x1) / 2f; if (mirrorX) cx = -cx;
            meshes.Add(ProceduralMesh.Box(new Vector3(x1 - x0, y1 - y0, z1 - z0)));
            xf.Add(Matrix4x4.TRS(new Vector3(cx, (y0 + y1) / 2f, (z0 + z1) / 2f), Quaternion.identity, Vector3.one));
        }
    }
}
