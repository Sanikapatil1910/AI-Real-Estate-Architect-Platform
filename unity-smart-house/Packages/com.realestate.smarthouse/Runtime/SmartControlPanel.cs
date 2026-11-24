using System;
using System.Collections.Generic;
using RealEstate.SmartHouse.Core;
using UnityEngine;
using UnityEngine.XR;

namespace RealEstate.SmartHouse
{
    /// <summary>One pressable button of the control panel: a raised emissive box with a label.  Selected with the same controller ray as the wall switches.</summary>
    public sealed class PanelButton : MonoBehaviour, ISmartInteractable
    {
        public Action onClick;
        public string label = "";
        public TextMesh text;
        public Renderer rend;
        public Material normal, lit, hover;
        bool isLit, isHover;

        public string Label { get { return label; } }
        public bool IsLit { get { return isLit; } }

        public void SetLit(bool v) { if (v == isLit) return; isLit = v; Apply(); }
        public void SetHover(bool h) { isHover = h; transform.localScale = h ? new Vector3(1.05f, 1.05f, 1f) : Vector3.one; Apply(); }
        public void Activate() { if (onClick != null) onClick(); }

        void Apply() { if (rend != null) rend.sharedMaterial = isHover ? hover : isLit ? lit : normal; }
        public void Init() { Apply(); }
    }

    /// <summary>
    /// The in-house control panel: master ON/OFF, one row per room (name, light ON/OFF, fan - / level / +), the automatic-light switch, the voice status
    /// line and the simulated energy read-out.  Every value is read from the shared <see cref="SmartHouseState"/> (through <see cref="PanelModel"/>), and
    /// every button calls the same state the voice commands and wall switches use, so the panel cannot show or do something different from them.
    /// It floats in world space where it was placed (it never follows the head), shows <see cref="PanelModel.RowsPerPage"/> rooms per page, and can be
    /// recalled in front of the player with the LEFT controller's secondary button (Y; X is left free for push-to-talk), or by saying "show the control panel".
    /// Panel local axes: +Z points AWAY from the viewer (like the toast), so a raised button is at negative Z.
    /// </summary>
    public sealed class SmartControlPanel : MonoBehaviour
    {
        public float distance = 1.1f, belowEyes = 0.25f;
        public XRNode recallHand = XRNode.LeftHand;

        const float W = 0.68f, H = 0.745f, CY = -0.0375f;
        static readonly Color Back = new Color(0.04f, 0.045f, 0.07f, 1f);
        static readonly Color TextCol = new Color(0.92f, 0.94f, 1f), Dim = new Color(0.62f, 0.66f, 0.74f);
        static readonly Color Good = new Color(0.65f, 1f, 0.7f), Warn = new Color(1f, 0.82f, 0.45f), Bad = new Color(1f, 0.55f, 0.5f);

        sealed class Row
        {
            public GameObject go;
            public TextMesh name, level;
            public PanelButton light, minus, plus;
            public string key = "";
        }

        SmartHouseController ctrl;
        SmartHouseState state;
        PanelModel model;
        Transform root;
        TextMesh voiceHead, voiceDetail, lightsLine, fanLine, autoLine, energy, pageText;
        PanelButton allOn, allOff, auto, prev, next, close;
        readonly Row[] rows = new Row[PanelModel.RowsPerPage];
        readonly List<Material> owned = new List<Material>();
        Material mNormal, mLit, mHover, mBack;
        bool dirty = true, placed, recallWas;
        float nextRefresh;
        bool built;

        public bool Visible { get { return root != null && root.gameObject.activeSelf; } }
        public PanelModel Model { get { return model; } }
        public int RowCount { get { return rows.Length; } }

