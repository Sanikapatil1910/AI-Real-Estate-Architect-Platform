// Framework-free tests of the Unity-independent core.  Run in two places: by the Unity Test Runner (CoreNUnitTests.cs wraps RunAll) and, outside
// Unity, by tools/mono-tests (mcs + mono), which is how they were executed when the package was written.
using System;
using System.Collections.Generic;
using System.Linq;
using RealEstate.SmartHouse.Core;

namespace RealEstate.SmartHouse.Tests
{
    public static partial class CoreTests
    {
        static List<string> fails;
        static int checks;
        static string current = "";

        static void T(bool ok, string what) { checks++; if (!ok) fails.Add(current + ": " + what); }
        static void Eq<A>(A want, A got, string what) { checks++; if (!Equals(want, got)) fails.Add(current + ": " + what + " (want " + want + ", got " + got + ")"); }
        static void Near(double want, double got, double eps, string what) { checks++; if (Math.Abs(want - got) > eps) fails.Add(current + ": " + what + " (want " + want + ", got " + got + ")"); }
        static void Run(string name, Action a) { current = name; try { a(); } catch (Exception e) { fails.Add(name + ": threw " + e.GetType().Name + ": " + e.Message); } }

        public sealed class Result { public int Checks; public int Tests; public List<string> Failures; public List<string> Passed = new List<string>(); }

        /// <param name="sampleJson">A smart-house sidecar generated from a real stored plan (Tests/Editor/Data).</param>
        public static Result RunAll(string sampleJson)
        {
            fails = new List<string>(); checks = 0;
            var r = new Result();
            var tests = new List<KeyValuePair<string, Action>>
            {
                new KeyValuePair<string, Action>("MiniJson", MiniJsonTests),
                new KeyValuePair<string, Action>("Document", () => DocumentTests(sampleJson)),
                new KeyValuePair<string, Action>("Fan_levels_are_strictly_faster", FanLevels),
                new KeyValuePair<string, Action>("Fan_level_0_stops", FanStops),
                new KeyValuePair<string, Action>("Fan_is_frame_rate_independent", FanFrameRate),
                new KeyValuePair<string, Action>("Fan_ramps_smoothly", FanSmooth),
                new KeyValuePair<string, Action>("Fan_spec_validation", FanSpecTests),
                new KeyValuePair<string, Action>("Parser_required_sentences", ParserRequired),
                new KeyValuePair<string, Action>("Parser_variants", ParserVariants),
                new KeyValuePair<string, Action>("Parser_fan", ParserFan),
                new KeyValuePair<string, Action>("Parser_rejects_nonsense", ParserNonsense),
                new KeyValuePair<string, Action>("Voice_turns_light_on_and_off", () => VoiceOnOff(sampleJson)),
                new KeyValuePair<string, Action>("Switch_and_voice_stay_synchronised", () => SwitchSync(sampleJson)),
                new KeyValuePair<string, Action>("Rooms_resolution", () => RoomResolution(sampleJson)),
                new KeyValuePair<string, Action>("Voice_fan", () => VoiceFan(sampleJson)),
                new KeyValuePair<string, Action>("Master_light_fallback", MasterFallback),
                new KeyValuePair<string, Action>("Locator", () => LocatorTests(sampleJson)),
                new KeyValuePair<string, Action>("Calibration", () => CalibrationTests(sampleJson)),
                new KeyValuePair<string, Action>("No_duplicate_state", () => NoDuplicates(sampleJson)),
                new KeyValuePair<string, Action>("Master_switch_all_on_off", () => MasterSwitch(sampleJson)),
                new KeyValuePair<string, Action>("Parser_automation_and_panel_commands", ParserAutomationPanel),
                new KeyValuePair<string, Action>("Voice_status_board", VoiceBoard),
                new KeyValuePair<string, Action>("Panel_model_follows_shared_state", () => PanelModelTests(sampleJson)),
                new KeyValuePair<string, Action>("Auto_light_enter_leave", () => AutoEnterLeave(sampleJson)),
                new KeyValuePair<string, Action>("Auto_light_manual_override", () => AutoManualOverride(sampleJson)),
                new KeyValuePair<string, Action>("Auto_light_enable_disable", () => AutoEnableDisable(sampleJson)),
                new KeyValuePair<string, Action>("Energy_simulation", () => EnergyTests(sampleJson)),
            };
            foreach (var t in tests)
            {
                int before = fails.Count;
                Run(t.Key, t.Value);
                if (fails.Count == before) r.Passed.Add(t.Key);
            }
            r.Tests = tests.Count; r.Checks = checks; r.Failures = fails;
            return r;
        }

