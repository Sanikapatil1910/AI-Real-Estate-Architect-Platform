// Turns a recognised sentence ("turn off the living room light", "set the fan to speed three") into a command.  Rule based and deterministic:
// it runs on whatever text the speech recogniser returns, so it is tolerant (filler words, plurals, number words) but never guesses a room.
using System;
using System.Collections.Generic;
using System.Text;

namespace RealEstate.SmartHouse.Core
{
    public enum CommandKind { Unknown, LightOn, LightOff, FanOn, FanOff, FanSet, FanFaster, FanSlower, AutoOn, AutoOff, PanelShow, PanelHide }

    public sealed class VoiceCommand
    {
        public CommandKind Kind = CommandKind.Unknown;
        public int Level;                     // for FanSet
        public RoomQuery Room = new RoomQuery();
        public string Heard = "";
        public string Normalized = "";
        public bool IsFan { get { return Kind >= CommandKind.FanOn && Kind <= CommandKind.FanSlower; } }
        public bool IsAuto { get { return Kind == CommandKind.AutoOn || Kind == CommandKind.AutoOff; } }
        public bool IsPanel { get { return Kind == CommandKind.PanelShow || Kind == CommandKind.PanelHide; } }
    }

    public static class VoiceCommandParser
    {
        static readonly string[] Numbers = { "zero", "one", "two", "three", "four", "five" };
        static readonly string[] Ordinals = { "", "first", "second", "third", "fourth", "fifth" };
        static readonly HashSet<string> LightWords = new HashSet<string> { "light", "lights", "lamp", "lamps", "bulb", "bulbs", "lighting", "tubelight" };
        static readonly HashSet<string> FanWords = new HashSet<string> { "fan", "fans" };
        static readonly HashSet<string> Verbs = new HashSet<string> { "turn", "switch", "put", "shut", "power", "set" };

        public static string Normalize(string s)
        {
            if (s == null) return "";
            var sb = new StringBuilder(s.Length);
            bool space = true;
            foreach (char ch in s.ToLowerInvariant())
            {
                if (char.IsLetterOrDigit(ch)) { sb.Append(ch); space = false; }
                else if (!space) { sb.Append(' '); space = true; }
            }
            return sb.ToString().Trim();
        }

        public static VoiceCommand Parse(string transcript)
        {
            var cmd = new VoiceCommand { Heard = transcript ?? "" };
            string norm = Normalize(transcript);
            cmd.Normalized = norm;
            if (norm.Length == 0) return cmd;
            var t = new List<string>(norm.Split(' '));

            // "turn on automatic lighting", "disable the motion sensor": the automation, not a light
            if (Has(t, "automatic", "automatically", "auto", "automation", "motion", "sensor", "sensors"))
            {
                int a = Action(t);
                if (a > 0) cmd.Kind = CommandKind.AutoOn; else if (a < 0) cmd.Kind = CommandKind.AutoOff;
                return cmd;
            }
            // "show the control panel", "hide the panel"
            if (Has(t, "panel", "controls", "menu", "dashboard"))
            {
                if (Has(t, "show", "open", "display", "bring", "recall", "where")) { cmd.Kind = CommandKind.PanelShow; return cmd; }
                if (Has(t, "hide", "close", "dismiss", "remove")) { cmd.Kind = CommandKind.PanelHide; return cmd; }
            }

            bool light = false, fan = false;
            foreach (var w in t) { if (LightWords.Contains(w)) light = true; if (FanWords.Contains(w)) fan = true; }
            // "lights out" / "light up" are idioms for off / on
            int act = Action(t);                // +1 on, -1 off, 0 unknown

            int ordIdx;
            cmd.Room = Rooms(t, out ordIdx);

            if (fan && !light)
            {
                int lvl = FanLevel(t, ordIdx);
                if (act < 0 && lvl < 0) { cmd.Kind = CommandKind.FanOff; cmd.Level = 0; }
                else if (lvl >= 0) { cmd.Kind = CommandKind.FanSet; cmd.Level = lvl; }
                else if (Has(t, "faster", "increase", "higher", "more", "up") && !(Has(t, "on") && !Has(t, "speed", "faster"))) cmd.Kind = CommandKind.FanFaster;
                else if (Has(t, "slower", "decrease", "lower", "less", "down", "reduce")) cmd.Kind = CommandKind.FanSlower;
                else if (act > 0) cmd.Kind = CommandKind.FanOn;
                return cmd;
            }
            if (light && !fan)
            {
                if (act > 0) cmd.Kind = CommandKind.LightOn;
                else if (act < 0) cmd.Kind = CommandKind.LightOff;
            }
            return cmd;
        }

