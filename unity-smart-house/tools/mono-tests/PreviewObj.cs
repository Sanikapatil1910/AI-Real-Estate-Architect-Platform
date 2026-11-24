// Writes the procedural geometry (ceiling fan, wall switch, regulator, light fixture) as OBJ so it can be looked at outside Unity.
// Usage: mono preview.exe <outdir>
using System;
using System.IO;
using System.Linq;
using System.Text;
using RealEstate.SmartHouse;
using UnityEngine;

static class PreviewObj
{
    static void Dump(string path, Transform root)
    {
        var sb = new StringBuilder(); int baseIdx = 1;
        foreach (var mf in root.GetComponentsInChildren<MeshFilter>(true))
        {
            var m = mf.sharedMesh; if (m == null) continue;
            var t = mf.transform;
            sb.AppendLine("o " + mf.gameObject.name + "_" + (mf.transform.parent != null ? mf.transform.parent.name : ""));
            foreach (var v in m.vertices) { var w = t.TransformPoint(v); sb.AppendLine("v " + w.x.ToString("0.#####") + " " + w.y.ToString("0.#####") + " " + (w.z).ToString("0.#####")); }
            for (int i = 0; i < m.triangles.Length; i += 3) sb.AppendLine("f " + (baseIdx + m.triangles[i]) + " " + (baseIdx + m.triangles[i + 1]) + " " + (baseIdx + m.triangles[i + 2]));
            baseIdx += m.vertices.Length;
        }
        File.WriteAllText(path, sb.ToString());
    }

    static int Main(string[] a)
    {
        string dir = a[0]; Directory.CreateDirectory(dir);
        var cfg = ScriptableObject.CreateInstance<SmartHouseConfig>();
        var p = new GameObject("p").transform;
        var fan = CeilingFanBuilder.Build(p, "Fan", 0.6f, 0.3f, 5, cfg);
        Dump(Path.Combine(dir, "fan.obj"), fan.Root.transform);
        var sw = WallControlBuilder.BuildSwitch(p, "Switch", cfg);
        Dump(Path.Combine(dir, "switch.obj"), sw.transform);
        var rg = WallControlBuilder.BuildRegulator(p, "Reg", cfg);
        Dump(Path.Combine(dir, "regulator.obj"), rg.transform);
        var g = new GameObject("Fixture"); g.AddComponent<MeshFilter>().sharedMesh = ProceduralMesh.Lathe(new[] { 0f, 0.19f, 0.18f, 0.12f, 0f }, new[] { 0f, 0f, -0.02f, -0.055f, -0.055f }, 28);
        Dump(Path.Combine(dir, "fixture.obj"), g.transform);
        Console.WriteLine("ok");
        return 0;
    }
}