        // ---- build ---------------------------------------------------------------------------------------------------------------------------
        void Build()
        {
            if (built) return;
            built = true;
            root = new GameObject("Panel").transform; root.SetParent(transform, false);
            mNormal = Mat(new Color(0.16f, 0.18f, 0.24f), Color.black);
            mLit = Mat(new Color(0.12f, 0.35f, 0.2f), new Color(0.15f, 0.9f, 0.35f) * 1.2f);
            mHover = Mat(new Color(0.25f, 0.3f, 0.42f), new Color(0.2f, 0.3f, 0.5f));
            mBack = Mat(Back, Color.black);

            var bg = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(bg.GetComponent<Collider>());                      // the backdrop must not block the controller ray
            bg.name = "Backdrop"; bg.transform.SetParent(root, false);
            bg.transform.localPosition = new Vector3(0, CY, 0.006f); bg.transform.localScale = new Vector3(W, H, 1f);
            var br = bg.GetComponent<Renderer>(); br.sharedMaterial = mBack; br.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; br.receiveShadows = false;

            TextMesh titleText = null; Lbl(ref titleText, "Title", "SMART HOUSE", 0.034f, new Vector3(-0.30f, 0.30f, 0), TextCol, TextAnchor.MiddleLeft);
            close = Btn("Close", "X", new Vector3(0.31f, 0.30f, 0), new Vector2(0.04f, 0.04f), Hide);
            Lbl(ref voiceHead, "VoiceHead", "Voice: off (use the panel)", 0.026f, new Vector3(-0.30f, 0.245f, 0), Dim, TextAnchor.MiddleLeft);
            Lbl(ref voiceDetail, "VoiceDetail", "“turn on the kitchen light”", 0.02f, new Vector3(-0.30f, 0.215f, 0), Dim, TextAnchor.MiddleLeft);

            allOn = Btn("AllOn", "ALL ON", new Vector3(-0.215f, 0.155f, 0), new Vector2(0.17f, 0.046f), () => { if (model != null) model.AllOn(); MarkDirty(); });
            allOff = Btn("AllOff", "ALL OFF", new Vector3(-0.03f, 0.155f, 0), new Vector2(0.17f, 0.046f), () => { if (model != null) model.AllOff(); MarkDirty(); });
            auto = Btn("Auto", "AUTO LIGHTS", new Vector3(0.195f, 0.155f, 0), new Vector2(0.24f, 0.046f), () => { if (model != null) model.ToggleAuto(); MarkDirty(); });

            Lbl(ref lightsLine, "Lights", "0 of 18 lights ON", 0.02f, new Vector3(-0.30f, 0.100f, 0), TextCol, TextAnchor.MiddleLeft);
            Lbl(ref fanLine, "Fans", "Fans: 1 running, highest speed 3", 0.02f, new Vector3(-0.30f, 0.074f, 0), TextCol, TextAnchor.MiddleLeft);
            Lbl(ref autoLine, "AutoLine", "Automatic lights: ON (1 room switching off soon)", 0.02f, new Vector3(-0.30f, 0.048f, 0), Dim, TextAnchor.MiddleLeft);

            for (int i = 0; i < rows.Length; i++)
            {
                var r = new Row(); rows[i] = r;
                float y = 0.0f - i * 0.05f;
                r.go = new GameObject("Row" + i); r.go.transform.SetParent(root, false);
                Lbl(ref r.name, "Name", "Master Bedroom (1F)", 0.022f, new Vector3(-0.30f, y, 0), TextCol, TextAnchor.MiddleLeft, r.go.transform);
                int idx = i;
                r.light = Btn("Light", "OFF", new Vector3(0.065f, y, 0), new Vector2(0.115f, 0.042f), () => { var k = rows[idx].key; if (model != null && k.Length > 0) model.ToggleLight(k); MarkDirty(); }, r.go.transform);
                r.minus = Btn("FanMinus", "-", new Vector3(0.165f, y, 0), new Vector2(0.04f, 0.042f), () => { var k = rows[idx].key; if (model != null && k.Length > 0) model.FanStep(k, -1); MarkDirty(); }, r.go.transform);
                Lbl(ref r.level, "Level", "FAN OFF", 0.02f, new Vector3(0.232f, y, 0), TextCol, TextAnchor.MiddleCenter, r.go.transform);
                r.plus = Btn("FanPlus", "+", new Vector3(0.3f, y, 0), new Vector2(0.04f, 0.042f), () => { var k = rows[idx].key; if (model != null && k.Length > 0) model.FanStep(k, +1); MarkDirty(); }, r.go.transform);
            }

            prev = Btn("Prev", "<", new Vector3(-0.2f, -0.315f, 0), new Vector2(0.07f, 0.04f), () => { if (model != null) model.PrevPage(); MarkDirty(); });
            Lbl(ref pageText, "Page", "Page 1/3", 0.022f, new Vector3(-0.03f, -0.315f, 0), TextCol, TextAnchor.MiddleCenter);
            next = Btn("Next", ">", new Vector3(0.14f, -0.315f, 0), new Vector2(0.07f, 0.04f), () => { if (model != null) model.NextPage(); MarkDirty(); });
            Lbl(ref energy, "Energy", "Simulated power: 0 W  (lights 0 W, fans 0 W)\nSimulated session total: 0.00 Wh", 0.04f, new Vector3(-0.30f, -0.375f, 0), Dim, TextAnchor.MiddleLeft);
            root.gameObject.SetActive(false);
        }

