using RealEstate.SmartHouse.Core;
using UnityEngine;

namespace RealEstate.SmartHouse
{
    /// <summary>
    /// Turns the BLADE ASSEMBLY of one fan to the angle its <see cref="FanModel"/> says.  The model is advanced once per frame by the controller
    /// (exact integration, so the speed does not depend on the frame rate); this view only applies the angle, and never touches the mount, the
    /// house or the root.  If a .glb already contains a fan, assign its separate blade node to <see cref="bladeAssembly"/>.
    /// </summary>
    public sealed class CeilingFanView : MonoBehaviour
    {
        public Transform bladeAssembly;
        public string roomKey = "";
        [Tooltip("+1 counter-clockwise seen from below, -1 clockwise")] public float direction = 1f;
        [Tooltip("The blades turn about this local axis of the blade assembly")] public Vector3 localAxis = Vector3.up;

        [Tooltip("For a fan prefab placed by hand: bind to the scene's SmartHouseController by roomKey (and follow its Rebind).  Fans the controller builds are bound by it directly.")]
        public bool autoBind;

        SmartHouseState state;
        Quaternion baseRotation = Quaternion.identity;

        /// <summary>Last angular speed applied (deg/s), for the regulator read-out and tests.</summary>
        public float AppliedDegPerSec { get; private set; }

        public void Bind(SmartHouseState s, string key)
        {
            state = s; roomKey = key;
            if (bladeAssembly != null) baseRotation = bladeAssembly.localRotation;
        }

        void LateUpdate()
        {
            if (autoBind)
            {
                var c = SmartHouseController.Instance;
                var st = c != null ? c.State : null;
                if (st != null && !ReferenceEquals(st, state)) { if (st.Fan(roomKey) != null) Bind(st, roomKey); else state = null; }
            }
            if (state == null || bladeAssembly == null) return;
            var m = state.Fan(roomKey);
            if (m == null) return;
            AppliedDegPerSec = (float)m.VelocityDegPerSec;
            bladeAssembly.localRotation = baseRotation * Quaternion.AngleAxis((float)m.AngleDeg * (direction >= 0 ? 1f : -1f), localAxis.normalized);
        }
    }
}