        // ------------------------------------------------------------------------------------------------------------------------------------------
        static void MiniJsonTests()
        {
            var o = MiniJson.Obj(MiniJson.Parse("{\"a\":[1,2.5,-3e2],\"b\":{\"c\":\"x\\ny\\u0041\"},\"d\":true,\"e\":null}"));
            Eq(3, MiniJson.Arr(o["a"]).Count, "array length");
            Near(-300, MiniJson.Num(MiniJson.Arr(o["a"])[2]), 1e-9, "exponent");
            Eq("x\nyA", MiniJson.Str(MiniJson.Get(MiniJson.Obj(o["b"]), "c")), "escapes");
            T(MiniJson.Bool(o["d"]), "true"); T(o["e"] == null, "null");
            foreach (var bad in new[] { "{", "[1,", "{\"a\" 1}", "tru", "{\"a\":1} x", "" })
            {
                bool threw = false; try { MiniJson.Parse(bad); } catch (FormatException) { threw = true; }
                T(threw, "rejects '" + bad + "'");
            }
        }

        static void DocumentTests(string json)
        {
            var d = SmartHouseDocument.FromJson(json);
            T(d.Rooms.Count > 5, "rooms parsed");
            T(d.WallHeightFt >= 8.86 && d.WallHeightFt <= 14, "wall height");
            foreach (var r in d.Rooms)
            {
                T(r.CeilingY > r.FloorY, r.Id + " ceiling above floor");
                T(r.Contains(r.LightPos.X, r.LightPos.Z), r.Id + " light inside the room");
                if (r.Fan != null) T(r.Fan.BladePlaneAboveFloorFt >= 7.25, r.Id + " blades high enough");
                if (r.Switch != null) T(Math.Abs(r.Switch.Pos.Y - r.FloorY - 4.0) < 0.01, r.Id + " switch height");
            }
            T(d.Rooms.Any(r => r.Fan != null), "some rooms have a fan");
            bool threw = false;
            try { SmartHouseDocument.FromJson("{\"schema\":\"something/1\"}"); } catch (FormatException) { threw = true; }
            T(threw, "wrong schema rejected");
            threw = false;
            try { SmartHouseDocument.FromJson("{\"schema\":\"realestate.smart-house/2\",\"rooms\":[]}"); } catch (FormatException e) { threw = e.Message.Contains("Unsupported"); }
            T(threw, "future schema rejected with a clear message");
            threw = false;
            try { SmartHouseDocument.FromJson("{\"schema\":\"realestate.smart-house/1\",\"rooms\":[]}"); } catch (FormatException) { threw = true; }
            T(threw, "empty room list rejected");
            threw = false;
            try { SmartHouseDocument.FromJson("{\"schema\":\"realestate.smart-house/1\",\"rooms\":[{\"id\":\"a\",\"floor\":0},{\"id\":\"a\",\"floor\":0}]}"); } catch (FormatException) { threw = true; }
            T(threw, "duplicate rooms rejected");
        }

        // ---- fan ---------------------------------------------------------------------------------------------------------------------------------
        static double SteadyVelocity(int level)
        {
            var f = new FanModel(new FanSpec()); f.SetLevel(level);
            for (int i = 0; i < 60 * 30; i++) f.Tick(1 / 60.0);       // 30 s
            return f.VelocityDegPerSec;
        }

