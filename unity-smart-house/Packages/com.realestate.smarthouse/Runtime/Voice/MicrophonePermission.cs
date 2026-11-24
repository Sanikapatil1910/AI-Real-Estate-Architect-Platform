using System;
using UnityEngine;
#if UNITY_ANDROID && !UNITY_EDITOR
using UnityEngine.Android;
#endif

namespace RealEstate.SmartHouse.Voice
{
    /// <summary>
    /// Runtime RECORD_AUDIO permission (Android / Quest).  Elsewhere it reports "granted" (desktop OSes prompt when the microphone is first used).
    /// The manifest must also declare the permission; see Samples~/AndroidManifest/AndroidManifest.xml.
    /// </summary>
    public static class MicrophonePermission
    {
        public static bool Has()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            return Permission.HasUserAuthorizedPermission(Permission.Microphone);
#else
            return true;
#endif
        }

        /// <summary>Asks if needed.  <paramref name="done"/> gets true when the microphone may be used; it is called on the main thread.</summary>
        public static void Request(Action<bool> done)
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            if (Permission.HasUserAuthorizedPermission(Permission.Microphone)) { if (done != null) done(true); return; }
            var cb = new PermissionCallbacks();
            bool fired = false;
            Action<bool> finish = ok => { if (fired) return; fired = true; if (done != null) done(ok); };
            cb.PermissionGranted += _ => finish(true);
            cb.PermissionDenied += _ => finish(false);
            cb.PermissionDeniedAndDontAskAgain += _ => finish(false);
            Permission.RequestUserPermission(Permission.Microphone, cb);
#else
            if (done != null) done(true);
#endif
        }
    }
}
