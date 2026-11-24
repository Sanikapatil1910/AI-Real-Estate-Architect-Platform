using System;
namespace UnityEngine
{
    public class AndroidJavaObject : IDisposable
    {
        public AndroidJavaObject(string cls, params object[] a) { }
        public void Call(string m, params object[] a) { } public T Call<T>(string m, params object[] a) { return default(T); }
        public T GetStatic<T>(string f) { return default(T); }
        public void Dispose() { }
    }
    public class AndroidJavaClass : AndroidJavaObject { public AndroidJavaClass(string c) : base(c) { } public T CallStatic<T>(string m, params object[] a) { return default(T); } }
    public class AndroidJavaProxy { public AndroidJavaProxy(string iface) { } }
    public class AndroidJavaRunnable { public AndroidJavaRunnable(Action a) { } public static implicit operator AndroidJavaRunnable(Action a) { return new AndroidJavaRunnable(a); } }
}
namespace UnityEngine.Android
{
    public class PermissionCallbacks { public event Action<string> PermissionGranted, PermissionDenied, PermissionDeniedAndDontAskAgain; }
    public static class Permission { public const string Microphone = "android.permission.RECORD_AUDIO"; public static bool HasUserAuthorizedPermission(string p) { return false; } public static void RequestUserPermission(string p, PermissionCallbacks c) { } }
}