        Material Mat(Color baseCol, Color emission)
        {
            var m = SmartMaterials.MakeEmissive(baseCol, null);
            SmartMaterials.SetEmission(m, emission);
            owned.Add(m);
            return m;
        }

        void Lbl(ref TextMesh slot, string name, string text, float h, Vector3 pos, Color c, TextAnchor anchor, Transform parent = null)
        {
            var t = UiText.Create(parent != null ? parent : root, name, text, h, c, anchor);
            t.alignment = anchor == TextAnchor.MiddleLeft ? TextAlignment.Left : TextAlignment.Center;
            t.transform.localPosition = new Vector3(pos.x, pos.y, -0.004f);          // a hair in front of the backdrop (towards the viewer = -Z)
            slot = t;
        }

        PanelButton Btn(string name, string text, Vector3 pos, Vector2 size, Action click, Transform parent = null)
        {
            var go = new GameObject(name); go.transform.SetParent(parent != null ? parent : root, false);
            go.transform.localPosition = new Vector3(pos.x, pos.y, 0);
            var mf = go.AddComponent<MeshFilter>(); mf.sharedMesh = ProceduralMesh.Box(new Vector3(size.x, size.y, 0.008f));
            var mr = go.AddComponent<MeshRenderer>(); mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; mr.receiveShadows = false;
            go.transform.localPosition = new Vector3(pos.x, pos.y, -0.004f);
            var col = go.AddComponent<BoxCollider>(); col.size = new Vector3(size.x + 0.01f, size.y + 0.008f, 0.05f); col.center = new Vector3(0, 0, -0.02f);
            var b = go.AddComponent<PanelButton>();
            b.rend = mr; b.normal = mNormal; b.lit = mLit; b.hover = mHover; b.label = text; b.onClick = click;
            var t = UiText.Create(go.transform, "Text", text, Mathf.Min(0.026f, size.y * 0.55f), Color.white);
            t.transform.localPosition = new Vector3(0, 0, -0.006f);
            b.text = t;
            b.Init();
            return b;
        }

        // ---- binding -------------------------------------------------------------------------------------------------------------------------
        public void Attach(SmartHouseController c)
        {
            Build();
            Unbind();
            ctrl = c; state = c != null ? c.State : null;
            if (state == null) return;
            model = new PanelModel(state, c.VoiceStatus) { ShowEnergy = c.config == null || c.config.showEnergy };
            state.Lights.Changed += OnLight;
            state.FanLevelChanged += OnFan;
            if (energy != null) energy.gameObject.SetActive(model.ShowEnergy);
            dirty = true;
            Redraw();
        }

        void Unbind()
        {
            if (state != null) { state.Lights.Changed -= OnLight; state.FanLevelChanged -= OnFan; }
            state = null; model = null;
        }

        void OnLight(string key, bool on, ControlSource src) { dirty = true; }
        void OnFan(string key, int level, ControlSource src) { dirty = true; }
        void MarkDirty() { dirty = true; Redraw(); }

        void OnDisable() { Unbind(); }
        void OnDestroy() { Unbind(); foreach (var m in owned) if (m != null) Destroy(m); }

        // ---- show / hide / place ---------------------------------------------------------------------------------------------------------------
        public void Show() { Build(); root.gameObject.SetActive(true); if (!placed) PlaceInFrontOfPlayer(); dirty = true; }
        public void Hide() { if (root != null) root.gameObject.SetActive(false); }

