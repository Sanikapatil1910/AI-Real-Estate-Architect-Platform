// Materials built in code from whatever Lit shader the project uses (URP / HDRP / built-in), so the package has no shader or material dependency.
// IN A BUILD, Shader.Find only finds shaders that are included: add "Universal Render Pipeline/Lit" to Project Settings > Graphics > Always Included
// Shaders, or assign materials in the SmartHouseConfig (a material referenced by an asset is always included).
using System.Collections.Generic;
using UnityEngine;

namespace RealEstate.SmartHouse
{
    public static class SmartMaterials
    {
        static readonly string[] LitNames = { "Universal Render Pipeline/Lit", "HDRP/Lit", "Standard" };
        static readonly Dictionary<string, Material> cache = new Dictionary<string, Material>();

        public static Shader Lit()
        {
            foreach (var n in LitNames) { var s = Shader.Find(n); if (s != null) return s; }
            var fallback = Shader.Find("Unlit/Color");
            if (fallback == null) Debug.LogWarning("[SmartHouse] No Lit or Unlit shader could be found: add one to Always Included Shaders or assign materials in the config.");
            return fallback;
        }

        public static Material Make(string key, Color color, float metallic, float smoothness, Texture2D map = null, Material custom = null, float normalScale = 1f)
        {
            if (custom != null) return custom;
            Material m;
            if (cache.TryGetValue(key, out m) && m != null) return m;
            var sh = Lit();
            m = new Material(sh != null ? sh : Shader.Find("Sprites/Default")) { name = "SH_" + key };
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", color);
            if (m.HasProperty("_Color")) m.SetColor("_Color", color);
            if (map != null) { if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", map); if (m.HasProperty("_MainTex")) m.SetTexture("_MainTex", map); }
            if (m.HasProperty("_Metallic")) m.SetFloat("_Metallic", metallic);
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", smoothness);
            if (m.HasProperty("_Glossiness")) m.SetFloat("_Glossiness", smoothness);
            cache[key] = m;
            return m;
        }

        /// <summary>An emissive material instance for a light fixture / LED (instance: its emission is animated per fixture).</summary>
        public static Material MakeEmissive(Color baseColor, Material custom = null)
        {
            var m = custom != null ? new Material(custom) : new Material(Lit() ?? Shader.Find("Sprites/Default")) { name = "SH_Emissive" };
            if (custom == null)
            {
                if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", baseColor);
                if (m.HasProperty("_Color")) m.SetColor("_Color", baseColor);
                if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", 0.6f);
            }
            m.EnableKeyword("_EMISSION");
            m.globalIlluminationFlags = MaterialGlobalIlluminationFlags.None;
            SetEmission(m, Color.black);
            return m;
        }

        public static void SetEmission(Material m, Color c)
        {
            if (m.HasProperty("_EmissionColor")) m.SetColor("_EmissionColor", c);
        }

        /// <summary>A seamless-ish wood grain, generated once (128 x 256, ~130 kB): long streaks of two brown tones broken by noise.</summary>
        public static Texture2D WoodGrain(Color dark, Color light, int seed = 7)
        {
            const int w = 128, h = 256;
            var tex = new Texture2D(w, h, TextureFormat.RGBA32, true) { name = "SH_WoodGrain", wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Bilinear, anisoLevel = 4 };
            var px = new Color[w * h];
            float off = seed * 13.37f;
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    float u = (float)x / w, v = (float)y / h;
                    // rings stretched along the length (v), distorted by low-frequency noise so no two streaks are straight
                    float warp = Mathf.PerlinNoise(off + u * 3f, v * 1.5f) * 2.2f;
                    float rings = Mathf.Sin((u * 14f + warp) * Mathf.PI);
                    float fine = Mathf.PerlinNoise(off + u * 60f, v * 4f);
                    float t = Mathf.Clamp01(0.5f + 0.32f * rings + 0.25f * (fine - 0.5f));
                    px[y * w + x] = Color.Lerp(dark, light, t);
                }
            tex.SetPixels(px);
            tex.Apply(true);
            return tex;
        }
    }
}
