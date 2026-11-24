using UnityEngine;
using UnityEngine.XR;

namespace RealEstate.SmartHouse
{
    /// <summary>
    /// Points a ray from a VR controller (or the mouse in the editor) at wall switches and regulator pads; the trigger presses what the ray hits.
    /// No XR Interaction Toolkit is needed: the controller pose and trigger are read from <see cref="InputDevices"/>.  If the project already has a
    /// rig whose controller transforms are tracked (XRI, Meta XR "OVRCameraRig" anchors, ...), assign <see cref="rayOrigin"/> and the pose is taken from it.
    /// </summary>
    public sealed class SmartRayInteractor : MonoBehaviour
    {
        public enum Source { RightController, LeftController, Mouse }

        public Source source = Source.RightController;
        [Tooltip("Optional: a transform that is already tracked to the controller (its forward is the ray).")] public Transform rayOrigin;
        [Tooltip("Parent of the tracked devices (the XR origin / tracking space).  Empty = the main camera's parent, or the world.")] public Transform trackingSpace;
        public float maxDistance = 4f;
        public LayerMask mask = ~0;
        public bool drawRay = true;
        [Tooltip("Pitch (deg, down) added to the controller's grip pose when no rayOrigin is given. Grip poses point along the handle; ~30-40 matches how a Touch controller is aimed. Tune on the device.")]
        public float aimPitchDeg = 30f;

        LineRenderer line;
        ISmartInteractable hover;
        bool triggerWas;

        /// <summary>The thing the ray points at right now (for tests / HUD).</summary>
        public ISmartInteractable Hover { get { return hover; } }

        XRNode Node { get { return source == Source.LeftController ? XRNode.LeftHand : XRNode.RightHand; } }

        void Awake()
        {
            if (drawRay && source != Source.Mouse)
            {
                line = gameObject.AddComponent<LineRenderer>();
                line.positionCount = 2; line.widthMultiplier = 0.004f; line.useWorldSpace = true;
                line.sharedMaterial = SmartMaterials.MakeEmissive(new Color(0.4f, 0.8f, 1f));
                SmartMaterials.SetEmission(line.sharedMaterial, new Color(0.4f, 0.8f, 1f) * 2f);
                line.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                line.enabled = false;
            }
        }

        bool TryGetRay(out Ray ray)
        {
            ray = default(Ray);
            if (source == Source.Mouse)
            {
                var cam = Camera.main;
                if (cam == null) return false;
#if ENABLE_LEGACY_INPUT_MANAGER
                ray = cam.ScreenPointToRay(Input.mousePosition);
                return true;
#else
                return false;       // new Input System only: use the typed-command panel or the VR controllers
#endif
            }
            if (rayOrigin != null) { ray = new Ray(rayOrigin.position, rayOrigin.forward); return true; }
            var dev = InputDevices.GetDeviceAtXRNode(Node);
            Vector3 p; Quaternion q;
            if (!dev.isValid || !dev.TryGetFeatureValue(CommonUsages.devicePosition, out p) || !dev.TryGetFeatureValue(CommonUsages.deviceRotation, out q)) return false;
            var space = trackingSpace;
            if (space == null && Camera.main != null) space = Camera.main.transform.parent;
            if (space != null) { p = space.TransformPoint(p); q = space.rotation * q; }
            // the grip pose points along the handle: tilt it down by aimPitchDeg so the ray follows how a held controller is aimed
            ray = new Ray(p, q * Quaternion.Euler(aimPitchDeg, 0f, 0f) * Vector3.forward);
            return true;
        }

        bool TriggerPressed()
        {
            if (source == Source.Mouse)
            {
#if ENABLE_LEGACY_INPUT_MANAGER
                return Input.GetMouseButton(0);
#else
                return false;
#endif
            }
            var dev = InputDevices.GetDeviceAtXRNode(Node);
            bool v;
            return dev.isValid && dev.TryGetFeatureValue(CommonUsages.triggerButton, out v) && v;
        }

        void Update()
        {
            Ray ray;
            ISmartInteractable hit = null;
            Vector3 end = Vector3.zero;
            bool haveRay = TryGetRay(out ray);
            if (haveRay)
            {
                RaycastHit rh;
                if (Physics.Raycast(ray, out rh, maxDistance, mask, QueryTriggerInteraction.Collide))
                {
                    hit = rh.collider.GetComponentInParent<ISmartInteractable>();
                    end = rh.point;
                }
                else end = ray.origin + ray.direction * Mathf.Min(maxDistance, 2f);
            }
            if (line != null)
            {
                line.enabled = haveRay;
                if (haveRay) { line.SetPosition(0, ray.origin); line.SetPosition(1, end); }
            }

            if (!ReferenceEquals(hit, hover))
            {
                if (hover != null && !IsDestroyed(hover)) hover.SetHover(false);
                hover = hit;
                if (hover != null) { hover.SetHover(true); Haptic(0.12f, 0.02f); }
            }

            bool trig = haveRay && TriggerPressed();
            if (trig && !triggerWas && hover != null)
            {
                hover.Activate();
                Haptic(0.45f, 0.06f);
            }
            triggerWas = trig;
        }

        static bool IsDestroyed(ISmartInteractable i) { var o = i as Object; return o != null ? !o : false; }

        void Haptic(float amplitude, float seconds)
        {
            if (source == Source.Mouse) return;
            var dev = InputDevices.GetDeviceAtXRNode(Node);
            HapticCapabilities cap;
            if (dev.isValid && dev.TryGetHapticCapabilities(out cap) && cap.supportsImpulse) dev.SendHapticImpulse(0, amplitude, seconds);
        }

        void OnDisable()
        {
            if (hover != null && !IsDestroyed(hover)) hover.SetHover(false);
            hover = null; triggerWas = false;
        }
    }
}
