using RealEstate.SmartHouse.Core;
using UnityEngine;

namespace RealEstate.SmartHouse
{
    /// <summary>All tunable values of the smart house in one asset (Assets > Create > Real Estate > Smart House Config).</summary>
    [CreateAssetMenu(fileName = "SmartHouseConfig", menuName = "Real Estate/Smart House Config")]
    public sealed class SmartHouseConfig : ScriptableObject
    {
        [Header("Ceiling fan")]
        public FanSpec fan = new FanSpec();
        [Range(3, 6)] public int blades = 5;
        [Tooltip("+1 turns counter-clockwise seen from below, -1 clockwise.")] public float spinDirection = 1f;
        public bool addFans = true;

        [Header("Lights")]
        public Color lightColor = new Color(1f, 0.86f, 0.68f);
        [Tooltip("Point-light intensity when ON (URP: ~1-3; HDRP: use lumens).")] public float onIntensity = 1.6f;
        public float fadeSeconds = 0.18f;
        [Tooltip("Real-time lights allowed to be ON at once (the nearest to the head); other lit rooms keep their glowing fixture only. 4 suits Quest URP.")]
        public int maxRealtimeLights = 4;
        [Tooltip("Scales the range taken from the room size.")] public float rangeScale = 1f;
        [Tooltip("None is the Quest-friendly choice, but light then also passes through walls into neighbouring rooms (documented limitation).")] public LightShadows shadows = LightShadows.None;

        [Header("Wall controls")]
        [Tooltip("Pull the plates this far (m) out of the wall surface so they never z-fight with it.")] public float plateOffsetM = 0.002f;
        [Tooltip("Largest allowed distance (m) from the switch to the player for a ray hit.")] public float maxRayDistanceM = 4f;
        public bool showLabels = true;

        [Header("Model placement")]
        [Tooltip("Scale the imported .glb (feet) to metres.")] public bool applyFeetToMetres = true;
        public MirrorChoice mirror = MirrorChoice.Auto;

        [Header("Materials (optional; empty = created from the project's Lit shader)")]
        public Material woodMaterial;
        public Material metalMaterial;
        public Material plateMaterial;
        public Material fixtureMaterial;

        [Header("Control panel")]
        public bool showControlPanel = true;
        [Tooltip("Show the simulated energy read-out on the panel.")] public bool showEnergy = true;

        [Header("Automatic lighting (optional motion-sensor simulation)")]
        [Tooltip("Start with automatic lighting ON. Default OFF: it is an optional feature.")] public bool autoLightsOnStart = false;
        [Tooltip("Seconds a room must stay empty before its automatic light switches off.")] public float autoVacancySeconds = 30f;

        [Header("Simulated energy (NOT measured: assumed typical values)")]
        public EnergySpec energy = new EnergySpec();

        [Header("Voice")]
        public string language = "en-US";
        public bool preferOffline = true;
        public bool showTranscript = true;
    }

    public enum MirrorChoice { Auto, X, Z }
}
