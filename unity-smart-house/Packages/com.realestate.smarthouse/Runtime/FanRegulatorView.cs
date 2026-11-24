using System.Collections.Generic;
using RealEstate.SmartHouse.Core;
using UnityEngine;

namespace RealEstate.SmartHouse
{
    /// <summary>
    /// Wall fan regulator: six pads, 0 (off) to 5, and a read-out.  Selecting a pad sets that level on the fan's <see cref="FanModel"/>; the lit pad is the
    /// model's level (so it also follows voice), and the read-out shows the SPEED THE BLADES ARE ACTUALLY TURNING at (measured from the same model the
    /// blades are driven by), so "level 2" on the panel and level 2 in the room are the same number by construction.
    /// </summary>
    public sealed class FanRegulatorView : MonoBehaviour
    {
        public string roomKey = "";
        public Renderer[] pads = new Renderer[6];
        public TextMesh readout;

        SmartHouseState state;
        readonly List<Material> padMats = new List<Material>();
        float nextRefresh;
        static readonly Color Lit = new Color(1f, 0.72f, 0.2f);

        public void Bind(SmartHouseState s, string key)
        {
            Unbind();
            state = s; roomKey = key;
            state.FanLevelChanged += OnLevel;
            padMats.Clear();
            foreach (var r in pads) padMats.Add(r != null ? r.material : null);
            Redraw();
        }

        void Unbind() { if (state != null) state.FanLevelChanged -= OnLevel; state = null; }
        void OnDisable() { Unbind(); }
        void OnDestroy() { Unbind(); foreach (var m in padMats) if (m != null) Destroy(m); }
        void OnLevel(string key, int level, ControlSource src) { if (key == roomKey) Redraw(); }

        void Update()
        {
            if (state == null || readout == null || Time.unscaledTime < nextRefresh) return;
            nextRefresh = Time.unscaledTime + 0.1f;
            Redraw();
        }

        void Redraw()
        {
            if (state == null) return;
            int level = state.FanLevel(roomKey);
            for (int i = 0; i < padMats.Count; i++)
                if (padMats[i] != null) SmartMaterials.SetEmission(padMats[i], i == level ? Lit * 2.4f : Color.black);
            var f = state.Fan(roomKey);
            if (readout != null && f != null)
            {
                int rpm = Mathf.RoundToInt((float)(f.VelocityDegPerSec / 6.0));
                readout.text = "FAN " + (level == 0 ? "OFF" : level.ToString()) + "\n" + rpm + " rpm";
            }
        }
    }

    /// <summary>One pad of the regulator.</summary>
    public sealed class FanRegulatorPad : MonoBehaviour, ISmartInteractable
    {
        public int level;
        public FanRegulatorView owner;
        SmartHouseState state;
        string key = "";
        Renderer rend;
        public string Label { get { return "Fan speed " + level; } }

        public void Bind(SmartHouseState s, string roomKey, Renderer r) { state = s; key = roomKey; rend = r; }
        public void Activate() { if (state != null) state.SetFanLevel(key, level, ControlSource.Panel); }
        public void SetHover(bool h) { if (rend != null && rend.sharedMaterial != null) rend.transform.localScale = new Vector3(1f, 1f, h ? 1.35f : 1f); }
    }
}
