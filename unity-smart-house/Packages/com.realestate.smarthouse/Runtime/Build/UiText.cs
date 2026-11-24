using System.Collections;
using UnityEngine;

namespace RealEstate.SmartHouse
{
    /// <summary>World-space text from the built-in TextMesh (no TextMeshPro dependency), scaled to a requested height after its first frame.</summary>
    public static class UiText
    {
        static Font font;

        static Font DefaultFont()
        {
            if (font != null) return font;
            // Unity 2022.2+ ships LegacyRuntime.ttf, older versions Arial.ttf
            try { font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf"); } catch { font = null; }
            if (font == null) { try { font = Resources.GetBuiltinResource<Font>("Arial.ttf"); } catch { font = null; } }
            return font;
        }

        public static TextMesh Create(Transform parent, string name, string text, float heightM, Color color, TextAnchor anchor = TextAnchor.MiddleCenter)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var tm = go.AddComponent<TextMesh>();
            var f = DefaultFont();
            if (f != null) tm.font = f;
            tm.text = text; tm.anchor = anchor; tm.alignment = TextAlignment.Center; tm.fontSize = 64; tm.color = color;
            tm.characterSize = heightM / 6.4f;                    // a first estimate (line height ~ characterSize * fontSize / 10); TextFit corrects it
            var mr = go.GetComponent<MeshRenderer>();
            if (mr != null && f != null) mr.sharedMaterial = f.material;
            if (mr != null) { mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; mr.receiveShadows = false; }
            var fit = go.AddComponent<TextFit>();
            fit.targetHeight = heightM;
            return tm;
        }
    }

    /// <summary>Measures the rendered text once and rescales it so a line is <see cref="targetHeight"/> metres tall (TextMesh sizes differ between Unity versions).</summary>
    public sealed class TextFit : MonoBehaviour
    {
        public float targetHeight = 0.02f;
        IEnumerator Start()
        {
            yield return null;
            var r = GetComponent<Renderer>();
            if (r == null) yield break;
            float h = r.bounds.size.y;
            if (h > 1e-5f && !float.IsNaN(h))
            {
                float k = Mathf.Clamp(targetHeight / h, 0.05f, 20f);
                if (Mathf.Abs(k - 1f) > 0.05f) transform.localScale *= k;
            }
            Destroy(this);
        }
    }
}
