using System;
using System.Collections.Generic;
using RealEstate.SmartHouse.Core;
using RealEstate.SmartHouse.Voice;
using UnityEngine;

namespace RealEstate.SmartHouse
{
    /// <summary>
    /// The one scene component that runs the smart house: it owns the <see cref="SmartHouseState"/>, builds the lights/fans/switches on the imported
    /// model (<see cref="HouseBinder"/>), ticks the fans, works out which room the player is in, limits the real-time lights, and connects voice.
    /// Only one may exist: a second instance logs a warning and removes itself, so voice commands can never be handled twice.
    /// </summary>
    [DisallowMultipleComponent, DefaultExecutionOrder(-50)]
    public sealed class SmartHouseController : MonoBehaviour
    {
        public static SmartHouseController Instance { get; private set; }

        [Header("Data")]
        public SmartHouseConfig config;
        [Tooltip("The .smarthouse.json exported next to the .glb (Download 3D model / Smart-house data).")] public TextAsset sidecar;
        [Tooltip("Root of the imported house model (the glTFast GameObject).  Never rotated or animated by this package.")] public Transform houseRoot;
        public bool bindOnStart = true;

        [Header("Voice")]
        [Tooltip("Empty = on Android an AndroidSpeechBackend is created.  Assign an ExternalTranscriptBackend to use the Meta Voice SDK.")] public VoiceBackendBase voiceBackend;
        public bool startListeningOnStart = true;

        [Header("Extras")]
        public bool createRayInteractors = true;
        public bool showToast = true;
        public bool showDebugConsole = true;
        [Tooltip("Where the control panel stands (optional). Empty: in front of the player at start; the left controller's X button recalls it.")] public Transform panelAnchor;

        public SmartHouseState State { get; private set; }
        public SmartHouseDocument Document { get; private set; }
        public VoiceCommandRouter Router { get; private set; }
        public BindResult Bound { get; private set; }
        public string CurrentRoomKey { get { return State != null ? State.CurrentRoomKey : null; } }
        /// <summary>What the voice pipeline is doing (Listening / recognized / completed / not understood / microphone unavailable) for the panel.</summary>
        public readonly VoiceStatusBoard VoiceStatus = new VoiceStatusBoard();
        public SmartControlPanel Panel { get; private set; }

        /// <summary>(heard text, result) after every executed command.</summary>
        public event Action<string, CommandResult> CommandHandled;
        /// <summary>Raised after (re)binding, with the result (warnings etc.).</summary>
        public event Action<BindResult> Rebound;

        RoomLocator locator;
        float nextLocate;
        Camera head;
        bool listeningStarted;
        VoiceBackendBase attachedBackend;
        readonly List<RoomLightView> lit = new List<RoomLightView>();

