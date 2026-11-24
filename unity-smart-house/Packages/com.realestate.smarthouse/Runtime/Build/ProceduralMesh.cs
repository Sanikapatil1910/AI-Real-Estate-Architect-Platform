// Small mesh builders for the fan, the switch plates and the fixtures (no art assets needed, nothing to import, nothing that can go missing).
using System.Collections.Generic;
using UnityEngine;

namespace RealEstate.SmartHouse
{
    public static class ProceduralMesh
    {
        public static Mesh Box(Vector3 size)
        {
            var m = new Mesh { name = "SH_Box" };
            Vector3 h = size * 0.5f;
            var v = new List<Vector3>(); var n = new List<Vector3>(); var uv = new List<Vector2>(); var t = new List<int>();
            Vector3[] axes = { Vector3.right, Vector3.up, Vector3.forward };
            for (int a = 0; a < 3; a++)
                for (int sgn = -1; sgn <= 1; sgn += 2)
                {
                    Vector3 nrm = axes[a] * sgn;
                    Vector3 u = axes[(a + 1) % 3], w = axes[(a + 2) % 3];
                    if (sgn < 0) { Vector3 tmp = u; u = w; w = tmp; }
                    Vector3 c = Vector3.Scale(nrm, h);
                    Vector3 uh = Vector3.Scale(u, h), wh = Vector3.Scale(w, h);
                    int b = v.Count;
                    v.Add(c - uh - wh); v.Add(c + uh - wh); v.Add(c + uh + wh); v.Add(c - uh + wh);
                    for (int k = 0; k < 4; k++) n.Add(nrm);
                    uv.Add(new Vector2(0, 0)); uv.Add(new Vector2(1, 0)); uv.Add(new Vector2(1, 1)); uv.Add(new Vector2(0, 1));
                    t.AddRange(new[] { b, b + 1, b + 2, b, b + 2, b + 3 });
                }
            m.SetVertices(v); m.SetNormals(n); m.SetUVs(0, uv); m.SetTriangles(t, 0);
            // the winding above is chosen per face; make sure every face points outward whatever the axis order gave
            FixWinding(m);
            m.RecalculateBounds();
            return m;
        }

        static void FixWinding(Mesh m)
        {
            var v = m.vertices; var n = m.normals; var t = m.triangles;
            for (int i = 0; i < t.Length; i += 3)
            {
                Vector3 fn = Vector3.Cross(v[t[i + 1]] - v[t[i]], v[t[i + 2]] - v[t[i]]);
                if (Vector3.Dot(fn, n[t[i]]) < 0) { int tmp = t[i + 1]; t[i + 1] = t[i + 2]; t[i + 2] = tmp; }
            }
            m.triangles = t;
        }

        /// <summary>Surface of revolution round Y: profile points (radius, y) from the top down; closed at both ends when the radius there is > 0.</summary>
        public static Mesh Lathe(float[] radius, float[] y, int segments = 32, string name = "SH_Lathe")
        {
            int rows = radius.Length;
            var v = new Vector3[rows * (segments + 1)]; var uv = new Vector2[v.Length]; var t = new List<int>();
            for (int r = 0; r < rows; r++)
                for (int s = 0; s <= segments; s++)
                {
                    float a = s * Mathf.PI * 2f / segments;
                    v[r * (segments + 1) + s] = new Vector3(Mathf.Cos(a) * radius[r], y[r], Mathf.Sin(a) * radius[r]);
                    uv[r * (segments + 1) + s] = new Vector2((float)s / segments, (float)r / (rows - 1));
                }
            for (int r = 0; r < rows - 1; r++)
                for (int s = 0; s < segments; s++)
                {
                    int a = r * (segments + 1) + s, b = a + segments + 1;
                    t.AddRange(new[] { a, a + 1, b, a + 1, b + 1, b });     // Unity: front face = clockwise; cross(v1-v0, v2-v0) points out of the front
                }
            var m = new Mesh { name = name, vertices = v, uv = uv };
            m.SetTriangles(t, 0);
            m.RecalculateNormals();
            // outward: the triangles above face outward when the profile runs top to bottom; flip when it runs bottom to top
            if (y.Length > 1 && y[0] < y[y.Length - 1]) FlipTriangles(m);
            m.RecalculateBounds();
            return m;
        }

        static void FlipTriangles(Mesh m)
        {
            var t = m.triangles;
            for (int i = 0; i < t.Length; i += 3) { int tmp = t[i]; t[i] = t[i + 1]; t[i + 1] = tmp; }
            m.triangles = t; m.RecalculateNormals();
        }

