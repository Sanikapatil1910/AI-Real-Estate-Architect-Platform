// OPTIONAL SAMPLE (not compiled with the package). Loads a .glb at run time with glTFast and binds the smart house to it.
// NOT COMPILED OR RUN by the author: written against the glTFast 5/6 API (GltfImport.Load / InstantiateMainSceneAsync); check the signatures in the
// version you installed.  In the Editor you do not need this: glTFast imports .glb files dropped into Assets as prefabs - drag that prefab into the
// scene, assign it as "House Root" on the SmartHouseController, and assign the .smarthouse.json as "Sidecar".
#if SMARTHOUSE_GLTFAST
using System;
using System.Threading.Tasks;
using GLTFast;
using UnityEngine;

namespace RealEstate.SmartHouse.Samples
{
    public sealed class GlbRuntimeLoader : MonoBehaviour
    {
        [Tooltip("http(s):// or file:// URL of house-<n>.glb")] public string glbUrl = "";
        public TextAsset sidecar;
        public SmartHouseController controller;

        async void Start()
        {
            #if UNITY_2023_1_OR_NEWER
            if (controller == null) controller = FindFirstObjectByType<SmartHouseController>();
#else
            if (controller == null) controller = FindObjectOfType<SmartHouseController>();
#endif
            if (controller == null || string.IsNullOrEmpty(glbUrl) || sidecar == null) { Debug.LogError("[SmartHouse] GlbRuntimeLoader needs a controller, a URL and the sidecar"); return; }
            controller.bindOnStart = false;
            var gltf = new GltfImport();
            bool ok = await gltf.Load(glbUrl);
            if (!ok) { Debug.LogError("[SmartHouse] Could not load " + glbUrl); return; }
            var root = new GameObject("House (glb)").transform;
            ok = await gltf.InstantiateMainSceneAsync(root);
            if (!ok) { Debug.LogError("[SmartHouse] Could not instantiate " + glbUrl); return; }
            controller.Bind(root, sidecar);       // calibrates units + mirror from the loaded geometry, then builds lights/fans/switches
        }
    }
}
#endif