        static void FanLevels()
        {
            var v = Enumerable.Range(0, 6).Select(SteadyVelocity).ToArray();
            Eq(0.0, v[0], "level 0 does not rotate");
            for (int i = 1; i <= 5; i++) T(v[i] > v[i - 1], "level " + i + " (" + v[i] + " deg/s) is faster than level " + (i - 1) + " (" + v[i - 1] + ")");
            var spec = new FanSpec();
            for (int i = 0; i <= 5; i++) Near(spec.Rpm[i] * 6, v[i], 1e-9, "level " + i + " reaches its configured speed");
            // the speed ordering also holds during the first seconds (it is not only the final speed)
            var a = new FanModel(spec); var b = new FanModel(spec); a.SetLevel(1); b.SetLevel(2);
            for (int i = 0; i < 120; i++) { a.Tick(1 / 60.0); b.Tick(1 / 60.0); }
            T(b.TotalDeg > a.TotalDeg, "level 2 has turned further than level 1 after 2 s");
        }

        static void FanStops()
        {
            var f = new FanModel(new FanSpec());
            f.SetLevel(5);
            for (int i = 0; i < 600; i++) f.Tick(1 / 60.0);
            T(f.VelocityDegPerSec > 1000, "spinning at level 5");
            f.SetLevel(0);
            double t = 0;
            while (f.VelocityDegPerSec > 0 && t < 30) { f.Tick(1 / 60.0); t += 1 / 60.0; }
            Eq(0.0, f.VelocityDegPerSec, "velocity is exactly zero");
            T(t < 6, "brakes to a stop within 6 s (took " + t + ")");
            double angle = f.TotalDeg;
            for (int i = 0; i < 600; i++) f.Tick(1 / 60.0);
            Eq(angle, f.TotalDeg, "no rotation once stopped");
            T(f.IsStopped, "IsStopped");
            var idle = new FanModel(new FanSpec());
            for (int i = 0; i < 100; i++) idle.Tick(0.016);
            Eq(0.0, idle.TotalDeg, "a fan that was never switched on does not turn");
        }

        static void FanFrameRate()
        {
            double reference = double.NaN;
            foreach (int fps in new[] { 1, 15, 30, 60, 72, 90, 120, 144, 1000 })
            {
                var f = new FanModel(new FanSpec());
                f.SetLevel(4);
                int n = 10 * fps;                                   // 10 s
                for (int i = 0; i < n; i++) f.Tick(1.0 / fps);
                if (double.IsNaN(reference)) reference = f.TotalDeg;
                Near(reference, f.TotalDeg, 1e-6, "angle after 10 s at " + fps + " fps");
            }
            // a change of level in the middle of the run is also independent of the step
            double r2 = double.NaN;
            foreach (int fps in new[] { 30, 90, 144 })
            {
                var f = new FanModel(new FanSpec());
                f.SetLevel(5);
                for (int i = 0; i < 3 * fps; i++) f.Tick(1.0 / fps);
                f.SetLevel(2);
                for (int i = 0; i < 4 * fps; i++) f.Tick(1.0 / fps);
                if (double.IsNaN(r2)) r2 = f.TotalDeg;
                Near(r2, f.TotalDeg, 1e-6, "angle with a level change at " + fps + " fps");
            }
        }

        static void FanSmooth()
        {
            var spec = new FanSpec();
            var f = new FanModel(spec);
            f.SetLevel(5);
            double prev = 0, maxStep = 0;
            for (int i = 0; i < 600; i++)
            {
                f.Tick(1 / 90.0);
                maxStep = Math.Max(maxStep, Math.Abs(f.VelocityDegPerSec - prev));
                prev = f.VelocityDegPerSec;
            }
            T(maxStep <= spec.AccelDegPerSec2 / 90.0 + 1e-9, "velocity never jumps by more than accel * dt (" + maxStep + ")");
            // 300 rpm = 1800 deg/s = 20 deg per frame at 90 Hz: below half the spacing of a 5-blade fan (36 deg), so no stroboscopic reversal
            T(spec.DegPerSec(5) / 90.0 < 36, "level 5 per-frame rotation below the blade spacing at 90 Hz");
        }

