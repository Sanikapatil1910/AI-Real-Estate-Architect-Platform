using RealEstate.SmartHouse.Core;
using RealEstate.SmartHouse.Voice;
using UnityEngine;

namespace RealEstate.SmartHouse
{
    /// <summary>A small caption that follows the player's gaze and confirms what was heard and what happened ("Heard: “turn on the light”  →  Living room light ON").</summary>
    public sealed class VoiceFeedbackToast : MonoBehaviour
    {
        public float distance = 1.3f, drop = 0.32f, showSeconds = 3.2f, follow = 5f;
        TextMesh text; Renderer back;
        SmartHouseController ctrl; VoiceBackendBase backend;
        float hideAt; Material backMat;
        static readonly Color Good = new Color(0.65f, 1f, 0.7f), Bad = new Color(1f, 0.75f, 0.45f), Neutral = new Color(0.9f, 0.92f, 1f);

        void Awake()
        {
            var root = new GameObject("Caption"); root.transform.SetParent(transform, false);
            text = UiText.Create(root.transform, "Text", "", 0.045f, Neutral);
            var bg = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(bg.GetComponent<Collider>());
            bg.name = "Backdrop"; bg.transform.SetParent(root.transform, false);
            bg.transform.localPosition = new Vector3(0, 0, 0.004f); bg.transform.localScale = new Vector3(0.75f, 0.14f, 1f);
            // the root's +Z points away from the viewer; a Quad is visible from its -Z side, so it needs no rotation (a 180 deg turn would cull it)
            back = bg.GetComponent<Renderer>();
            backMat = new Material(SmartMaterials.Lit() ?? Shader.Find("Sprites/Default")) { name = "SH_ToastBack" };
            if (backMat.HasProperty("_BaseColor")) backMat.SetColor("_BaseColor", new Color(0.03f, 0.03f, 0.06f, 0.85f));
            if (backMat.HasProperty("_Color")) backMat.SetColor("_Color", new Color(0.03f, 0.03f, 0.06f, 0.85f));
            back.sharedMaterial = backMat; back.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            root.SetActive(false);
        }

        void OnDestroy() { Detach(); if (backMat != null) Destroy(backMat); }
        void OnDisable() { Detach(); }

        public void Attach(SmartHouseController c)
        {
            Detach();
            ctrl = c;
            if (ctrl != null) ctrl.CommandHandled += OnCommand;
            // the backend can change on Rebind; hook the current one
            Hook(ctrl != null ? ctrl.ActiveBackend : null);
            if (ctrl != null) ctrl.Rebound += OnBound;
        }

        void OnBound(BindResult r) { Hook(ctrl.ActiveBackend); }

        void Hook(VoiceBackendBase b)
        {
            if (ReferenceEquals(b, backend)) return;
            if (backend != null) backend.StateChanged -= OnVoiceState;
            backend = b;
            if (backend != null) { backend.StateChanged += OnVoiceState; OnVoiceState(backend.State, backend.StateDetail); }
        }

        void Detach()
        {
            if (ctrl != null) { ctrl.CommandHandled -= OnCommand; ctrl.Rebound -= OnBound; }
            if (backend != null) backend.StateChanged -= OnVoiceState;
            ctrl = null; backend = null;
        }

        void OnCommand(string heard, CommandResult r)
        {
            string line = "Heard: “" + (heard ?? "").Trim() + "”\n" + (r != null ? r.Message : "");
            Show(line, r != null && r.Understood ? Good : Bad);
        }

        void OnVoiceState(VoiceState s, string detail)
        {
            if (s == VoiceState.PermissionDenied || s == VoiceState.Unavailable || s == VoiceState.RequestingPermission || s == VoiceState.Error)
                Show("Voice: " + detail, Bad);
        }

        public void Show(string msg, Color c)
        {
            text.text = msg; text.color = c;
            hideAt = Time.unscaledTime + showSeconds;
            var root = text.transform.parent.gameObject;
            if (!root.activeSelf) { root.SetActive(true); Snap(); }
        }

        void Snap()
        {
            var cam = Camera.main; if (cam == null) return;
            var root = text.transform.parent;
            root.position = Target(cam); root.rotation = Quaternion.LookRotation(root.position - cam.transform.position);
        }

        Vector3 Target(Camera cam)
        {
            var f = cam.transform.forward; f.y = 0f; if (f.sqrMagnitude < 1e-4f) f = Vector3.forward; f.Normalize();     // keep it level: follow yaw, not pitch
            return cam.transform.position + f * distance + Vector3.down * drop;
        }

        void LateUpdate()
        {
            var root = text.transform.parent;
            if (!root.gameObject.activeSelf) return;
            if (Time.unscaledTime > hideAt) { root.gameObject.SetActive(false); return; }
            var cam = Camera.main; if (cam == null) return;
            root.position = Vector3.Lerp(root.position, Target(cam), 1f - Mathf.Exp(-follow * Time.unscaledDeltaTime));
            var look = root.position - cam.transform.position; look.y = 0;
            if (look.sqrMagnitude > 1e-6f) root.rotation = Quaternion.LookRotation(look);
        }
    }
}
