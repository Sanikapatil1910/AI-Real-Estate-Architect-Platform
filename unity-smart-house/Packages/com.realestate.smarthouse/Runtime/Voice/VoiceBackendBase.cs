using System;
using UnityEngine;

namespace RealEstate.SmartHouse.Voice
{
    /// <summary>
    /// A source of recognised speech.  Everything that turns audio into text derives from this; <see cref="VoiceCommandRouter"/> only sees text.
    /// Raise <see cref="Transcript"/> with the recognised text (isFinal = true when the recogniser has finished the utterance).
    /// </summary>
    public abstract class VoiceBackendBase : MonoBehaviour
    {
        /// <summary>(text, isFinal)</summary>
        public event Action<string, bool> Transcript;
        public event Action<VoiceState, string> StateChanged;

        public VoiceState State { get; private set; }
        public string StateDetail { get; private set; }
        public abstract string DisplayName { get; }

        /// <summary>Begin (continuous) listening.  Safe to call repeatedly.</summary>
        public abstract void StartListening();
        public abstract void StopListening();

        protected void RaiseTranscript(string text, bool final)
        {
            if (string.IsNullOrEmpty(text)) return;
            var h = Transcript; if (h != null) h(text, final);
        }

        protected void SetState(VoiceState s, string detail = "")
        {
            if (State == s && StateDetail == detail) return;
            State = s; StateDetail = detail ?? "";
            var h = StateChanged; if (h != null) h(s, StateDetail);
        }
    }
}
