using System;
using System.Collections;
namespace UnityEngine.TestTools { [AttributeUsage(AttributeTargets.All)] public class UnityTestAttribute : Attribute { } [AttributeUsage(AttributeTargets.All)] public class UnitySetUpAttribute : Attribute { } }
namespace NUnit.Framework
{
    [AttributeUsage(AttributeTargets.All)] public class TestCaseSourceAttribute : Attribute { public TestCaseSourceAttribute(string s) { } }
    [AttributeUsage(AttributeTargets.All)] public class TearDownAttribute : Attribute { }
    public static class StringAssert { public static void Contains(string a, string b, string m = "") { } }
    public static class Assert
    {
        public static void NotNull(object o, string m = "") { } public static void IsTrue(bool b, string m = "") { } public static void IsFalse(bool b, string m = "") { }
        public static void AreEqual(object a, object b, string m = "") { } public static void AreEqual(float a, float b, float d, string m = "") { }
        public static void Greater(float a, float b, string m = "") { } public static void Greater(int a, int b, string m = "") { } public static void Less(float a, float b, string m = "") { }
        public static void AreEqual(double a, double b, double d, string m = "") { }
        public static void IsEmpty(System.Collections.IEnumerable e, string m = "") { }
    }
}
namespace UnityEditor.PackageManager { public class PackageInfo { public string resolvedPath; public static PackageInfo FindForAssembly(System.Reflection.Assembly a) { return new PackageInfo(); } } }
namespace UnityEditor
{
    [AttributeUsage(AttributeTargets.All)] public class MenuItem : Attribute { public MenuItem(string s) { } }
    public class EditorWindow : UnityEngine.ScriptableObject { public static T GetWindow<T>(string t) where T : EditorWindow, new() { return new T(); } }
    public static class EditorStyles { public static object boldLabel; }
    public static class EditorGUILayout
    {
        public static UnityEngine.Vector2 BeginScrollView(UnityEngine.Vector2 v) { return v; } public static void EndScrollView() { }
        public static void LabelField(string s, object style = null) { } public static void HelpBox(string s, MessageType t) { }
        public static UnityEngine.Object ObjectField(string l, UnityEngine.Object o, Type t, bool scene) { return o; }
    }
    public enum MessageType { None, Info }
    public static class EditorGUI { public class DisabledScope : IDisposable { public DisabledScope(bool b) { } public void Dispose() { } } }
    public static class Undo { public static void RegisterCreatedObjectUndo(UnityEngine.Object o, string n) { } public static T AddComponent<T>(UnityEngine.GameObject g) where T : UnityEngine.Component, new() { return g.AddComponent<T>(); } public static void RecordObject(UnityEngine.Object o, string n) { } }
    public static class Selection { public static UnityEngine.GameObject activeGameObject; public static UnityEngine.Object activeObject; }
    public static class EditorUtility { public static void SetDirty(UnityEngine.Object o) { } }
    public enum BuildTarget { Android, StandaloneWindows64 }
    public static class EditorUserBuildSettings { public static BuildTarget activeBuildTarget; }
    public static class PrefabUtility { public static UnityEngine.GameObject SaveAsPrefabAsset(UnityEngine.GameObject g, string p) { return g; } }
    public static class AssetDatabase
    {
        public static string GetAssetPath(UnityEngine.Object o) { return ""; }
        public static bool IsValidFolder(string p) { return true; } public static void CreateFolder(string a, string b) { } public static void CreateAsset(UnityEngine.Object o, string p) { } public static void SaveAssets() { }
        public static UnityEngine.Object[] LoadAllAssetsAtPath(string p) { return new UnityEngine.Object[0]; }
    }
    public class SerializedProperty { public int arraySize; public UnityEngine.Object objectReferenceValue; public void InsertArrayElementAtIndex(int i) { } public SerializedProperty GetArrayElementAtIndex(int i) { return this; } }
    public class SerializedObject { public SerializedObject(UnityEngine.Object o) { } public SerializedProperty FindProperty(string s) { return new SerializedProperty(); } public void ApplyModifiedProperties() { } }
}
