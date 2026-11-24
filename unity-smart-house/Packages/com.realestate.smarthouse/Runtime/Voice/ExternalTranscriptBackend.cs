using UnityEngine;

namespace RealEstate.SmartHouse.Voice
{
    /// <summary>
    /// A backend that receives text from somewhere else.  Wire it to the Meta XR Voice SDK (Wit.ai) by adding two entries to the
    /// AppVoiceExperience's VoiceEvents in the Inspector:  OnPartialTranscription -> OnPartial(string),  OnFullTranscription -> OnFinal(string),
    /// and call <see cref="StartListening"/> through <see cref="listenAction"/> (or let <see cref="VoicePushToTalk"/> do it).  Any other recogniser
    /// (Vosk, whisper.unity, a platform API) can feed it the same way; so can a typed-command box.
    /// There is no compile-time dependency on the Voice SDK, so this file builds with or without it.
    /// </summary>
    public sealed class ExternalTranscriptBackend : VoiceBackendBase
    {
        [Tooltip("Optional: invoked on StartListening (e.g. AppVoiceExperience.Activate). Wire it in the Inspector.")]
        public UnityEngine.Events.UnityEvent listenAction;
        [Tooltip("Optional: invoked on StopListening (e.g. AppVoiceExperience.Deactivate).")]
        public UnityEngine.Events.UnityEvent stopAction;

        public override string DisplayName { get { return "External transcript (Meta Voice SDK / other)"; } }

        public override void StartListening()
        {
            if (!MicrophonePermission.Has())
            {
                SetState(VoiceState.RequestingPermission, "Allow microphone access to use voice commands");
                MicrophonePermission.Request(ok =>
                {
                    if (!ok) { SetState(VoiceState.PermissionDenied, "Microphone permission denied - use the wall switches, or allow it in Settings"); return; }
                    StartListening();
                });
                return;
            }
            SetState(VoiceState.Listening, "Listening…");
            if (listenAction != null) listenAction.Invoke();
        }

        public override void StopListening()
        {
            if (stopAction != null) stopAction.Invoke();
            SetState(VoiceState.Idle, "");
        }

        /// <summary>Hook for OnPartialTranscription.</summary>
        public void OnPartial(string text) { RaiseTranscript(text, false); }
        /// <summary>Hook for OnFullTranscription.  Also usable from tests and the typed-command panel.</summary>
        public void OnFinal(string text) { RaiseTranscript(text, true); if (State == VoiceState.Listening) SetState(VoiceState.Listening, "Listening…"); }
    }
}
