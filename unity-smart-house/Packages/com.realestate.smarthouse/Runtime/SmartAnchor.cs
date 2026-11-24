using UnityEngine;

namespace RealEstate.SmartHouse
{
    /// <summary>
    /// Manual placement.  Put an empty GameObject in the scene where a control should be, add this component, and the binder builds the control there
    /// instead of at the position computed from the data file.  Use it when a model was edited after export, when a plan has no automatic position
    /// (see "notes" in the .smarthouse.json), or for a model that did not come from the generator.
    /// The anchor's +Z axis must point INTO THE ROOM (out of the wall), +Y up; its position is on the wall's room-side surface.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class SmartAnchor : MonoBehaviour
    {
        public enum Kind { WallSwitch, FanRegulator, CeilingFan, CeilingLight }
        public Kind kind = Kind.WallSwitch;
        [Tooltip("Room key as in the data file: \"<floor>:<room id>\" (e.g. 0:R1).  For a house without room data use \"master\".")]
        public string roomKey = "";
        [Tooltip("Ceiling fan only: blade radius (m) and down-rod length (m).")]
        public float bladeRadiusM = 0.6f, downRodM = 0.3f;

        void OnDrawGizmos()
        {
            Gizmos.color = kind == Kind.WallSwitch ? Color.green : kind == Kind.FanRegulator ? Color.yellow : Color.cyan;
            Gizmos.matrix = transform.localToWorldMatrix;
            Gizmos.DrawWireCube(new Vector3(0, 0, 0.01f), new Vector3(0.09f, 0.09f, 0.02f));
            Gizmos.DrawLine(Vector3.zero, new Vector3(0, 0, 0.2f));
        }
    }
}
