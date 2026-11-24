// Editor helper: Real Estate > Smart House > Setup.  Adds/updates the SmartHouseController in the open scene, creates the config asset, and runs a
// short project check for the things that most often go wrong on a headset build.  Everything it does can also be done by hand (see the README).
using System.IO;
using UnityEditor;
using UnityEngine;

namespace RealEstate.SmartHouse.Editor
{
    public sealed class SmartHouseSetupWindow : EditorWindow
    {
        GameObject houseRoot;
        TextAsset sidecar;
        SmartHouseConfig config;
        Vector2 scroll;
        string report = "";

        [MenuItem("Real Estate/Smart House/Setup")]
        static void Open() { GetWindow<SmartHouseSetupWindow>("Smart House"); }

        void OnGUI()
        {
            scroll = EditorGUILayout.BeginScrollView(scroll);
            EditorGUILayout.LabelField("1. The house", EditorStyles.boldLabel);
            houseRoot = (GameObject)EditorGUILayout.ObjectField("House root (scene object)", houseRoot, typeof(GameObject), true);
            sidecar = (TextAsset)EditorGUILayout.ObjectField("Data file (.smarthouse.json)", sidecar, typeof(TextAsset), false);
            EditorGUILayout.HelpBox("House root = the imported .glb as it sits in the scene (glTFast prefab). No .glb yet? Use 'Try the demo house' below.", MessageType.None);

            EditorGUILayout.LabelField("2. Settings", EditorStyles.boldLabel);
            config = (SmartHouseConfig)EditorGUILayout.ObjectField("Config", config, typeof(SmartHouseConfig), false);
            if (config == null && GUILayout.Button("Create config asset")) config = CreateConfig();

            EditorGUILayout.LabelField("3. Add to the scene", EditorStyles.boldLabel);
            using (new EditorGUI.DisabledScope(houseRoot == null || sidecar == null))
                if (GUILayout.Button("Add / update SmartHouseController")) Apply(false);
            using (new EditorGUI.DisabledScope(sidecar == null))
                if (GUILayout.Button("Try the demo house (stand-in model built from the data file)")) Apply(true);

            EditorGUILayout.LabelField("4. Check the project", EditorStyles.boldLabel);
            if (GUILayout.Button("Run checks")) report = Checks();
            if (GUILayout.Button("Add the Lit shader to Always Included Shaders")) report = AddLitShader();
            if (report.Length > 0) EditorGUILayout.HelpBox(report, MessageType.Info);
            EditorGUILayout.EndScrollView();
        }

        static SmartHouseConfig CreateConfig()
        {
            if (!AssetDatabase.IsValidFolder("Assets/SmartHouse")) AssetDatabase.CreateFolder("Assets", "SmartHouse");
            var c = ScriptableObject.CreateInstance<SmartHouseConfig>();
            AssetDatabase.CreateAsset(c, "Assets/SmartHouse/SmartHouseConfig.asset");
            AssetDatabase.SaveAssets();
            return c;
        }

        void Apply(bool demo)
        {
            if (config == null) config = CreateConfig();
            var ctl = Object.FindObjectOfType<SmartHouseController>();
            GameObject go;
            if (ctl != null) go = ctl.gameObject;
            else
            {
                go = new GameObject("SmartHouse");
                Undo.RegisterCreatedObjectUndo(go, "Add SmartHouse");
                ctl = Undo.AddComponent<SmartHouseController>(go);
            }
            Undo.RecordObject(ctl, "Configure SmartHouse");
            ctl.config = config; ctl.sidecar = sidecar;
            if (demo)
            {
                var d = go.GetComponent<DemoHouseBuilder>() ?? Undo.AddComponent<DemoHouseBuilder>(go);
                d.sidecar = sidecar; ctl.houseRoot = null;
            }
            else ctl.houseRoot = houseRoot.transform;
            EditorUtility.SetDirty(ctl);
            Selection.activeGameObject = go;
            report = demo ? "Demo house added. Press Play: type commands in the 'Smart House' panel." : "SmartHouseController configured. Press Play.";
        }

        static string Checks()
        {
            var sb = new System.Text.StringBuilder();
            sb.AppendLine(Shader.Find("Universal Render Pipeline/Lit") != null ? "OK  URP Lit shader found" : (Shader.Find("Standard") != null ? "OK  Built-in Standard shader found" : "!!  No Lit shader found: assign materials in the config"));
            sb.AppendLine(LitIsAlwaysIncluded() ? "OK  Lit shader is in Always Included Shaders" : "!!  Lit shader is NOT in Always Included Shaders: a device build may show pink/white generated objects. Use the button below.");
            sb.AppendLine(EditorUserBuildSettings.activeBuildTarget == BuildTarget.Android ? "OK  Build target is Android (Quest)" : "..  Build target is " + EditorUserBuildSettings.activeBuildTarget + ": switch to Android for a Quest build");
            string manifest = "Assets/Plugins/Android/AndroidManifest.xml";
            if (File.Exists(manifest)) sb.AppendLine(File.ReadAllText(manifest).Contains("RECORD_AUDIO") ? "OK  AndroidManifest declares RECORD_AUDIO" : "!!  AndroidManifest has no RECORD_AUDIO: copy the sample (Package Manager > Samples)");
            else sb.AppendLine("..  No custom AndroidManifest: voice needs RECORD_AUDIO declared; copy the sample from Package Manager > Samples");
            sb.AppendLine(Camera.main != null ? "OK  A MainCamera exists (the head; used for room detection and the toast)" : "!!  No camera tagged MainCamera: room detection and the confirmation toast need it");
            return sb.ToString();
        }

        static Shader LitShader()
        {
            return Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("HDRP/Lit") ?? Shader.Find("Standard");
        }

        static SerializedObject GraphicsSettingsObject()
        {
            var all = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/GraphicsSettings.asset");
            return all != null && all.Length > 0 ? new SerializedObject(all[0]) : null;
        }

        static bool LitIsAlwaysIncluded()
        {
            var so = GraphicsSettingsObject(); var lit = LitShader();
            if (so == null || lit == null) return false;
            var arr = so.FindProperty("m_AlwaysIncludedShaders");
            for (int i = 0; arr != null && i < arr.arraySize; i++) if (arr.GetArrayElementAtIndex(i).objectReferenceValue == lit) return true;
            return false;
        }

        static string AddLitShader()
        {
            var so = GraphicsSettingsObject(); var lit = LitShader();
            if (so == null || lit == null) return "Could not open Graphics settings or find a Lit shader. Add it by hand: Project Settings > Graphics > Always Included Shaders.";
            if (LitIsAlwaysIncluded()) return "Already included.";
            var arr = so.FindProperty("m_AlwaysIncludedShaders");
            arr.InsertArrayElementAtIndex(arr.arraySize);
            arr.GetArrayElementAtIndex(arr.arraySize - 1).objectReferenceValue = lit;
            so.ApplyModifiedProperties();
            AssetDatabase.SaveAssets();
            return "Added " + lit.name + " to Always Included Shaders.";
        }
    }
}
