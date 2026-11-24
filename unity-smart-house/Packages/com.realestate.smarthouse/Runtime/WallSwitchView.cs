using RealEstate.SmartHouse.Core;
using UnityEngine;

namespace RealEstate.SmartHouse
{
    /// <summary>
    /// A wall switch plate for one room's light.  Pressing it (controller ray + trigger, or the mouse in the editor) toggles the SAME light the voice
    /// commands control: it calls <see cref="LightBank.Toggle"/> and redraws from <see cref="LightBank.Changed"/>, so it also follows voice changes.
    /// </summary>
    public sealed class WallSwitchView : MonoBehaviour, ISmartInteractable
    {
        public string roomKey = "";
        public Transform rocker;
        public Renderer led;
        public Renderer plate;
        public TextMesh label;

        SmartHouseState state;
        Material ledMat, plateMat;
        bool hover;
        static readonly Color LedOn = new Color(0.2f, 1f, 0.35f), LedOff = new Color(0.35f, 0.08f, 0.05f);

        public string Label { get { return "Light switch"; } }
        public bool IsOn { get { return state != null && state.Lights.IsOn(roomKey); } }

        public void Bind(SmartHouseState s, string key)
        {
            Unbind();
            state = s; roomKey = key;
            state.Lights.Changed += OnChanged;
            if (led != null) ledMat = led.material;
            if (plate != null) plateMat = plate.material;
            Redraw();
        }

        void Unbind() { if (state != null) state.Lights.Changed -= OnChanged; state = null; }
        void OnDisable() { Unbind(); }
        void OnDestroy() { Unbind(); if (ledMat != null) Destroy(ledMat); if (plateMat != null) Destroy(plateMat); }
        void OnChanged(string key, bool on, ControlSource src) { if (key == roomKey) Redraw(); }

        public void Activate()
        {
            if (state == null) return;
            state.Lights.Toggle(roomKey, ControlSource.WallSwitch);
            Redraw();
        }

        public void SetHover(bool h) { hover = h; Redraw(); }

        void Redraw()
        {
            bool on = IsOn;
            if (rocker != null) rocker.localRotation = Quaternion.Euler(on ? -9f : 9f, 0, 0);     // the rocker tilts: top pressed in when ON
            if (ledMat != null) SmartMaterials.SetEmission(ledMat, (on ? LedOn : LedOff) * 2.2f);
            if (plateMat != null) SmartMaterials.SetEmission(plateMat, hover ? new Color(0.18f, 0.18f, 0.22f) : Color.black);
            if (label != null) { label.text = on ? "LIGHT ON" : "LIGHT OFF"; label.color = on ? new Color(0.65f, 1f, 0.7f) : new Color(0.85f, 0.85f, 0.85f); }
        }
    }
}