        static bool Has(List<string> t, params string[] w) { foreach (var x in w) if (t.Contains(x)) return true; return false; }

        static int Action(List<string> t)
        {
            for (int i = 0; i + 1 < t.Count; i++)
                if (Verbs.Contains(t[i]))
                {
                    // "turn the light on" / "turn on the light": look at the next words up to the noun
                    for (int j = i + 1; j < Math.Min(t.Count, i + 3); j++)
                    {
                        if (t[j] == "on") return 1;
                        if (t[j] == "off") return -1;
                    }
                }
            bool off = Has(t, "off", "disable", "deactivate", "stop", "kill");
            bool on = Has(t, "on", "enable", "activate", "start", "illuminate");
            if (off && !on) return -1;
            if (on && !off) return 1;
            if (off && on) return t.LastIndexOf("off") > t.LastIndexOf("on") ? -1 : 1;
            if (Has(t, "out") && Has(t, "lights", "light")) return -1;
            if (Has(t, "up") && Has(t, "light")) return 1;
            return 0;
        }

        // ---- rooms ------------------------------------------------------------------------------------------------------------------------------
        sealed class Phrase { public string[] Words; public string[] Types; public string Label; public Phrase(string w, string label, params string[] types) { Words = w.Split(' '); Types = types; Label = label; } }

        static readonly Phrase[] RoomPhrases =
        {
            new Phrase("master bedroom", "master bedroom", "master_bedroom"),
            new Phrase("master bed room", "master bedroom", "master_bedroom"),
            new Phrase("guest bedroom", "guest bedroom", "guest_bedroom"),
            new Phrase("guest room", "guest room", "guest_bedroom"),
            new Phrase("family lounge", "family lounge", "family_lounge"),
            new Phrase("family room", "family room", "family_lounge"),
            new Phrase("living room", "living room", "living_room"),
            new Phrase("drawing room", "living room", "living_room"),
            new Phrase("dining room", "dining room", "dining"),
            new Phrase("puja room", "puja room", "puja_room"),
            new Phrase("pooja room", "puja room", "puja_room"),
            new Phrase("bed room", "bedroom", "bedroom", "master_bedroom", "guest_bedroom"),
            new Phrase("bath room", "bathroom", "bathroom"),
            new Phrase("bedroom", "bedroom", "bedroom", "master_bedroom", "guest_bedroom"),
            new Phrase("bedrooms", "bedroom", "bedroom", "master_bedroom", "guest_bedroom"),
            new Phrase("bathroom", "bathroom", "bathroom"),
            new Phrase("bathrooms", "bathroom", "bathroom"),
            new Phrase("washroom", "bathroom", "bathroom"), new Phrase("toilet", "bathroom", "bathroom"), new Phrase("restroom", "bathroom", "bathroom"),
            new Phrase("bath", "bathroom", "bathroom"),
            new Phrase("kitchen", "kitchen", "kitchen"),
            new Phrase("living", "living room", "living_room"), new Phrase("hall", "living room", "living_room"),
            new Phrase("lounge", "lounge", "family_lounge", "living_room"),
            new Phrase("dining", "dining room", "dining"),
            new Phrase("utility", "utility", "utility"),
            new Phrase("pooja", "puja room", "puja_room"), new Phrase("puja", "puja room", "puja_room"), new Phrase("prayer", "puja room", "puja_room"),
            new Phrase("study", "study", "study"), new Phrase("office", "study", "study"),
            new Phrase("passage", "passage", "passage"), new Phrase("corridor", "passage", "passage"), new Phrase("hallway", "passage", "passage"),
            new Phrase("staircase", "staircase", "staircase"), new Phrase("stairs", "staircase", "staircase"), new Phrase("stair", "staircase", "staircase"),
            new Phrase("stairway", "staircase", "staircase"),
        };

