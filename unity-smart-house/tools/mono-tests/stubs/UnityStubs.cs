// Minimal functional stand-ins for the UnityEngine API used by the package, to compile and exercise it under Mono.  NOT Unity: it catches typos and logic
// errors in the package's own code; it cannot catch a wrong assumption about real Unity behaviour.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;

namespace UnityEngine
{
    public struct Vector2
    {
        public float x, y; public Vector2(float x, float y) { this.x = x; this.y = y; }
        public float magnitude { get { return (float)Math.Sqrt(x * x + y * y); } }
        public static Vector2 zero { get { return new Vector2(0, 0); } } public static Vector2 one { get { return new Vector2(1, 1); } }
        public static Vector2 up { get { return new Vector2(0, 1); } } public static Vector2 right { get { return new Vector2(1, 0); } }
        public static Vector2 operator +(Vector2 a, Vector2 b) { return new Vector2(a.x + b.x, a.y + b.y); }
        public static Vector2 operator /(Vector2 a, float f) { return new Vector2(a.x / f, a.y / f); }
        public static Vector2 operator *(Vector2 a, float f) { return new Vector2(a.x * f, a.y * f); }
    }
    public struct Vector3
    {
        public float x, y, z;
        public Vector3(float x, float y, float z) { this.x = x; this.y = y; this.z = z; }
        public static Vector3 zero { get { return new Vector3(0, 0, 0); } }
        public static Vector3 one { get { return new Vector3(1, 1, 1); } }
        public static Vector3 right { get { return new Vector3(1, 0, 0); } }
        public static Vector3 up { get { return new Vector3(0, 1, 0); } }
        public static Vector3 down { get { return new Vector3(0, -1, 0); } }
        public static Vector3 forward { get { return new Vector3(0, 0, 1); } }
        public float magnitude { get { return (float)Math.Sqrt(x * x + y * y + z * z); } }
        public float sqrMagnitude { get { return x * x + y * y + z * z; } }
        public Vector3 normalized { get { float m = magnitude; return m > 1e-9f ? this / m : zero; } }
        public void Normalize() { this = normalized; }
        public static Vector3 operator +(Vector3 a, Vector3 b) { return new Vector3(a.x + b.x, a.y + b.y, a.z + b.z); }
        public static Vector3 operator -(Vector3 a, Vector3 b) { return new Vector3(a.x - b.x, a.y - b.y, a.z - b.z); }
        public static Vector3 operator -(Vector3 a) { return new Vector3(-a.x, -a.y, -a.z); }
        public static Vector3 operator *(Vector3 a, float f) { return new Vector3(a.x * f, a.y * f, a.z * f); }
        public static Vector3 operator *(float f, Vector3 a) { return a * f; }
        public static Vector3 operator /(Vector3 a, float f) { return new Vector3(a.x / f, a.y / f, a.z / f); }
        public static float Distance(Vector3 a, Vector3 b) { return (a - b).magnitude; }
        public static bool operator ==(Vector3 a, Vector3 b) { return (a - b).sqrMagnitude < 1e-10f; }
        public static bool operator !=(Vector3 a, Vector3 b) { return !(a == b); }
        public override bool Equals(object o) { return o is Vector3 && this == (Vector3)o; }
        public override int GetHashCode() { return 0; }
        public static float Dot(Vector3 a, Vector3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
        public static Vector3 Cross(Vector3 a, Vector3 b) { return new Vector3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
        public static Vector3 Scale(Vector3 a, Vector3 b) { return new Vector3(a.x * b.x, a.y * b.y, a.z * b.z); }
        public static Vector3 Min(Vector3 a, Vector3 b) { return new Vector3(Math.Min(a.x, b.x), Math.Min(a.y, b.y), Math.Min(a.z, b.z)); }
        public static Vector3 Max(Vector3 a, Vector3 b) { return new Vector3(Math.Max(a.x, b.x), Math.Max(a.y, b.y), Math.Max(a.z, b.z)); }
        public static Vector3 Lerp(Vector3 a, Vector3 b, float t) { t = Mathf.Clamp01(t); return a + (b - a) * t; }
        public override string ToString() { return "(" + x.ToString("0.###") + ", " + y.ToString("0.###") + ", " + z.ToString("0.###") + ")"; }
    }
    public struct Color
    {
        public float r, g, b, a;
        public Color(float r, float g, float b, float a = 1) { this.r = r; this.g = g; this.b = b; this.a = a; }
        public static Color black { get { return new Color(0, 0, 0); } }
        public static Color white { get { return new Color(1, 1, 1); } }
        public static Color green { get { return new Color(0, 1, 0); } }
        public static Color yellow { get { return new Color(1, 1, 0); } }
        public static Color cyan { get { return new Color(0, 1, 1); } }
        public static Color operator *(Color c, float f) { return new Color(c.r * f, c.g * f, c.b * f, c.a); }
        public static Color Lerp(Color a, Color b, float t) { return new Color(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, 1); }
    }
    public struct Quaternion
    {
        public float x, y, z, w;
        public Quaternion(float x, float y, float z, float w) { this.x = x; this.y = y; this.z = z; this.w = w; }
        public static Quaternion identity { get { return new Quaternion(0, 0, 0, 1); } }
        public static Quaternion operator *(Quaternion a, Quaternion b)
        { return new Quaternion(a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, a.w * b.y + a.y * b.w + a.z * b.x - a.x * b.z, a.w * b.z + a.z * b.w + a.x * b.y - a.y * b.x, a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z); }
        public static Vector3 operator *(Quaternion q, Vector3 v)
        {
            var u = new Vector3(q.x, q.y, q.z); float s = q.w;
            return u * (2f * Vector3.Dot(u, v)) + v * (s * s - Vector3.Dot(u, u)) + Vector3.Cross(u, v) * (2f * s);
        }
        public static float Angle(Quaternion a, Quaternion b) { float d = Math.Abs(a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w); return (float)(2*Math.Acos(Math.Min(1f,d))*180/Math.PI); }
        public static Quaternion Inverse(Quaternion q) { return new Quaternion(-q.x, -q.y, -q.z, q.w); }
        public static Quaternion AngleAxis(float deg, Vector3 axis)
        { axis = axis.normalized; float h = deg * Mathf.Deg2Rad * 0.5f, s = (float)Math.Sin(h); return new Quaternion(axis.x * s, axis.y * s, axis.z * s, (float)Math.Cos(h)); }
        // Unity: Z, then X, then Y
        public static Quaternion Euler(float x, float y, float z) { return AngleAxis(y, Vector3.up) * AngleAxis(x, Vector3.right) * AngleAxis(z, Vector3.forward); }
        public static Quaternion LookRotation(Vector3 fwd) { return LookRotation(fwd, Vector3.up); }
        public static Quaternion LookRotation(Vector3 fwd, Vector3 up)
        {
            fwd = fwd.normalized; var right = Vector3.Cross(up, fwd).normalized; var u = Vector3.Cross(fwd, right);
            float m00 = right.x, m01 = u.x, m02 = fwd.x, m10 = right.y, m11 = u.y, m12 = fwd.y, m20 = right.z, m21 = u.z, m22 = fwd.z;
            float tr = m00 + m11 + m22; Quaternion q;
            if (tr > 0) { float s = (float)Math.Sqrt(tr + 1) * 2; q = new Quaternion((m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25f * s); }
            else if (m00 > m11 && m00 > m22) { float s = (float)Math.Sqrt(1 + m00 - m11 - m22) * 2; q = new Quaternion(0.25f * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s); }
            else if (m11 > m22) { float s = (float)Math.Sqrt(1 + m11 - m00 - m22) * 2; q = new Quaternion((m01 + m10) / s, 0.25f * s, (m12 + m21) / s, (m02 - m20) / s); }
            else { float s = (float)Math.Sqrt(1 + m22 - m00 - m11) * 2; q = new Quaternion((m02 + m20) / s, (m12 + m21) / s, 0.25f * s, (m10 - m01) / s); }
            return q;
        }
    }
    public struct Matrix4x4
    {
        public float[] m;
        public static Matrix4x4 identity { get { return TRS(Vector3.zero, Quaternion.identity, Vector3.one); } }
        public static Matrix4x4 TRS(Vector3 p, Quaternion q, Vector3 s)
        {
            var c0 = q * new Vector3(s.x, 0, 0); var c1 = q * new Vector3(0, s.y, 0); var c2 = q * new Vector3(0, 0, s.z);
            return new Matrix4x4 { m = new[] { c0.x, c1.x, c2.x, p.x, c0.y, c1.y, c2.y, p.y, c0.z, c1.z, c2.z, p.z, 0, 0, 0, 1f } };
        }
        public Vector3 MultiplyPoint3x4(Vector3 v) { return new Vector3(m[0] * v.x + m[1] * v.y + m[2] * v.z + m[3], m[4] * v.x + m[5] * v.y + m[6] * v.z + m[7], m[8] * v.x + m[9] * v.y + m[10] * v.z + m[11]); }
        public Vector3 MultiplyVector(Vector3 v) { return new Vector3(m[0] * v.x + m[1] * v.y + m[2] * v.z, m[4] * v.x + m[5] * v.y + m[6] * v.z, m[8] * v.x + m[9] * v.y + m[10] * v.z); }
        public static Matrix4x4 operator *(Matrix4x4 a, Matrix4x4 b)
        { var r = new float[16]; for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) { float s = 0; for (int k = 0; k < 4; k++) s += a.m[i * 4 + k] * b.m[k * 4 + j]; r[i * 4 + j] = s; } return new Matrix4x4 { m = r }; }
    }
    public struct Bounds
    {
        public Vector3 min, max;
        public Bounds(Vector3 c, Vector3 size) { min = c - size * 0.5f; max = c + size * 0.5f; }
        public Vector3 size { get { return max - min; } }
        public Vector3 center { get { return (min + max) * 0.5f; } }
    }
    public struct Rect { public float x, y, width, height; public Rect(float x, float y, float w, float h) { this.x = x; this.y = y; width = w; height = h; } }
    public struct Ray { public Vector3 origin, direction; public Ray(Vector3 o, Vector3 d) { origin = o; direction = d; } }
    public struct RaycastHit { public Collider collider; public Vector3 point; public float distance; }
    public struct LayerMask { public int value; public static implicit operator int(LayerMask m) { return m.value; } public static implicit operator LayerMask(int v) { return new LayerMask { value = v }; } }
    public struct CombineInstance { public Mesh mesh; public Matrix4x4 transform; public int subMeshIndex; }

    public static class Mathf
    {
        public const float PI = (float)Math.PI, Deg2Rad = PI / 180f;
        public static float Clamp(float v, float a, float b) { return v < a ? a : v > b ? b : v; }
        public static int Clamp(int v, int a, int b) { return v < a ? a : v > b ? b : v; }
        public static float Clamp01(float v) { return Clamp(v, 0, 1); }
        public static float Max(float a, float b) { return Math.Max(a, b); }
        public static int Max(int a, int b) { return Math.Max(a, b); }
        public static float Min(float a, float b) { return Math.Min(a, b); }
        public static float Abs(float a) { return Math.Abs(a); }
        public static float Sin(float a) { return (float)Math.Sin(a); }
        public static float Cos(float a) { return (float)Math.Cos(a); }
        public static float Exp(float a) { return (float)Math.Exp(a); }
        public static int RoundToInt(float a) { return (int)Math.Round(a); }
        public static bool Approximately(float a, float b) { return Math.Abs(a - b) < 1e-6f; }
        public static float MoveTowards(float c, float t, float d) { return Math.Abs(t - c) <= d ? t : c + Math.Sign(t - c) * d; }
        public static float Lerp(float a, float b, float t) { return a + (b - a) * Clamp01(t); }
        public static float PerlinNoise(float x, float y) { return 0.5f + 0.5f * (float)Math.Sin(x * 12.9898 + y * 78.233); }
    }

    public class Object
    {
        public string name = "";
        public static bool operator true(Object o) { return !ReferenceEquals(o, null) && !o.destroyed; }
        public static bool operator false(Object o) { return ReferenceEquals(o, null) || o.destroyed; }
        public static bool operator !(Object o) { return ReferenceEquals(o, null) || o.destroyed; }
        public static implicit operator bool(Object o) { return !ReferenceEquals(o, null) && !o.destroyed; }
        internal bool destroyed;
        public static List<Object> pendingDestroy = new List<Object>();
        public static void Destroy(Object o) { if (o != null) pendingDestroy.Add(o); }
        public static void DestroyImmediate(Object o) { if (o != null) pendingDestroy.Add(o); }
        public static void FlushDestroy()
        {
            foreach (var o in pendingDestroy.ToArray()) DoDestroy(o);
            pendingDestroy.Clear();
        }
        static void DoDestroy(Object o)
        {
            if (o.destroyed) return;
            var go = o as GameObject;
            if (go != null)
            {
                foreach (var c in go.components.ToArray()) DoDestroy(c);
                foreach (var ch in go.transform.children.ToArray()) DoDestroy(ch.gameObject);
                if (go.transform.parent != null) go.transform.parent.children.Remove(go.transform);
                go.destroyed = true; Scene.all.Remove(go); return;
            }
            var b = o as Behaviour;
            if (b != null) { b.CallOnDisable(); b.CallOnDestroy(); b.gameObject.components.Remove(b); }
            var comp = o as Component; if (comp != null && b == null) comp.gameObject.components.Remove(comp);
            o.destroyed = true;
        }
        public static T FindObjectOfType<T>() where T : Object { return Scene.AllComponents().OfType<T>().FirstOrDefault(); }
        public static T[] FindObjectsOfType<T>() where T : Object { return Scene.AllComponents().OfType<T>().ToArray(); }
        public static void DontDestroyOnLoad(Object o) { }
    }
    public static class Scene { public static List<GameObject> all = new List<GameObject>(); public static IEnumerable<Component> AllComponents() { return all.Where(g => g.activeInHierarchy).SelectMany(g => g.components.ToArray()); } public static void Reset() { foreach (var m in AllComponents().OfType<MonoBehaviour>().ToList()) { m.CallOnDisable(); m.CallOnDestroy(); } all.Clear(); Object.pendingDestroy.Clear(); } }

    public class Component : Object
    {
        public string tag = ""; public GameObject gameObject; public Transform transform { get { return gameObject.transform; } }
        public T GetComponent<T>() where T : class { return gameObject.GetComponent<T>(); }
        public T GetComponentInParent<T>() where T : class { for (var t = transform; t != null; t = t.parent) { var c = t.gameObject.GetComponent<T>(); if (c != null) return c; } return null; }
        public T[] GetComponentsInChildren<T>(bool inactive = false) where T : class { return gameObject.GetComponentsInChildren<T>(inactive); }
    }
    public class Behaviour : Component
    {
        public bool enabled = true;
        public bool isActiveAndEnabled { get { return enabled && gameObject.activeInHierarchy; } }
        internal bool awoken, started;
        internal virtual void CallOnDisable() { }
        internal virtual void CallOnDestroy() { }
    }
    public class MonoBehaviour : Behaviour
    {
        MethodInfoCache mi;
        class MethodInfoCache { }
        internal override void CallOnDisable() { Invoke("OnDisable"); }
        internal override void CallOnDestroy() { Invoke("OnDestroy"); }
        internal void Invoke(string n) { var m = GetType().GetMethod(n, System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public); if (m != null) m.Invoke(this, null); }
        internal object InvokeRet(string n) { var m = GetType().GetMethod(n, System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public); return m == null ? null : m.Invoke(this, null); }
        internal bool Has(string n) { return GetType().GetMethod(n, System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public) != null; }
        internal IEnumerator startRoutine;
        public Coroutine StartCoroutine(IEnumerator e) { return null; }
    }
    public class Coroutine { }
    public class ScriptableObject : Object { public static T CreateInstance<T>() where T : ScriptableObject, new() { return new T(); } }

    public class GameObject : Object
    {
        public string tag = "";
        public Transform transform; internal List<Component> components = new List<Component>(); public bool activeSelf = true;
        public bool activeInHierarchy { get { for (var t = transform; t != null; t = t.parent) if (!t.gameObject.activeSelf) return false; return !destroyed; } }
        public GameObject() : this("GameObject") { }
        public GameObject(string n) { name = n; transform = new Transform { gameObject = this }; components.Add(transform); Scene.all.Add(this); }
        public static GameObject CreatePrimitive(PrimitiveType t) { var g = new GameObject(t.ToString()); g.AddComponent<MeshFilter>(); g.AddComponent<MeshRenderer>(); g.AddComponent<BoxCollider>(); return g; }
        public void SetActive(bool a) { activeSelf = a; }
        public T AddComponent<T>() where T : Component, new()
        {
            var c = new T { gameObject = this }; components.Add(c);
            var mb = c as MonoBehaviour;
            if (mb != null) { mb.Invoke("Awake"); mb.awoken = true; }
            return c;
        }
        public T GetComponent<T>() where T : class { return components.OfType<T>().FirstOrDefault(); }
        public T[] GetComponentsInChildren<T>(bool inactive = false) where T : class
        {
            var r = new List<T>(); Collect(transform, r, inactive); return r.ToArray();
        }
        static void Collect<T>(Transform t, List<T> r, bool inactive) where T : class
        {
            if (!inactive && !t.gameObject.activeSelf) return;
            r.AddRange(t.gameObject.components.OfType<T>());
            foreach (var c in t.children) Collect(c, r, inactive);
        }
    }

    public class Transform : Component
    {
        public Vector3 localPosition = Vector3.zero, localScale = Vector3.one; public Quaternion localRotation = Quaternion.identity;
        public Transform parent; internal List<Transform> children = new List<Transform>();
        public void SetParent(Transform p, bool worldStays = true)
        {
            if (parent != null) parent.children.Remove(this);
            parent = p; if (p != null) p.children.Add(this);
        }
        Matrix4x4 Local { get { return Matrix4x4.TRS(localPosition, localRotation, localScale); } }
        public Matrix4x4 localToWorldMatrix { get { return parent == null ? Local : parent.localToWorldMatrix * Local; } }
        public Quaternion rotation
        {
            get { return parent == null ? localRotation : parent.rotation * localRotation; }
            set { localRotation = parent == null ? value : Quaternion.Inverse(parent.rotation) * value; }
        }
        public Vector3 position
        {
            get { return localToWorldMatrix.MultiplyPoint3x4(Vector3.zero); }
            set { localPosition = parent == null ? value : parent.InverseTransformPoint(value); }
        }
        public Vector3 lossyScale { get { var m = localToWorldMatrix; return new Vector3(m.MultiplyVector(Vector3.right).magnitude, m.MultiplyVector(Vector3.up).magnitude, m.MultiplyVector(Vector3.forward).magnitude); } }
        public void SetPositionAndRotation(Vector3 p, Quaternion r) { position = p; rotation = r; }
        public bool IsChildOf(Transform t) { for (var x = this; x != null; x = x.parent) if (x == t) return true; return false; }
        public Vector3 TransformPoint(Vector3 p) { return localToWorldMatrix.MultiplyPoint3x4(p); }
        public Vector3 TransformDirection(Vector3 d) { return rotation * d; }
        public Vector3 InverseTransformPoint(Vector3 p)
        {
            var q = Quaternion.Inverse(rotation); var s = lossyScale; var d = q * (p - position);
            return new Vector3(d.x / s.x, d.y / s.y, d.z / s.z);
        }
        public Transform GetChild(int i) { return children[i]; }
        public int childCount { get { return children.Count; } }
        public Vector3 forward { get { return rotation * Vector3.forward; } }
        public Vector3 up { get { return rotation * Vector3.up; } }
        public Quaternion localRotationQ { get { return localRotation; } }
    }

    public class Mesh : Object
    {
        public Vector3[] vertices = new Vector3[0]; public Vector3[] normals = new Vector3[0]; public Vector2[] uv = new Vector2[0]; public int[] triangles = new int[0];
        public Bounds bounds;
        public void SetVertices(List<Vector3> v) { vertices = v.ToArray(); }
        public void SetNormals(List<Vector3> n) { normals = n.ToArray(); }
        public void SetUVs(int ch, List<Vector2> u) { uv = u.ToArray(); }
        public void SetTriangles(List<int> t, int sub) { triangles = t.ToArray(); }
        public void SetTriangles(int[] t, int sub) { triangles = t; }
        public void RecalculateBounds() { if (vertices.Length == 0) return; var mn = vertices[0]; var mx = vertices[0]; foreach (var v in vertices) { mn = Vector3.Min(mn, v); mx = Vector3.Max(mx, v); } bounds = new Bounds { min = mn, max = mx }; }
        public void RecalculateNormals()
        {
            var n = new Vector3[vertices.Length];
            for (int i = 0; i < triangles.Length; i += 3)
            {
                var a = vertices[triangles[i]]; var b = vertices[triangles[i + 1]]; var c = vertices[triangles[i + 2]];
                var fn = Vector3.Cross(b - a, c - a);
                n[triangles[i]] = n[triangles[i]] + fn; n[triangles[i + 1]] = n[triangles[i + 1]] + fn; n[triangles[i + 2]] = n[triangles[i + 2]] + fn;
            }
            for (int i = 0; i < n.Length; i++) n[i] = n[i].normalized;
            normals = n;
        }
        public void CombineMeshes(CombineInstance[] ci, bool merge, bool useMatrices)
        {
            var v = new List<Vector3>(); var nn = new List<Vector3>(); var u = new List<Vector2>(); var t = new List<int>();
            foreach (var c in ci)
            {
                int b = v.Count;
                foreach (var p in c.mesh.vertices) v.Add(c.transform.MultiplyPoint3x4(p));
                foreach (var p in c.mesh.normals) nn.Add(c.transform.MultiplyVector(p).normalized);
                u.AddRange(c.mesh.uv);
                foreach (var i in c.mesh.triangles) t.Add(i + b);
            }
            vertices = v.ToArray(); normals = nn.ToArray(); uv = u.ToArray(); triangles = t.ToArray();
        }
    }
    public class Shader : Object { public static Shader Find(string n) { return new Shader { name = n }; } }
    public class Texture : Object { }
    public enum TextureFormat { RGBA32 }
    public enum TextureWrapMode { Repeat }
    public enum FilterMode { Bilinear }
    public class Texture2D : Texture
    {
        public TextureWrapMode wrapMode; public FilterMode filterMode; public int anisoLevel; public int w, h;
        public Texture2D(int w, int h, TextureFormat f, bool mips) { this.w = w; this.h = h; }
        public void SetPixels(Color[] c) { }
        public void Apply(bool m) { }
    }
    public enum MaterialGlobalIlluminationFlags { None }
    public class Material : Object
    {
        public Shader shader; public MaterialGlobalIlluminationFlags globalIlluminationFlags; public Dictionary<string, object> props = new Dictionary<string, object>();
        static readonly HashSet<string> known = new HashSet<string> { "_BaseColor", "_BaseMap", "_Metallic", "_Smoothness", "_EmissionColor" };
        public Material(Shader s) { shader = s; }
        public Material(Material m) { shader = m.shader; props = new Dictionary<string, object>(m.props); name = m.name; }
        public bool HasProperty(string n) { return known.Contains(n); }
        public void SetColor(string n, Color c) { props[n] = c; } public void SetFloat(string n, float f) { props[n] = f; } public void SetTexture(string n, Texture t) { props[n] = t; }
        public Color GetColor(string n) { return props.ContainsKey(n) ? (Color)props[n] : Color.black; }
        public Texture GetTexture(string n) { return props.ContainsKey(n) ? (Texture)props[n] : null; }
        public void EnableKeyword(string k) { }
    }
    public enum LightType { Point } public enum LightShadows { None, Hard, Soft } public enum LightRenderMode { Auto }
    public class Light : Behaviour { public LightType type; public LightShadows shadows; public float range, intensity; public Color color; public LightRenderMode renderMode; }
    public class Collider : Component { }
    public class BoxCollider : Collider { public Vector3 size, center; }
    public class MeshFilter : Component { public Mesh sharedMesh; }
    public class Renderer : Behaviour
    {
        public Material sharedMaterial; Material inst; public bool receiveShadows;
        public UnityEngine.Rendering.ShadowCastingMode shadowCastingMode;
        public Material material { get { return inst ?? (inst = new Material(sharedMaterial ?? new Material(new Shader()))); } }
        public Bounds boundsOverride; public bool hasOverride;
        public Bounds bounds
        {
            get
            {
                if (hasOverride) return boundsOverride;
                var mf = GetComponent<MeshFilter>(); if (mf == null || mf.sharedMesh == null || mf.sharedMesh.vertices.Length == 0) return new Bounds(transform.position, Vector3.zero);
                var m = transform.localToWorldMatrix; var mn = new Vector3(1e9f, 1e9f, 1e9f); var mx = -mn;
                foreach (var v in mf.sharedMesh.vertices) { var w = m.MultiplyPoint3x4(v); mn = Vector3.Min(mn, w); mx = Vector3.Max(mx, w); }
                return new Bounds { min = mn, max = mx };
            }
        }
    }
    public class MeshRenderer : Renderer { }
    public class LineRenderer : Renderer
    {
        public int positionCount; public float widthMultiplier; public bool useWorldSpace; public Vector3[] pos = new Vector3[2];
        public void SetPosition(int i, Vector3 p) { pos[i] = p; }
    }
    public class TrailRenderer : Renderer { }
    public enum TextAnchor { UpperLeft, UpperCenter, UpperRight, MiddleLeft, MiddleCenter, MiddleRight, LowerLeft, LowerCenter, LowerRight } public enum TextAlignment { Left, Center, Right }
    public class Font : Object { public Material material = new Material(new Shader()); }
    public static class Resources { public static T GetBuiltinResource<T>(string n) where T : Object, new() { return new T(); } }
    public class TextMesh : Component { public string text; public TextAnchor anchor; public TextAlignment alignment; public int fontSize; public Color color; public float characterSize; public Font font; }
    public enum PrimitiveType { Quad, Cube }
    public class Camera : Behaviour { public static Camera main; public static Camera[] allCameras { get { return Scene.AllComponents().OfType<Camera>().ToArray(); } } public Ray ScreenPointToRay(Vector3 p) { return new Ray(); } }
    public static class Time { public static float time, deltaTime = 0.016f, unscaledTime, unscaledDeltaTime = 0.016f; }
    public static class Application { public static bool isEditor = true; public static bool isPlaying = true; }
    public static class Debug
    {
        public static List<string> log = new List<string>(); public static bool isDebugBuild = true;
        public static void Log(object o) { log.Add("LOG " + o); } public static void LogWarning(object o) { log.Add("WARN " + o); } public static void LogError(object o) { log.Add("ERR " + o); }
    }
    public enum KeyCode { Return }
    public static class Input { public static Vector3 mousePosition; public static bool GetMouseButton(int i) { return false; } }
    public static class Physics
    {
        public static bool Raycast(Ray r, out RaycastHit hit, float dist, int mask, QueryTriggerInteraction q)
        {
            hit = default(RaycastHit); float best = dist; bool any = false;
            foreach (var bc in Scene.AllComponents().OfType<BoxCollider>())
            {
                var t = bc.transform; var o = t.InverseTransformPoint(r.origin); var d = Quaternion.Inverse(t.rotation) * r.direction; var ls = t.lossyScale; d = new Vector3(d.x / ls.x, d.y / ls.y, d.z / ls.z);
                var h = bc.size * 0.5f; var c = bc.center; float t0 = 0, t1 = float.MaxValue; bool ok = true;
                float[] oo = { o.x - c.x, o.y - c.y, o.z - c.z }, dd = { d.x, d.y, d.z }, hh = { h.x, h.y, h.z };
                for (int i = 0; i < 3 && ok; i++)
                {
                    if (Math.Abs(dd[i]) < 1e-9f) { if (Math.Abs(oo[i]) > hh[i]) ok = false; }
                    else { float a = (-hh[i] - oo[i]) / dd[i], b = (hh[i] - oo[i]) / dd[i]; if (a > b) { var tmp = a; a = b; b = tmp; } t0 = Math.Max(t0, a); t1 = Math.Min(t1, b); if (t0 > t1) ok = false; }
                }
                if (ok && t0 < best) { best = t0; any = true; hit = new RaycastHit { collider = bc, distance = t0, point = r.origin + r.direction * t0 }; }
            }
            return any;
        }
    }
    public enum QueryTriggerInteraction { Collide }
    public class Event { public static Event current = new Event(); public EventType type; public KeyCode keyCode; }
    public enum EventType { KeyDown }
    public static class GUI { public static string GetNameOfFocusedControl() { return ""; } public static void DragWindow() { } }
    public static class GUILayout
    {
        public static Rect Window(int id, Rect r, Action<int> f, string t) { return r; }
        public static void Label(string s, params object[] o) { } public static string TextField(string s, params object[] o) { return s; } public static bool Button(string s, params object[] o) { return false; }
        public static void BeginHorizontal() { } public static void EndHorizontal() { } public static Vector2 BeginScrollView(Vector2 v) { return v; } public static void EndScrollView() { }
        public static object MinWidth(float f) { return null; } public static object Width(float f) { return null; }
    }
    public static class Gizmos { public static Color color; public static Matrix4x4 matrix; public static void DrawWireCube(Vector3 a, Vector3 b) { } public static void DrawLine(Vector3 a, Vector3 b) { } }
    public class WaitForSeconds { public WaitForSeconds(float s) { } }
    [AttributeUsage(AttributeTargets.All)] public class HeaderAttribute : Attribute { public HeaderAttribute(string s) { } }
    [AttributeUsage(AttributeTargets.All)] public class TooltipAttribute : Attribute { public TooltipAttribute(string s) { } }
    [AttributeUsage(AttributeTargets.All)] public class RangeAttribute : Attribute { public RangeAttribute(float a, float b) { } }
    [AttributeUsage(AttributeTargets.All)] public class DisallowMultipleComponent : Attribute { }
    [AttributeUsage(AttributeTargets.All)] public class DefaultExecutionOrder : Attribute { public DefaultExecutionOrder(int i) { } }
    [AttributeUsage(AttributeTargets.All)] public class CreateAssetMenuAttribute : Attribute { public string fileName, menuName; }
    [AttributeUsage(AttributeTargets.All)] public class SerializeField : Attribute { }
}
namespace UnityEngine.Rendering { public enum ShadowCastingMode { Off } }
namespace UnityEngine.Events { public class UnityEvent { public int calls; public void Invoke() { calls++; } } }
namespace UnityEngine.XR
{
    public enum XRNode { LeftHand, RightHand }
    public struct HapticCapabilities { public bool supportsImpulse; }
    public class InputFeatureUsage<T> { public string n; }
    public static class CommonUsages
    {
        public static readonly InputFeatureUsage<Vector3> devicePosition = new InputFeatureUsage<Vector3>();
        public static readonly InputFeatureUsage<Quaternion> deviceRotation = new InputFeatureUsage<Quaternion>();
        public static readonly InputFeatureUsage<bool> triggerButton = new InputFeatureUsage<bool>(), primaryButton = new InputFeatureUsage<bool>(), secondaryButton = new InputFeatureUsage<bool>(), gripButton = new InputFeatureUsage<bool>();
    }
    public struct InputDevice
    {
        public bool isValid; public XRNode node;
        public static Dictionary<XRNode, Dictionary<object, object>> fake = new Dictionary<XRNode, Dictionary<object, object>>();
        public static List<string> haptics = new List<string>();
        public bool TryGetFeatureValue(InputFeatureUsage<bool> u, out bool v) { object o; v = false; Dictionary<object, object> d; if (fake.TryGetValue(node, out d) && d.TryGetValue(u, out o)) { v = (bool)o; return true; } return false; }
        public bool TryGetFeatureValue(InputFeatureUsage<Vector3> u, out Vector3 v) { object o; v = Vector3.zero; Dictionary<object, object> d; if (fake.TryGetValue(node, out d) && d.TryGetValue(u, out o)) { v = (Vector3)o; return true; } return false; }
        public bool TryGetFeatureValue(InputFeatureUsage<Quaternion> u, out Quaternion v) { object o; v = Quaternion.identity; Dictionary<object, object> d; if (fake.TryGetValue(node, out d) && d.TryGetValue(u, out o)) { v = (Quaternion)o; return true; } return false; }
        public bool TryGetHapticCapabilities(out HapticCapabilities c) { c = new HapticCapabilities { supportsImpulse = true }; return true; }
        public bool SendHapticImpulse(uint ch, float a, float d) { haptics.Add(node + ":" + a); return true; }
    }
    public static class InputDevices { public static InputDevice GetDeviceAtXRNode(XRNode n) { return new InputDevice { node = n, isValid = InputDevice.fake.ContainsKey(n) }; } }
}
namespace UnityEngine { public class TextAsset : Object { public string text; public TextAsset() { } public TextAsset(string t) { text = t; } } }