        static void FanSpecTests()
        {
            foreach (var bad in new Action<FanSpec>[] { s => s.Rpm = new double[] { 0, 1, 2 }, s => s.Rpm = new double[] { 5, 10, 20, 30, 40, 50 }, s => s.Rpm = new double[] { 0, 90, 90, 190, 240, 300 }, s => s.AccelDegPerSec2 = 0 })
            {
                var s = new FanSpec(); bad(s);
                bool threw = false; try { new FanModel(s); } catch (ArgumentException) { threw = true; }
                T(threw, "invalid spec rejected");
            }
            Eq(5, FanSpec.Clamp(99), "clamp high"); Eq(0, FanSpec.Clamp(-3), "clamp low");
            var f = new FanModel(new FanSpec()); f.SetLevel(99); Eq(5, f.Level, "level clamped to 5");
            Eq(0.0, f.Tick(-1), "negative dt ignored"); Eq(0.0, f.Tick(double.NaN), "NaN dt ignored");
        }

        // ---- parser ------------------------------------------------------------------------------------------------------------------------------
        static void ParserRequired()
        {
            var c = VoiceCommandParser.Parse("Turn on the light.");
            Eq(CommandKind.LightOn, c.Kind, "turn on the light"); Eq(RoomScope.Current, c.Room.Scope, "current room");
            c = VoiceCommandParser.Parse("Turn off the light.");
            Eq(CommandKind.LightOff, c.Kind, "turn off the light");
            c = VoiceCommandParser.Parse("Turn on the living room light.");
            Eq(CommandKind.LightOn, c.Kind, "living room on"); Eq(RoomScope.Type, c.Room.Scope, "typed scope"); T(c.Room.Types.Contains("living_room"), "living_room");
            c = VoiceCommandParser.Parse("Turn off the bedroom light.");
            Eq(CommandKind.LightOff, c.Kind, "bedroom off"); T(c.Room.Types.Contains("bedroom") && c.Room.Types.Contains("master_bedroom"), "bedroom types");
            c = VoiceCommandParser.Parse("Turn on all lights.");
            Eq(CommandKind.LightOn, c.Kind, "all on"); Eq(RoomScope.All, c.Room.Scope, "all scope");
            c = VoiceCommandParser.Parse("Turn off all lights.");
            Eq(CommandKind.LightOff, c.Kind, "all off"); Eq(RoomScope.All, c.Room.Scope, "all scope");
        }

