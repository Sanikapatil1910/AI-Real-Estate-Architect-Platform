using UnityEngine;

namespace RealEstate.SmartHouse
{
    /// <summary>Unity 2023.1+ deprecates FindObjectOfType; this picks the right call for the editor version in use.</summary>
    static class Compat
    {
        public static T First<T>() where T : Object
        {
#if UNITY_2023_1_OR_NEWER
            return Object.FindFirstObjectByType<T>();
#else
            return Object.FindObjectOfType<T>();
#endif
        }

        public static T[] All<T>() where T : Object
        {
#if UNITY_2023_1_OR_NEWER
            return Object.FindObjectsByType<T>(FindObjectsSortMode.None);
#else
            return Object.FindObjectsOfType<T>();
#endif
        }
    }
}