        static RoomQuery Rooms(List<string> t, out int ordinalIdx)
        {
            var q = new RoomQuery();
            ordinalIdx = -1;
            int phraseEnd = -1, phraseStart = -1;
            // longest phrase first (the table lists two-word phrases first)
            foreach (var ph in RoomPhrases)
            {
                for (int i = 0; i + ph.Words.Length <= t.Count; i++)
                {
                    bool ok = true;
                    for (int k = 0; k < ph.Words.Length; k++) if (t[i + k] != ph.Words[k]) { ok = false; break; }
                    if (!ok) continue;
                    q.Scope = RoomScope.Type; q.Types = new List<string>(ph.Types); q.Label = ph.Label;
                    phraseStart = i; phraseEnd = i + ph.Words.Length - 1;
                    break;
                }
                if (phraseEnd >= 0) break;
            }
            // floor words ("first floor", "upstairs"); an ordinal followed by "floor" is a floor, not a room number
            var floorWordIdx = new HashSet<int>();
            for (int i = 0; i < t.Count; i++)
            {
                if (t[i] == "ground" && i + 1 < t.Count && t[i + 1] == "floor") { q.FloorMin = 0; q.FloorMax = 0; floorWordIdx.Add(i); }
                else if (i + 1 < t.Count && t[i + 1] == "floor")
                {
                    int o = OrdinalOf(t[i]);
                    if (o > 0) { q.FloorMin = o; q.FloorMax = o; floorWordIdx.Add(i); }
                }
                else if (t[i] == "upstairs" || t[i] == "upper") { q.FloorMin = 1; floorWordIdx.Add(i); }
                else if (t[i] == "downstairs" || t[i] == "lower") { q.FloorMin = 0; q.FloorMax = 0; floorWordIdx.Add(i); }
            }
            if (q.Scope == RoomScope.Type)
            {
                // an ordinal next to the room phrase: "bedroom two", "second bedroom", "bedroom number 2"
                int a = phraseStart - 1, b = phraseEnd + 1;
                if (a >= 0 && !floorWordIdx.Contains(a) && OrdinalOf(t[a]) > 0) { q.Ordinal = OrdinalOf(t[a]); ordinalIdx = a; }
                else if (b < t.Count)
                {
                    int j = b;
                    if ((t[j] == "number" || t[j] == "no") && j + 1 < t.Count) j++;
                    int n = NumberOf(t[j]);
                    if (n > 0) { q.Ordinal = n; ordinalIdx = j; }
                }
            }
            bool all = Has(t, "all", "every", "everything", "whole", "entire");
            if (all && q.Scope != RoomScope.Type) q.Scope = RoomScope.All;
            else if (all && q.Scope == RoomScope.Type && q.Ordinal == 0) { /* "all bedroom lights": every room of that type */ }
            if (q.Scope == RoomScope.Current && (q.FloorMin > 0 || q.FloorMax < int.MaxValue)) q.Scope = RoomScope.All;   // "all lights upstairs"
            if (q.Scope == RoomScope.All && q.Label.Length == 0) q.Label = "all rooms";
            return q;
        }

        static int OrdinalOf(string w)
        {
            for (int i = 1; i < Ordinals.Length; i++) if (Ordinals[i] == w) return i;
            return 0;
        }

        static int NumberOf(string w)
        {
            for (int i = 1; i < Numbers.Length; i++) if (Numbers[i] == w) return i;
            int n;
            if (w.Length == 1 && int.TryParse(w, out n) && n >= 1 && n <= 5) return n;
            return 0;
        }

        // ---- fan level --------------------------------------------------------------------------------------------------------------------------
        /// <summary>The speed level a fan sentence asks for (0..5), or -1.  The number that is the room's ordinal ("bedroom two fan") is not a level.</summary>
        static int FanLevel(List<string> t, int ordinalIdx)
        {
            if (Has(t, "maximum", "max", "full", "highest", "fastest")) return 5;
            if (Has(t, "minimum", "min", "lowest", "slowest")) return 1;
            if (Has(t, "medium", "middle")) return 3;
            int found = -1;
            for (int i = 0; i < t.Count; i++)
            {
                int v = -1;
                for (int k = 0; k < Numbers.Length; k++) if (t[i] == Numbers[k]) v = k;
                int d;
                if (v < 0 && t[i].Length == 1 && int.TryParse(t[i], out d) && d >= 0 && d <= 5) v = d;
                if (v < 0 && (t[i] == "for" || t[i] == "fore") && i == t.Count - 1 && i > 0 && (t[i - 1] == "speed" || t[i - 1] == "level")) v = 4;
                if (v < 0) continue;
                if (i == ordinalIdx) continue;          // "bedroom two" names the room, not the speed
                found = v;
            }
            return found;
        }
    }
}