        void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Debug.LogWarning("[SmartHouse] A second SmartHouseController was found on '" + name + "' and is being removed; only one may run (it owns the voice listener).");
                Destroy(this);
                return;
            }
            Instance = this;
            if (config == null) { config = ScriptableObject.CreateInstance<SmartHouseConfig>(); config.name = "SmartHouseConfig (defaults)"; }
        }

        void Start()
        {
            if (Instance != this) return;
            if (createRayInteractors) EnsureInteractors();
            if (showToast) EnsureToast();
            if (config.showControlPanel) EnsurePanel();
            if (showDebugConsole && Compat.First<SmartDebugConsole>() == null) gameObject.AddComponent<SmartDebugConsole>();
            var demo = GetComponent<DemoHouseBuilder>();
            if (houseRoot == null && demo != null && demo.sidecar != null)
            {
                houseRoot = demo.Build();
                if (sidecar == null) sidecar = demo.sidecar;
            }
            if (bindOnStart) Rebind();
        }

        void OnDestroy()
        {
            if (Instance != this) return;
            Instance = null;
            DetachBackend();
            if (Panel != null) Destroy(Panel.gameObject);
            if (Bound != null && Bound.Container != null) Destroy(Bound.Container.gameObject);
        }

        // ---- binding -----------------------------------------------------------------------------------------------------------------------------
        /// <summary>(Re)build everything from <see cref="sidecar"/> and <see cref="houseRoot"/>.  Safe to call again (for example after the model finished loading).</summary>
        public BindResult Rebind()
        {
            if (Instance != this) return null;
            if (houseRoot == null)
            {
                Debug.LogError("[SmartHouse] Assign 'House Root' (the imported house model) on the SmartHouseController.");
                return null;
            }
            var spec = config.fan ?? new FanSpec();
            string problem = null;
            try { spec.Validate(); } catch (Exception e) { problem = "Fan settings invalid: " + e.Message + " - using defaults."; spec = new FanSpec(); }

            Document = null; locator = null;
            if (sidecar != null && !string.IsNullOrEmpty(sidecar.text))
            {
                try { Document = SmartHouseDocument.FromJson(sidecar.text); }
                catch (Exception e) { problem = "Could not read the smart-house data: " + e.Message; }
            }
            else problem = "No smart-house data assigned";

            DetachBackend();
            if (Document != null && Document.Rooms.Count > 0) { State = SmartHouseState.FromDocument(Document, spec); locator = new RoomLocator(Document); }
            else { State = SmartHouseState.Master(spec); Document = Document ?? new SmartHouseDocument(); }

            try { var es = config.energy ?? new EnergySpec(); es.Validate(); State.Energy.Spec = es; }
            catch (Exception e) { problem = (problem != null ? problem + " | " : "") + "Energy settings invalid: " + e.Message + " - using defaults."; }
            State.Auto.VacancyDelaySeconds = Mathf.Max(0f, config.autoVacancySeconds);
            if (config.autoLightsOnStart) State.Auto.SetEnabled(true);

            Router = new VoiceCommandRouter(State);
            Router.Executed += OnExecuted;
            Router.Heard += OnHeard;

            Bound = HouseBinder.Bind(houseRoot, Document, State, config, Bound != null ? Bound.Container : null);
            if (problem != null) Bound.Warnings.Insert(0, problem);
            foreach (var w in Bound.Warnings) Debug.LogWarning("[SmartHouse] " + w);
            Debug.Log("[SmartHouse] " + (State.Lights.IsMaster ? "master light" : Bound.Lights + " room lights") + ", " + Bound.Fans + " fans, " + Bound.Switches + " switches, " + Bound.Regulators + " regulators; mirror " + Bound.Axis);

            lit.Clear(); lit.AddRange(Bound.LightViews.Values);
            SetupVoice();
            if (Panel != null) Panel.Attach(this);
            var h = Rebound; if (h != null) h(Bound);
            return Bound;
        }

        /// <summary>Convenience for runtime loaders: set the model and data, then bind.</summary>
        public BindResult Bind(Transform root, TextAsset data) { houseRoot = root; sidecar = data; return Rebind(); }

        // ---- voice -------------------------------------------------------------------------------------------------------------------------------
        void SetupVoice()
        {
            var b = voiceBackend;
            if (b == null)
            {
#if UNITY_ANDROID && !UNITY_EDITOR
                b = GetComponent<AndroidSpeechBackend>() ?? gameObject.AddComponent<AndroidSpeechBackend>();
                ((AndroidSpeechBackend)b).language = config.language; ((AndroidSpeechBackend)b).preferOffline = config.preferOffline;
#endif
            }
            VoiceStatus.SetBackend(b != null);
            if (b != null)
            {
                b.StateChanged += OnBackendState; VoiceStatus.OnBackendState(b.State, b.StateDetail);
                Router.Attach(b); attachedBackend = b;
                if (startListeningOnStart && !listeningStarted) { listeningStarted = true; b.StartListening(); }
            }
        }

        void DetachBackend()
        {
            if (Router != null) { Router.Executed -= OnExecuted; Router.Heard -= OnHeard; Router.Detach(); }
            if (attachedBackend != null) attachedBackend.StateChanged -= OnBackendState;
            attachedBackend = null;
        }

        void OnBackendState(VoiceState s, string detail) { VoiceStatus.OnBackendState(s, detail); }
        void OnHeard(string partial) { VoiceStatus.OnPartial(partial); }

        public VoiceBackendBase ActiveBackend { get { return attachedBackend; } }

        void OnExecuted(string heard, CommandResult res)
        {
            VoiceStatus.OnCommand(heard, res);
            if (res != null && res.Panel != PanelRequest.None && Panel != null)
            {
                if (res.Panel == PanelRequest.Show) { Panel.PlaceInFrontOfPlayer(); Panel.Show(); } else Panel.Hide();
            }
            var h = CommandHandled; if (h != null) h(heard, res);
        }

        /// <summary>Run a command as if it had been spoken ("turn on the living room light").  Used by the typed-command panel and tests.</summary>
        public CommandResult Say(string transcript) { return Router != null ? Router.Submit(transcript, false) : null; }

        // ---- per frame ----------------------------------------------------------------------------------------------------------------------------
        void Update()
        {
            if (State == null) return;
            VoiceStatus.Tick(Time.unscaledDeltaTime);
            State.Tick(Time.deltaTime);
            if (Time.unscaledTime >= nextLocate) { nextLocate = Time.unscaledTime + 0.2f; LocateAndBudget(); }
        }

        void LocateAndBudget()
        {
            if (head == null) head = Camera.main;
            if (head == null || Bound == null || Bound.Container == null) return;
            var local = Bound.Container.InverseTransformPoint(head.transform.position);
            if (locator != null)
            {
                double x, y, z; GltfSpace.FromUnity(Bound.Axis, local.x, local.y, local.z, out x, out y, out z);
                State.CurrentRoomKey = locator.Locate(x, y, z);
            }
            else State.CurrentRoomKey = State.Lights.IsMaster ? "master" : null;

            // real-time light budget: only the nearest N lit rooms keep their point light (the others keep their glowing fixture)
            int budget = Mathf.Max(0, config.maxRealtimeLights);
            var on = new List<RoomLightView>();
            foreach (var v in lit) if (v != null && (v.IsOn || v.Level > 0f)) on.Add(v);
            on.Sort((a, b) => (a.transform.position - head.transform.position).sqrMagnitude.CompareTo((b.transform.position - head.transform.position).sqrMagnitude));
            foreach (var v in lit) if (v != null) v.RealtimeAllowed = false;
            for (int i = 0; i < on.Count && i < budget; i++) on[i].RealtimeAllowed = true;
        }

        // ---- helpers --------------------------------------------------------------------------------------------------------------------------------
        SmartRayInteractor right, left, mouse;

        void EnsureInteractors()
        {
            if (right == null) right = Make("Ray_Right", SmartRayInteractor.Source.RightController);
            if (left == null) left = Make("Ray_Left", SmartRayInteractor.Source.LeftController);
            if (mouse == null && Application.isEditor) mouse = Make("Ray_Mouse", SmartRayInteractor.Source.Mouse);
        }

        SmartRayInteractor Make(string n, SmartRayInteractor.Source s)
        {
            foreach (var e in Compat.All<SmartRayInteractor>()) if (e.source == s) return e;       // never a second interactor for the same hand
            var go = new GameObject(n);
            go.transform.SetParent(transform, false);
            var r = go.AddComponent<SmartRayInteractor>();
            r.source = s; r.maxDistance = config.maxRayDistanceM;
            return r;
        }

        void EnsurePanel()
        {
            if (Panel != null) return;
            var go = new GameObject("SmartHouse_ControlPanel");     // scene root on purpose: the panel keeps its own world pose
            Panel = go.AddComponent<SmartControlPanel>();
            Panel.Show();
        }

        /// <summary>Use a simulated occupant (room key, or null = nobody) instead of the headset for the automatic lighting; pass useSimulated=false to go back to the headset.</summary>
        public void SetSimulatedOccupant(string roomKey, bool useSimulated = true)
        {
            if (State == null) return;
            State.Auto.UseSimulatedOccupant = useSimulated; State.Auto.SimulatedRoomKey = roomKey;
        }

        void EnsureToast()
        {
            var t = Compat.First<VoiceFeedbackToast>();
            if (t == null) { var go = new GameObject("SmartHouse_Toast"); go.transform.SetParent(transform, false); t = go.AddComponent<VoiceFeedbackToast>(); }
            t.Attach(this);
        }
    }
}