        /// <summary>Stand the panel in front of the player at a comfortable height, facing them.  Works from the controller's own anchor when one is set.</summary>
        public void PlaceInFrontOfPlayer()
        {
            Build();
            if (ctrl != null && ctrl.panelAnchor != null) { transform.SetPositionAndRotation(ctrl.panelAnchor.position, ctrl.panelAnchor.rotation); placed = true; return; }
            var cam = Camera.main; if (cam == null) return;
            var f = cam.transform.forward; f.y = 0f; if (f.sqrMagnitude < 1e-4f) f = Vector3.forward; f.Normalize();
            transform.position = cam.transform.position + f * distance + Vector3.down * belowEyes;
            transform.rotation = Quaternion.LookRotation(f);                  // +Z away from the viewer: the text (which faces -Z) reads towards them
            placed = true;
        }

        // ---- per frame -----------------------------------------------------------------------------------------------------------------------
        void Update()
        {
            if (!built) return;
            // left controller secondary (Y): bring the panel back in front of me
            var dev = InputDevices.GetDeviceAtXRNode(recallHand);
            bool v = false;
            if (dev.isValid) dev.TryGetFeatureValue(CommonUsages.secondaryButton, out v);
            if (v && !recallWas) { PlaceInFrontOfPlayer(); Show(); }
            recallWas = v;

            if (!Visible || model == null) return;
            if (!placed) PlaceInFrontOfPlayer();
            RedrawVoiceLine();                                       // every frame: the status changes in fractions of a second
            if (dirty || Time.unscaledTime >= nextRefresh) { nextRefresh = Time.unscaledTime + 0.25f; Redraw(); }
        }

        void RedrawVoiceLine()
        {
            var board = model.Voice;
            string head = board.Headline, detail = board.Detail;
            if (voiceHead.text != head) { voiceHead.text = head; voiceHead.color = ToneColor(board.Tone); }
            if (voiceDetail.text != detail) { voiceDetail.text = detail; }
            voiceDetail.color = board.Tone == Tone.Bad ? Bad : Dim;
            voiceHead.color = ToneColor(board.Tone);
        }

        void Redraw()
        {
            if (model == null || !built) return;
            dirty = false;
            RedrawVoiceLine();
            lightsLine.text = model.LightsSummary; fanLine.text = model.FanSummary; autoLine.text = model.AutoText;
            allOn.SetLit(state.Lights.OnCount == state.Lights.Rooms.Count && state.Lights.Rooms.Count > 0);
            allOff.SetLit(state.Lights.OnCount == 0);
            auto.SetLit(state.Auto.Enabled); auto.text.text = state.Auto.Enabled ? "AUTO LIGHTS: ON" : "AUTO LIGHTS: OFF";
            pageText.text = model.PageText;
            prev.SetLit(false); next.SetLit(false);
            if (energy != null && model.ShowEnergy) energy.text = model.EnergyText;

            var list = model.Rows();
            for (int i = 0; i < rows.Length; i++)
            {
                var r = rows[i];
                bool used = i < list.Count;
                r.go.SetActive(used);
                if (!used) { r.key = ""; continue; }
                var d = list[i];
                r.key = d.Key;
                r.name.text = d.Name;
                r.light.SetLit(d.LightOn);
                r.light.text.text = d.LightOn ? "ON" : "OFF";
                r.minus.gameObject.SetActive(d.HasFan); r.plus.gameObject.SetActive(d.HasFan); r.level.gameObject.SetActive(d.HasFan);
                if (d.HasFan) r.level.text = d.FanLevel == 0 ? "FAN OFF" : "FAN " + d.FanLevel;
            }
        }

        static Color ToneColor(Tone t) { return t == Tone.Good ? Good : t == Tone.Warn ? Warn : t == Tone.Bad ? Bad : Dim; }

        // ---- test helpers (also handy for debugging in the editor) -------------------------------------------------------------------------------
        public PanelButton ButtonOf(string name)
        {
            foreach (var b in GetComponentsInChildren<PanelButton>(true)) if (b.gameObject.name == name) return b;
            return null;
        }

        public PanelButton RowButton(int row, string name)
        {
            foreach (var b in rows[row].go.GetComponentsInChildren<PanelButton>(true)) if (b.gameObject.name == name) return b;
            return null;
        }

        public string RowName(int row) { return rows[row].name.text; }
        public string RowKey(int row) { return rows[row].key; }
        public string RowLevelText(int row) { return rows[row].level.text; }
        public string VoiceHeadline { get { return voiceHead.text; } }
        public string EnergyLabel { get { return energy != null ? energy.text : ""; } }
        public string PageLabel { get { return pageText.text; } }
        public void RedrawNow() { dirty = true; Redraw(); }
    }
}
