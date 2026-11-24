using System;
using RealEstate.SmartHouse.Core;

namespace RealEstate.SmartHouse.Voice
{
    /// <summary>
    /// Connects ONE voice backend to ONE <see cref="SmartHouseState"/>.  Attaching is idempotent (a second Attach to the same backend never
    /// subscribes twice) and a repeated final transcript within <see cref="DedupeSeconds"/> is ignored, because some recognisers deliver the same
    /// final result through two callbacks.
    /// </summary>
    public sealed class VoiceCommandRouter
    {
        public float DedupeSeconds = 1.2f;
        public readonly SmartHouseState State;
        VoiceBackendBase backend;
        string lastFinal = "";
        double lastFinalAt = -100;
        public Func<double> Clock = () => UnityEngine.Time.unscaledTime;

        /// <summary>(heard text, result) for every final transcript that was executed; also fired for "not understood" so the user sees feedback.</summary>
        public event Action<string, CommandResult> Executed;
        /// <summary>Partial text while the user is still speaking.</summary>
        public event Action<string> Heard;

        public int ExecutedCount { get; private set; }

        public VoiceCommandRouter(SmartHouseState state) { State = state; }

        public void Attach(VoiceBackendBase b)
        {
            if (ReferenceEquals(b, backend)) return;
            Detach();
            backend = b;
            if (backend != null) backend.Transcript += OnTranscript;
        }

        public void Detach()
        {
            if (backend != null) backend.Transcript -= OnTranscript;
            backend = null;
        }

        void OnTranscript(string text, bool final)
        {
            if (!final) { var h = Heard; if (h != null) h(text); return; }
            Submit(text, true);
        }

        /// <summary>Run a final transcript.  Used by the backend and by the typed-command panel / tests.</summary>
        public CommandResult Submit(string text, bool dedupe = true)
        {
            double now = Clock();
            string norm = VoiceCommandParser.Normalize(text);
            if (dedupe && norm.Length > 0 && norm == lastFinal && now - lastFinalAt < DedupeSeconds) return null;
            lastFinal = norm; lastFinalAt = now;
            var res = State.Execute(text);
            ExecutedCount++;
            var e = Executed; if (e != null) e(text, res);
            return res;
        }
    }
}
