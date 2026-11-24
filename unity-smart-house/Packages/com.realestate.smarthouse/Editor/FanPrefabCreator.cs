// Real Estate > Smart House > Create ceiling fan prefab.  The fan is built from code at run time, so a prefab saved from a running scene would lose its
// meshes; this builds one in the editor and saves the meshes, materials and wood texture as assets next to the prefab, so it can be dragged into any scene.
using System.IO;
using UnityEditor;
using UnityEngine;

namespace RealEstate.SmartHouse.Editor
{
    public static class FanPrefabCreator
    {
        const string Folder = "Assets/SmartHouse/Prefabs";

        [MenuItem("Real Estate/Smart House/Create ceiling fan prefab")]
        public static void Create()
        {
            if (!AssetDatabase.IsValidFolder("Assets/SmartHouse")) AssetDatabase.CreateFolder("Assets", "SmartHouse");
            if (!AssetDatabase.IsValidFolder(Folder)) AssetDatabase.CreateFolder("Assets/SmartHouse", "Prefabs");

            // 0.6 m blade radius = a 48 in. fan; 0.25 m down-rod
            var built = CeilingFanBuilder.Build(null, "CeilingFan", 0.6f, 0.25f, 5, null);
            var view = built.Root.AddComponent<CeilingFanView>();
            view.bladeAssembly = built.BladeAssembly;
            view.autoBind = true;                       // bind to the scene's SmartHouseController by roomKey

            int n = 0;
            foreach (var mf in built.Root.GetComponentsInChildren<MeshFilter>(true))
            {
                if (mf.sharedMesh == null) continue;
                AssetDatabase.CreateAsset(mf.sharedMesh, Folder + "/CeilingFan_mesh_" + (n++) + ".asset");
            }
            int m = 0;
            foreach (var r in built.Root.GetComponentsInChildren<Renderer>(true))
            {
                var mat = r.sharedMaterial;
                if (mat == null || AssetDatabase.GetAssetPath(mat).Length > 0) continue;
                foreach (var prop in new[] { "_BaseMap", "_MainTex" })
                {
                    var t = mat.HasProperty(prop) ? mat.GetTexture(prop) as Texture2D : null;
                    if (t != null && AssetDatabase.GetAssetPath(t).Length == 0) AssetDatabase.CreateAsset(t, Folder + "/CeilingFan_tex_" + (m) + ".asset");
                }
                AssetDatabase.CreateAsset(mat, Folder + "/CeilingFan_mat_" + (m++) + ".asset");
            }
            var prefab = PrefabUtility.SaveAsPrefabAsset(built.Root, Folder + "/CeilingFan.prefab");
            Object.DestroyImmediate(built.Root);
            AssetDatabase.SaveAssets();
            Selection.activeObject = prefab;
            Debug.Log("[SmartHouse] Created " + Folder + "/CeilingFan.prefab. Set its roomKey on the CeilingFanView (e.g. 0:living_room, as in the data file) and keep Auto Bind on.");
        }
    }
}
