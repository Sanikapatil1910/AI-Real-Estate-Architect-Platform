// Speech recognition through android.speech.SpeechRecognizer (JNI), with no extra package.  Works on a phone/tablet with a recognition service installed.
// It is NOT verified on Meta Quest: Horizon OS may not ship a recognition service, in which case isRecognitionAvailable() is false and this backend
// reports Unavailable (the on-screen message says so) - use ExternalTranscriptBackend with the Meta Voice SDK instead (see README).
using System;
using System.Collections.Generic;
using UnityEngine;

namespace RealEstate.SmartHouse.Voice
{
    public sealed class AndroidSpeechBackend : VoiceBackendBase
    {
        public string language = "en-US";
        public bool preferOffline = true;
        [Tooltip("Wait before restarting after each utterance (s). Too small makes some services beep or fail with ERROR_RECOGNIZER_BUSY.")]
        public float restartDelay = 0.35f;

        public override string DisplayName { get { return "Android SpeechRecognizer"; } }

        bool wantListening;
        float restartAt = -1f;
        readonly Queue<Action> mainThread = new Queue<Action>();

#if UNITY_ANDROID && !UNITY_EDITOR
        AndroidJavaObject activity, recognizer, intent;
        Listener listener;
        bool permissionAsked;

        void Post(Action a) { lock (mainThread) mainThread.Enqueue(a); }

        public override void StartListening()
        {
            if (wantListening) return;
            wantListening = true;
            if (!MicrophonePermission.Has())
            {
                if (permissionAsked) { SetState(VoiceState.PermissionDenied, "Microphone permission denied - allow it in Settings > Apps > Permissions"); return; }
                permissionAsked = true;
                SetState(VoiceState.RequestingPermission, "Allow microphone access to use voice commands");
                MicrophonePermission.Request(ok =>
                {
                    if (!ok) { wantListening = false; SetState(VoiceState.PermissionDenied, "Microphone permission denied - use the wall switches, or allow it in Settings"); }
                    else { wantListening = false; StartListening(); }
                });
                return;
            }
            RunOnUi(() =>
            {
                try
                {
                    if (!EnsureRecognizer()) { Post(() => { wantListening = false; SetState(VoiceState.Unavailable, "No speech recognition service on this device - use the wall switches or another voice backend"); }); return; }
                    recognizer.Call("startListening", intent);
                    Post(() => SetState(VoiceState.Listening, "Listening…"));
                }
                catch (Exception e) { Post(() => { SetState(VoiceState.Error, e.Message); Schedule(1.5f); }); }
            });
        }

        public override void StopListening()
        {
            wantListening = false; restartAt = -1f;
            RunOnUi(() => { try { if (recognizer != null) recognizer.Call("stopListening"); } catch (Exception) { } });
            SetState(VoiceState.Idle, "");
        }

        void RunOnUi(Action a)
        {
            if (activity == null)
            {
                using (var up = new AndroidJavaClass("com.unity3d.player.UnityPlayer")) activity = up.GetStatic<AndroidJavaObject>("currentActivity");
            }
            activity.Call("runOnUiThread", new AndroidJavaRunnable(a));
        }

        bool EnsureRecognizer()
        {
            if (recognizer != null) return true;
            using (var sr = new AndroidJavaClass("android.speech.SpeechRecognizer"))
            {
                if (!sr.CallStatic<bool>("isRecognitionAvailable", activity)) return false;
                recognizer = sr.CallStatic<AndroidJavaObject>("createSpeechRecognizer", activity);
            }
            listener = new Listener(this);
            recognizer.Call("setRecognitionListener", listener);
            using (var ri = new AndroidJavaClass("android.speech.RecognizerIntent"))
            {
                intent = new AndroidJavaObject("android.content.Intent", ri.GetStatic<string>("ACTION_RECOGNIZE_SPEECH"));
                intent.Call<AndroidJavaObject>("putExtra", ri.GetStatic<string>("EXTRA_LANGUAGE_MODEL"), ri.GetStatic<string>("LANGUAGE_MODEL_FREE_FORM"));
                intent.Call<AndroidJavaObject>("putExtra", ri.GetStatic<string>("EXTRA_LANGUAGE"), language);
                intent.Call<AndroidJavaObject>("putExtra", ri.GetStatic<string>("EXTRA_PARTIAL_RESULTS"), true);
                intent.Call<AndroidJavaObject>("putExtra", ri.GetStatic<string>("EXTRA_MAX_RESULTS"), 3);
                intent.Call<AndroidJavaObject>("putExtra", ri.GetStatic<string>("EXTRA_PREFER_OFFLINE"), preferOffline);
            }
            return true;
        }