        /// <summary>Closed cylinder along Y centred on the origin.</summary>
        public static Mesh Cylinder(float radius, float height, int segments = 24)
        {
            float h = height * 0.5f;
            var m = Lathe(new[] { 0f, radius, radius, 0f }, new[] { h, h, -h, -h }, segments, "SH_Cylinder");
            return m;
        }

        /// <summary>
        /// A fan blade: a tapered, rounded board lying in the XZ plane, running along +X from <paramref name="rootX"/> to <paramref name="tipX"/>,
        /// extruded by <paramref name="thickness"/> along Y and pitched by <paramref name="pitchDeg"/> about its own axis (so it bites the air).
        /// </summary>
        public static Mesh Blade(float rootX, float tipX, float rootWidth, float midWidth, float tipWidth, float thickness, float pitchDeg)
        {
            // outline (convex): root edge, widening to the middle, rounded tip
            var outline = new List<Vector2>();
            outline.Add(new Vector2(rootX, -rootWidth / 2));
            outline.Add(new Vector2((rootX + tipX) * 0.5f, -midWidth / 2));
            float tipStart = tipX - tipWidth * 0.5f;
            outline.Add(new Vector2(tipStart, -tipWidth / 2));
            int arc = 6;
            for (int i = 1; i < arc; i++)
            {
                float a = Mathf.PI * (-0.5f + (float)i / arc);
                outline.Add(new Vector2(tipStart + Mathf.Cos(a) * tipWidth * 0.5f, Mathf.Sin(a) * tipWidth * 0.5f));
            }
            outline.Add(new Vector2(tipStart, tipWidth / 2));
            outline.Add(new Vector2((rootX + tipX) * 0.5f, midWidth / 2));
            outline.Add(new Vector2(rootX, rootWidth / 2));
            int n = outline.Count;
            var v = new List<Vector3>(); var uv = new List<Vector2>(); var t = new List<int>();
            Quaternion pitch = Quaternion.Euler(pitchDeg, 0, 0);
            Vector2 c = Vector2.zero; foreach (var p in outline) c += p; c /= n;
            // top and bottom faces (a fan from the centre: the outline is convex)
            for (int face = 0; face < 2; face++)
            {
                float yy = face == 0 ? thickness / 2 : -thickness / 2;
                int b = v.Count;
                v.Add(pitch * new Vector3(c.x, yy, c.y)); uv.Add(new Vector2(0.5f, 0.5f));
                foreach (var p in outline) { v.Add(pitch * new Vector3(p.x, yy, p.y)); uv.Add(new Vector2((p.x - rootX) / (tipX - rootX), p.y / midWidth + 0.5f)); }
                for (int i = 0; i < n; i++)
                {
                    int a = b + 1 + i, d = b + 1 + (i + 1) % n;
                    if (face == 0) t.AddRange(new[] { b, d, a }); else t.AddRange(new[] { b, a, d });
                }
            }
            // sides
            for (int i = 0; i < n; i++)
            {
                int j = (i + 1) % n, b = v.Count;
                var p0 = outline[i]; var p1 = outline[j];
                v.Add(pitch * new Vector3(p0.x, thickness / 2, p0.y)); v.Add(pitch * new Vector3(p1.x, thickness / 2, p1.y));
                v.Add(pitch * new Vector3(p1.x, -thickness / 2, p1.y)); v.Add(pitch * new Vector3(p0.x, -thickness / 2, p0.y));
                uv.Add(Vector2.zero); uv.Add(Vector2.right); uv.Add(Vector2.one); uv.Add(Vector2.up);
                t.AddRange(new[] { b, b + 1, b + 2, b, b + 2, b + 3 });
            }
            var m = new Mesh { name = "SH_Blade" };
            m.SetVertices(v); m.SetUVs(0, uv); m.SetTriangles(t, 0);
            m.RecalculateNormals(); m.RecalculateBounds();
            return m;
        }

        public static Mesh Combine(IList<Mesh> meshes, IList<Matrix4x4> transforms, string name)
        {
            var ci = new CombineInstance[meshes.Count];
            for (int i = 0; i < ci.Length; i++) { ci[i].mesh = meshes[i]; ci[i].transform = transforms[i]; }
            var m = new Mesh { name = name };
            m.CombineMeshes(ci, true, true);
            m.RecalculateBounds();
            return m;
        }
    }
}