        static void ParserVariants()
        {
            Action<string, CommandKind, RoomScope> e = (s, k, sc) => { var q = VoiceCommandParser.Parse(s); Eq(k, q.Kind, "'" + s + "' kind"); Eq(sc, q.Room.Scope, "'" + s + "' scope"); };
            e("please turn on the light", CommandKind.LightOn, RoomScope.Current);
            e("TURN ON THE LIGHT!", CommandKind.LightOn, RoomScope.Current);
            e("switch off the kitchen lights", CommandKind.LightOff, RoomScope.Type);
            e("turn the bedroom light on", CommandKind.LightOn, RoomScope.Type);
            e("lights out", CommandKind.LightOff, RoomScope.Current);
            e("lights on", CommandKind.LightOn, RoomScope.Current);
            e("turn on every light", CommandKind.LightOn, RoomScope.All);
            e("turn off the lights in the whole house", CommandKind.LightOff, RoomScope.All);
            e("turn on the dining room light", CommandKind.LightOn, RoomScope.Type);
            e("turn on the drawing room light", CommandKind.LightOn, RoomScope.Type);
            e("switch on the bathroom light", CommandKind.LightOn, RoomScope.Type);
            var c = VoiceCommandParser.Parse("turn on the master bedroom light");
            T(c.Room.Types.Count == 1 && c.Room.Types[0] == "master_bedroom", "master bedroom is not every bedroom");
            c = VoiceCommandParser.Parse("turn on bedroom 2 light"); Eq(2, c.Room.Ordinal, "bedroom 2 digit");
            c = VoiceCommandParser.Parse("turn off the second bedroom light"); Eq(2, c.Room.Ordinal, "second bedroom");
            c = VoiceCommandParser.Parse("turn on bedroom number three light"); Eq(3, c.Room.Ordinal, "bedroom number three");
            c = VoiceCommandParser.Parse("turn on the first floor bedroom light"); Eq(1, c.Room.FloorMin, "first floor"); Eq(1, c.Room.FloorMax, "first floor max"); Eq(0, c.Room.Ordinal, "first floor is not 'first bedroom'");
            c = VoiceCommandParser.Parse("turn off all lights upstairs"); Eq(RoomScope.All, c.Room.Scope, "upstairs all"); Eq(1, c.Room.FloorMin, "upstairs min");
            c = VoiceCommandParser.Parse("turn off the ground floor light"); Eq(0, c.Room.FloorMax, "ground floor");
        }

        static void ParserFan()
        {
            Action<string, CommandKind, int> e = (s, k, lvl) => { var q = VoiceCommandParser.Parse(s); Eq(k, q.Kind, "'" + s + "' kind"); if (k == CommandKind.FanSet) Eq(lvl, q.Level, "'" + s + "' level"); };
            e("fan speed three", CommandKind.FanSet, 3);
            e("set the fan to level 5", CommandKind.FanSet, 5);
            e("set the fan to speed 1", CommandKind.FanSet, 1);
            e("fan speed zero", CommandKind.FanSet, 0);
            e("fan speed for", CommandKind.FanSet, 4);
            e("turn the fan to maximum", CommandKind.FanSet, 5);
            e("set the fan to minimum", CommandKind.FanSet, 1);
            e("turn off the fan", CommandKind.FanOff, 0);
            e("turn on the fan", CommandKind.FanOn, 0);
            e("make the fan faster", CommandKind.FanFaster, 0);
            e("slow the fan down", CommandKind.FanSlower, 0);
            var c = VoiceCommandParser.Parse("turn on the bedroom two fan");
            Eq(CommandKind.FanOn, c.Kind, "bedroom two fan is 'on', not 'speed two'"); Eq(2, c.Room.Ordinal, "ordinal");
            c = VoiceCommandParser.Parse("set bedroom two fan to speed three");
            Eq(CommandKind.FanSet, c.Kind, "set"); Eq(3, c.Level, "level 3"); Eq(2, c.Room.Ordinal, "room 2");
            c = VoiceCommandParser.Parse("turn on all fans"); Eq(RoomScope.All, c.Room.Scope, "all fans");
        }

        static void ParserNonsense()
        {
            foreach (var s in new[] { "", "   ", "what is the weather", "turn on the music", "turn on the kitchen", "play something", null })
                Eq(CommandKind.Unknown, VoiceCommandParser.Parse(s).Kind, "'" + s + "' is not a command");
        }

        // ---- state -------------------------------------------------------------------------------------------------------------------------------
        static SmartHouseState Load(string json, out SmartHouseDocument doc)
        {
            doc = SmartHouseDocument.FromJson(json);
            return SmartHouseState.FromDocument(doc);
        }

        static string KeyOfType(SmartHouseDocument d, string type, int skip = 0) { return SmartHouseDocument.Key(d.Rooms.Where(r => r.Type == type).Skip(skip).First()); }

