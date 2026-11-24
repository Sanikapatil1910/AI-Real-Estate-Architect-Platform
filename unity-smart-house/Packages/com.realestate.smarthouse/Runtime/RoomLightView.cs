using RealEstate.SmartHouse.Core;
using UnityEngine;

namespace RealEstate.SmartHouse
{
    /// <summary>
    /// One room's ceiling light: a glowing fixture plus (when the budget allows) a real-time point light.  Follows <see cref="LightBank.Changed"/>, so a
    /// voice command, a wall switch and the controller all end up here.  Fades smoothly.
    /// </summary>
    public sealed class RoomLightView : MonoBehaviour
    {
        public string roomKey = "";
        public Light pointLight;
        public Renderer fixture;
        public SmartHouseConfig config;

        SmartHouseState state;
        Material fixtureMat;
        float level;            // 0..1 current brightness
        bool on;
        /// <summary>Set by the controller: false when this room is outside the real-time budget (the fixture still glows).</summary>
        public bool RealtimeAllowed = true;

        public float Level { get { return level; } }
        public bool IsOn { get { return on; } }

        public void Bind(SmartHouseState s, string key)
        {
            Unbind();
            state = s; roomKey = key;
            state.Lights.Changed += OnChanged;
            on = state.Lights.IsOn(key);
            level = on ? 1f : 0f;
            if (fixture != null) fixtureMat = fixture.material;       // a per-fixture instance: its emission is animated
            Apply();
        }

        void Unbind() { if (state != null) state.Lights.Changed -= OnChanged; state = null; }
        void OnDisable() { Unbind(); }
        void OnDestroy() { Unbind(); if (fixtureMat != null) Destroy(fixtureMat); }

        void OnChanged(string key, bool value, ControlSource src) { if (key == roomKey) on = value; }

        void Update()
        {
            float fade = config != null ? Mathf.Max(0.01f, config.fadeSeconds) : 0.18f;
            float target = on ? 1f : 0f;
            if (!Mathf.Approximately(level, target)) { level = Mathf.MoveTowards(level, target, Time.deltaTime / fade); Apply(); }
            else if (pointLight != null && pointLight.enabled != (target > 0f && RealtimeAllowed)) Apply();
        }

        void Apply()
        {
            var cfg = config;
            Color c = cfg != null ? cfg.lightColor : new Color(1f, 0.86f, 0.68f);
            if (pointLight != null)
            {
                pointLight.color = c;
                pointLight.intensity = (cfg != null ? cfg.onIntensity : 1.6f) * level;
                pointLight.enabled = level > 0.001f && RealtimeAllowed;      // a light that is off costs nothing
            }
            if (fixtureMat != null) SmartMaterials.SetEmission(fixtureMat, c * (3.2f * level));
        }
    }
}