        void Schedule(float seconds) { if (wantListening) restartAt = Time.unscaledTime + seconds; }

        sealed class Listener : AndroidJavaProxy
        {
            readonly AndroidSpeechBackend owner;
            public Listener(AndroidSpeechBackend o) : base("android.speech.RecognitionListener") { owner = o; }
            public void onReadyForSpeech(AndroidJavaObject p) { }
            public void onBeginningOfSpeech() { }
            public void onRmsChanged(float rms) { }
            public void onBufferReceived(byte[] b) { }
            public void onEndOfSpeech() { owner.Post(() => owner.SetState(VoiceState.Processing, "…")); }
            public void onEvent(int type, AndroidJavaObject p) { }
            public void onError(int error)
            {
                // 7 = no match, 6 = speech timeout: normal while idle, just listen again.  9 = insufficient permissions.  8 = recogniser busy.
                owner.Post(() =>
                {
                    if (error == 9) { owner.wantListening = false; owner.SetState(VoiceState.PermissionDenied, "Microphone permission missing"); return; }
                    if (error == 7 || error == 6) { owner.SetState(VoiceState.Listening, "Listening…"); owner.Schedule(owner.restartDelay); return; }
                    owner.SetState(VoiceState.Error, "Recognition error " + error);
                    owner.Schedule(error == 8 ? 1.0f : 1.5f);
                });
            }
            public void onResults(AndroidJavaObject bundle) { Handle(bundle, true); }
            public void onPartialResults(AndroidJavaObject bundle) { Handle(bundle, false); }
            void Handle(AndroidJavaObject bundle, bool final)
            {
                string best = null;
                try
                {
                    using (var sr = new AndroidJavaClass("android.speech.SpeechRecognizer"))
                    {
                        var list = bundle.Call<AndroidJavaObject>("getStringArrayList", sr.GetStatic<string>("RESULTS_RECOGNITION"));
                        if (list != null && list.Call<int>("size") > 0) best = list.Call<string>("get", 0);
                    }
                }
                catch (Exception) { }
                owner.Post(() =>
                {
                    if (!string.IsNullOrEmpty(best)) owner.RaiseTranscript(best, final);
                    if (final) { owner.SetState(VoiceState.Listening, "Listening…"); owner.Schedule(owner.restartDelay); }
                });
            }
        }

        void Update()
        {
            while (true)
            {
                Action a;
                lock (mainThread) { if (mainThread.Count == 0) break; a = mainThread.Dequeue(); }
                a();
            }
            if (wantListening && restartAt > 0f && Time.unscaledTime >= restartAt)
            {
                restartAt = -1f;
                bool was = wantListening; wantListening = false;
                if (was) StartListening();
            }
        }

        void OnDestroy()
        {
            wantListening = false;
            try { if (activity != null && recognizer != null) { var r = recognizer; activity.Call("runOnUiThread", new AndroidJavaRunnable(() => { r.Call("destroy"); })); } } catch (Exception) { }
        }
#else
        public override void StartListening() { SetState(VoiceState.Unavailable, "Android speech recognition only runs on an Android device"); }
        public override void StopListening() { SetState(VoiceState.Idle, ""); }
#endif
    }
}