        static void VoiceOnOff(string json)
        {
            SmartHouseDocument d; var s = Load(json, out d);
            string living = KeyOfType(d, "living_room");
            var events = new List<string>();
            s.Lights.Changed += (k, on, src) => events.Add(k + ":" + on + ":" + src);
            // acceptance 1 and 2: a voice command turns the light on and off
            s.CurrentRoomKey = living;
            var r = s.Execute("Turn on the light.");
            T(r.Understood && r.Changed, "understood and changed"); T(s.Lights.IsOn(living), "light is ON after the voice command");
            Eq(1, events.Count, "one event"); T(events[0].EndsWith(":Voice"), "source is voice");
            T(r.Message.Contains("ON"), "feedback says ON: " + r.Message);
            r = s.Execute("Turn off the light.");
            T(!s.Lights.IsOn(living), "light is OFF after the voice command"); T(r.Message.Contains("OFF"), "feedback says OFF: " + r.Message);
            // already in that state: no event, says so
            events.Clear();
            r = s.Execute("turn off the light");
            T(!r.Changed && events.Count == 0, "no change, no event"); T(r.Message.Contains("already"), "says already: " + r.Message);
            // no idea where the player is: asks instead of guessing
            s.CurrentRoomKey = null;
            r = s.Execute("turn on the light");
            T(r.Understood && !r.Changed && r.Message.StartsWith("Say which room"), "asks for a room: " + r.Message); Eq(0, s.Lights.OnCount, "nothing was switched");
            r = s.Execute("turn on the living room light");
            T(s.Lights.IsOn(living), "named room works anywhere");
            r = s.Execute("Turn on all lights.");
            Eq(d.Rooms.Count, s.Lights.OnCount, "all lights on"); T(r.Message.StartsWith("All "), "message: " + r.Message);
            s.Execute("Turn off all lights.");
            Eq(0, s.Lights.OnCount, "all lights off");
        }

        static void SwitchSync(string json)
        {
            SmartHouseDocument d; var s = Load(json, out d);
            string kitchen = KeyOfType(d, "kitchen");
            var src = new List<ControlSource>();
            s.Lights.Changed += (k, on, x) => src.Add(x);
            // acceptance 3 and 4
            T(s.Lights.Toggle(kitchen, ControlSource.WallSwitch), "switch toggles");
            T(s.Lights.IsOn(kitchen), "on via switch");
            s.CurrentRoomKey = kitchen;
            s.Execute("turn off the light");
            T(!s.Lights.IsOn(kitchen), "voice turns off what the switch turned on (same light)");
            s.Execute("turn on the kitchen light");
            T(s.Lights.IsOn(kitchen), "voice on");
            s.Lights.Toggle(kitchen, ControlSource.WallSwitch);
            T(!s.Lights.IsOn(kitchen), "switch off what voice turned on");
            s.Lights.Toggle(kitchen, ControlSource.Panel);
            T(s.Lights.IsOn(kitchen), "panel on");
            s.Execute("lights out");
            T(!s.Lights.IsOn(kitchen), "voice off again");
            Eq(6, src.Count, "six real changes");
            Eq(ControlSource.WallSwitch, src[0], "first source"); Eq(ControlSource.Voice, src[1], "second source");
            // a switch of one room never changes another room
            string other = KeyOfType(d, "dining");
            s.Lights.Toggle(kitchen, ControlSource.WallSwitch);
            T(!s.Lights.IsOn(other), "other rooms untouched");
        }

