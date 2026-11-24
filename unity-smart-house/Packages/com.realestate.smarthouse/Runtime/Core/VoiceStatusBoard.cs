// What the voice pipeline is doing, as one short line the panel and the toast can show:
//   Listening  ->  Command recognized  ->  Action completed        (or: Command not understood / No target)
//   Microphone unavailable   |   Requesting permission   |   Voice off (panel only)
// Pure logic, advanced by Tick(dt) so it is testable without Unity.  VoiceState lives here (namespace ...Voice) so the Core has no Unity dependency.
using System;

namespace RealEstate.SmartHouse.Voice
{
    public enum VoiceState { Idle, RequestingPermission, PermissionDenied, Unavailable, Listening, Processing, Error }
}

namespace RealEstate.SmartHouse.Core
{
    using RealEstate.SmartHouse.Voice;

    public enum VoicePhase { NoBackend, RequestingPermission, MicUnavailable, Idle, Listening, Processing, Hearing, Recognized, Completed, NotUnderstood, NoTarget }
    public enum Tone { Neutral, Good, Warn, Bad }

    public sealed class VoiceStatusBoard
    {
        /// <summary>How long "Command recognized" stays before "Action completed" replaces it.</summary>
        public double RecognizedSeconds = 0.5;
        /// <summary>How long a result (completed / not understood) stays before the board returns to the listening state.</summary>
        public double ResultSeconds = 3.0;

        bool hasBackend;
        VoiceState backend = VoiceState.Idle;
        string backendDetail = "";
        string heard = "", message = "";
        VoicePhase transient = VoicePhase.NoBackend;      // NoBackend = none
        double transientLeft;
        VoicePhase afterRecognized = VoicePhase.Completed;
        string partial = "";

        public bool HasBackend { get { return hasBackend; } }

        public void SetBackend(bool present) { hasBackend = present; if (!present) { backend = VoiceState.Idle; backendDetail = ""; } }

        public void OnBackendState(VoiceState s, string detail) { hasBackend = true; backend = s; backendDetail = detail ?? ""; }

        public void OnPartial(string text) { partial = text ?? ""; }

        /// <summary>A final transcript (or typed command) was executed.</summary>
        public void OnCommand(string heardText, CommandResult r)
        {
            partial = "";
            heard = (heardText ?? "").Trim();
            message = r != null ? r.Message : "";
            if (r == null) return;
            if (!r.Understood) { transient = VoicePhase.NotUnderstood; transientLeft = ResultSeconds; return; }
            if (r.RoomKeys.Count == 0 && !r.Changed) { transient = VoicePhase.NoTarget; transientLeft = ResultSeconds; return; }
            transient = VoicePhase.Recognized; transientLeft = RecognizedSeconds; afterRecognized = VoicePhase.Completed;
        }

        public void Tick(double dt)
        {
            if (dt <= 0 || double.IsNaN(dt) || double.IsInfinity(dt)) return;
            while (transient != VoicePhase.NoBackend && dt > 0)
            {
                if (dt < transientLeft) { transientLeft -= dt; return; }
                dt -= transientLeft;                              // a long frame can span several phases
                if (transient == VoicePhase.Recognized) { transient = afterRecognized; transientLeft = ResultSeconds; }
                else { transient = VoicePhase.NoBackend; transientLeft = 0; }
            }
        }

        public VoicePhase Phase
        {
            get
            {
                if (transient != VoicePhase.NoBackend) return transient;
                if (!hasBackend) return VoicePhase.NoBackend;
                switch (backend)
                {
                    case VoiceState.RequestingPermission: return VoicePhase.RequestingPermission;
                    case VoiceState.PermissionDenied:
                    case VoiceState.Unavailable:
                    case VoiceState.Error: return VoicePhase.MicUnavailable;
                    case VoiceState.Processing: return VoicePhase.Processing;
                    case VoiceState.Listening: return partial.Length > 0 ? VoicePhase.Hearing : VoicePhase.Listening;
                    default: return VoicePhase.Idle;
                }
            }
        }

        public string Headline
        {
            get
            {
                switch (Phase)
                {
                    case VoicePhase.NoBackend: return "Voice: off (use the panel)";
                    case VoicePhase.RequestingPermission: return "Voice: asking for microphone permission";
                    case VoicePhase.MicUnavailable: return "Microphone unavailable";
                    case VoicePhase.Idle: return "Voice: not listening";
                    case VoicePhase.Listening: return "Listening...";
                    case VoicePhase.Hearing: return "Listening: " + partial;
                    case VoicePhase.Processing: return "Processing...";
                    case VoicePhase.Recognized: return "Command recognized";
                    case VoicePhase.Completed: return "Action completed";
                    case VoicePhase.NotUnderstood: return "Command not understood";
                    case VoicePhase.NoTarget: return "Command recognized, nothing to act on";
                    default: return "";
                }
            }
        }

        public string Detail
        {
            get
            {
                switch (Phase)
                {
                    case VoicePhase.MicUnavailable: return backendDetail.Length > 0 ? backendDetail : "check the microphone permission";
                    case VoicePhase.RequestingPermission: return backendDetail;
                    case VoicePhase.Recognized: return "“" + heard + "”";
                    case VoicePhase.Completed:
                    case VoicePhase.NoTarget: return message;
                    case VoicePhase.NotUnderstood: return heard.Length > 0 ? "“" + heard + "”" : message;
                    default: return "";
                }
            }
        }

        public Tone Tone
        {
            get
            {
                switch (Phase)
                {
                    case VoicePhase.Completed: case VoicePhase.Recognized: case VoicePhase.Listening: case VoicePhase.Hearing: return Tone.Good;
                    case VoicePhase.NotUnderstood: case VoicePhase.NoTarget: case VoicePhase.RequestingPermission: return Tone.Warn;
                    case VoicePhase.MicUnavailable: return Tone.Bad;
                    default: return Tone.Neutral;
                }
            }
        }
    }
}