        static void RoomResolution(string json)
        {
            SmartHouseDocument d; var s = Load(json, out d);
            var beds = d.Rooms.Where(r => r.Type == "bedroom" || r.Type == "master_bedroom").ToList();
            var r1 = s.Execute("turn on the bedroom light");
            Eq(beds.Count, r1.RoomKeys.Count, "'bedroom' means every bedroom"); T(r1.Message.Contains(beds.Count.ToString()), "message counts them: " + r1.Message);
            s.Execute("turn off all lights");
            var m = s.Execute("turn on the master bedroom light");
            Eq(1, m.RoomKeys.Count, "master bedroom only"); Eq("Master Bedroom light ON", m.Message, "message");
            var b2 = s.Execute("turn on bedroom 2 light");
            Eq(1, b2.RoomKeys.Count, "bedroom 2 only"); T(b2.Message.StartsWith("Bedroom 2"), "named by its own number: " + b2.Message);
            var missing = s.Execute("turn on bedroom five light");
            T(missing.Understood && !missing.Changed && missing.RoomKeys.Count == 0, "a room that does not exist changes nothing: " + missing.Message);
            var up = s.Execute("turn on all lights upstairs");
            T(up.RoomKeys.Count > 0 && up.RoomKeys.All(k => s.Lights.Get(k).Floor >= 1), "upstairs only");
            var ground = s.Execute("turn off the ground floor lights");
            T(ground.RoomKeys.All(k => s.Lights.Get(k).Floor == 0), "ground floor only");
        }

        static void VoiceFan(string json)
        {
            SmartHouseDocument d; var s = Load(json, out d);
            var withFan = d.Rooms.First(r => r.Fan != null);
            string key = SmartHouseDocument.Key(withFan);
            var levels = new List<int>();
            s.FanLevelChanged += (k, l, src) => levels.Add(l);
            s.CurrentRoomKey = key;
            s.Execute("turn on the fan"); Eq(s.Spec.DefaultOnLevel, s.FanLevel(key), "on = default level");
            s.Execute("fan speed five"); Eq(5, s.FanLevel(key), "speed five");
            s.Execute("make the fan slower"); Eq(4, s.FanLevel(key), "slower");
            s.Execute("fan faster"); Eq(5, s.FanLevel(key), "faster");
            s.Execute("fan faster"); Eq(5, s.FanLevel(key), "faster is capped at 5");
            s.Execute("turn off the fan"); Eq(0, s.FanLevel(key), "off");
            Eq(6 - 1, levels.Count, "an event per real change (the capped one raised none)");
            // the fan view follows the model: after enough time the blades turn at that level's speed
            s.Execute("fan speed two");
            for (int i = 0; i < 1000; i++) s.Tick(0.01);
            Near(s.Spec.DegPerSec(2), s.Fan(key).VelocityDegPerSec, 1e-9, "level 2 speed reached");
            // a room without a fan says so
            var bath = d.Rooms.First(r => r.Type == "bathroom");
            s.CurrentRoomKey = SmartHouseDocument.Key(bath);
            var res = s.Execute("turn on the fan");
            T(res.Understood && !res.Changed && res.Message.Contains("No ceiling fan"), "no fan in the bathroom: " + res.Message);
            // every fan, by voice
            s.Execute("turn on all fans");
            foreach (var k in s.FanKeys) T(s.FanLevel(k) > 0, "all fans on: " + k);
        }

        static void MasterFallback()
        {
            var s = SmartHouseState.Master();
            Eq(1, s.Lights.Rooms.Count, "one master light");
            s.Execute("turn on the light"); T(s.Lights.IsOn("master"), "master on");
            s.Execute("turn off the bedroom light"); T(!s.Lights.IsOn("master"), "any room phrase reaches the master light");
            var r = s.Execute("turn on all lights"); T(s.Lights.IsOn("master") && r.Message.StartsWith("House light"), r.Message);
            r = s.Execute("fan speed three"); T(r.Understood && !r.Changed, "no fans in master mode: " + r.Message);
        }

        static void LocatorTests(string json)
        {
            SmartHouseDocument d; Load(json, out d);
            var loc = new RoomLocator(d);
            foreach (var r in d.Rooms)
                Eq(SmartHouseDocument.Key(r), (loc.Locate(r.CenterX, r.FloorY + 5.2, r.CenterZ) is string k && d.Rooms.First(q => SmartHouseDocument.Key(q) == k).Floor == r.Floor && d.Rooms.First(q => SmartHouseDocument.Key(q) == k).Contains(r.CenterX, r.CenterZ)) ? SmartHouseDocument.Key(r) : "?", "locate centre of " + r.Id);
            Eq((string)null, loc.Locate(-50, 5, -50), "outside the house");
            var g = d.Rooms.First(r => r.Floor == 0);
            Eq((string)null, loc.Locate(g.CenterX, g.CeilingY + 40, g.CenterZ), "far above the building");
        }

        static void CalibrationTests(string json)
        {
            SmartHouseDocument d; Load(json, out d);
            double x0 = d.Rooms.Min(r => r.X0), x1 = d.Rooms.Max(r => r.X1), z0 = d.Rooms.Min(r => r.Z0), z1 = d.Rooms.Max(r => r.Z1);
            foreach (MirrorAxis truth in new[] { MirrorAxis.X, MirrorAxis.Z })
            {
                double ax, ay, az, bx, by, bz;
                GltfSpace.ToUnity(truth, x0 - 3, 0, z0 - 3, out ax, out ay, out az);      // the model includes a 3 ft yard round the rooms
                GltfSpace.ToUnity(truth, x1 + 3, 0, z1 + 3, out bx, out by, out bz);
                var c = GltfSpace.Calibrate(d.Rooms, Math.Min(ax, bx), Math.Min(az, bz), Math.Max(ax, bx), Math.Max(az, bz));
                Eq(truth, c.Axis, "calibration finds the " + truth + " mirror");
                T(!c.Ambiguous, "unambiguous for an off-centre house (" + c.Message + ")");
            }
            // a house centred on the origin fits both: flagged ambiguous, never silently wrong
            var sym = new List<RoomData> { new RoomData { Id = "a", X0 = -10, X1 = 10, Z0 = -10, Z1 = 10 } };
            var amb = GltfSpace.Calibrate(sym, -4, -4, 4, 4);
            T(amb.Ambiguous, "symmetric house is ambiguous");
            double ux, uy, uz;
            GltfSpace.ToUnity(MirrorAxis.X, 10, 10, 10, out ux, out uy, out uz);
            foreach (MirrorAxis mm in new[] { MirrorAxis.X, MirrorAxis.Z })
            {
                double fx, fy, fz, gx, gy, gz;
                GltfSpace.ToUnity(mm, 12.5, 7.25, -3.75, out gx, out gy, out gz);
                GltfSpace.FromUnity(mm, gx, gy, gz, out fx, out fy, out fz);
                Near(12.5, fx, 1e-9, "round trip x " + mm); Near(7.25, fy, 1e-9, "round trip y " + mm); Near(-3.75, fz, 1e-9, "round trip z " + mm);
            }
            Near(-3.048, ux, 1e-9, "x mirrored, feet to metres"); Near(3.048, uy, 1e-9, "y"); Near(3.048, uz, 1e-9, "z kept");
        }

        static void NoDuplicates(string json)
        {
            SmartHouseDocument d; var s = Load(json, out d);
            bool threw = false;
            try { s.Lights.Add(new RoomInfo { Key = SmartHouseDocument.Key(d.Rooms[0]) }); } catch (InvalidOperationException) { threw = true; }
            T(threw, "a room cannot be added twice");
            threw = false; try { s.Lights.Set("nope", true, ControlSource.Code); } catch (KeyNotFoundException) { threw = true; }
            T(threw, "unknown light key rejected");
            // events: one handler subscribed once fires once per change
            int n = 0; Action<string, bool, ControlSource> h = (k, on, src) => n++;
            s.Lights.Changed += h;
            string key = SmartHouseDocument.Key(d.Rooms[0]);
            s.Lights.Set(key, true, ControlSource.Code); s.Lights.Set(key, true, ControlSource.Code);
            Eq(1, n, "setting the same state twice raises one event");
            s.Lights.Changed -= h;
            s.Lights.Set(key, false, ControlSource.Code);
            Eq(1, n, "unsubscribed handler is silent");
        }
    }
}
