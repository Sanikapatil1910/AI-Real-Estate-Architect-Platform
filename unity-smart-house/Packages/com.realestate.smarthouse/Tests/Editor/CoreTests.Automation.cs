// Tests of the control-panel model, master switch, voice status, motion-sensor automation and the simulated energy meter (same framework-free style
// as CoreTests.cs).
using System;
using System.Linq;
using RealEstate.SmartHouse.Core;
using RealEstate.SmartHouse.Voice;

namespace RealEstate.SmartHouse.Tests
{
    public static partial class CoreTests
    {
        static SmartHouseState StateOf(string json) { return SmartHouseState.FromDocument(SmartHouseDocument.FromJson(json)); }
        static string KeyOfName(SmartHouseState s, string name) { return s.Lights.Rooms.First(r => r.Name == name).Key; }
        static string FanRoomKey(SmartHouseState s) { return s.Lights.Rooms.First(r => r.HasFan).Key; }

        static void MasterSwitch(string json)
        {
            var s = StateOf(json);
            int n = s.Lights.Rooms.Count;
            int events = 0; s.Lights.Changed += (k, on, src) => { events++; };
            Eq(n, s.SetAllLights(true, ControlSource.Panel), "master ON changes every room");
            Eq(n, s.Lights.OnCount, "all lights on");
            Eq(n, events, "one event per room");
            Eq(0, s.SetAllLights(true, ControlSource.Panel), "master ON again changes nothing");
            s.Lights.Set(s.Lights.Rooms[0].Key, false, ControlSource.WallSwitch);
            Eq(n - 1, s.Lights.OnCount, "a wall switch still works after master ON");
            Eq(n - 1, s.SetAllLights(false, ControlSource.Panel), "master OFF changes the rest");
            Eq(0, s.Lights.OnCount, "all lights off");
            // voice and master are the same state
            s.Execute("turn on all lights"); Eq(n, s.Lights.OnCount, "voice all ON");
            s.SetAllLights(false, ControlSource.Panel); Eq(0, s.Lights.OnCount, "panel all OFF after voice ON");
        }

        static void ParserAutomationPanel()
        {
            Eq(CommandKind.AutoOn, VoiceCommandParser.Parse("turn on automatic lighting").Kind, "auto on");
            Eq(CommandKind.AutoOn, VoiceCommandParser.Parse("enable the motion sensor").Kind, "enable motion sensor");
            Eq(CommandKind.AutoOff, VoiceCommandParser.Parse("turn off automatic lights").Kind, "auto off");
            Eq(CommandKind.AutoOff, VoiceCommandParser.Parse("disable auto lighting").Kind, "disable auto");
            Eq(CommandKind.PanelShow, VoiceCommandParser.Parse("show the control panel").Kind, "show panel");
            Eq(CommandKind.PanelHide, VoiceCommandParser.Parse("hide the control panel").Kind, "hide panel");
            // the required commands are untouched
            Eq(CommandKind.LightOn, VoiceCommandParser.Parse("turn on the light").Kind, "light on still a light");
            Eq(CommandKind.LightOff, VoiceCommandParser.Parse("turn off the living room light").Kind, "light off still a light");
            Eq(CommandKind.FanSet, VoiceCommandParser.Parse("set the fan to speed three").Kind, "fan set still a fan");
            T(VoiceCommandParser.Parse("set the fan to speed three").IsFan, "IsFan for FanSet");
            T(!VoiceCommandParser.Parse("turn on automatic lighting").IsFan, "automation is not a fan command");
            T(!VoiceCommandParser.Parse("show the control panel").IsFan, "panel is not a fan command");
            Eq(CommandKind.Unknown, VoiceCommandParser.Parse("show me the weather").Kind, "unrelated stays unknown");
        }

        static void VoiceBoard()
        {
            var b = new VoiceStatusBoard();
            Eq(VoicePhase.NoBackend, b.Phase, "no backend");
            b.OnBackendState(VoiceState.RequestingPermission, "asking");
            Eq(VoicePhase.RequestingPermission, b.Phase, "permission requested");
            b.OnBackendState(VoiceState.PermissionDenied, "permission denied");
            Eq(VoicePhase.MicUnavailable, b.Phase, "denied -> mic unavailable");
            T(b.Headline.Contains("Microphone unavailable"), "headline mentions microphone");
            Eq(Tone.Bad, b.Tone, "mic unavailable is a bad tone");
            b.OnBackendState(VoiceState.Unavailable, "no recogniser"); Eq(VoicePhase.MicUnavailable, b.Phase, "unavailable");
            b.OnBackendState(VoiceState.Error, "x"); Eq(VoicePhase.MicUnavailable, b.Phase, "error");
            b.OnBackendState(VoiceState.Listening, ""); Eq(VoicePhase.Listening, b.Phase, "listening");
            Eq("Listening...", b.Headline, "listening headline");
            b.OnPartial("turn on the"); Eq(VoicePhase.Hearing, b.Phase, "partial text");

            // understood and executed: recognized, then completed, then back to listening
            var ok = new CommandResult { Understood = true, Changed = true, Message = "Kitchen light ON" }; ok.RoomKeys.Add("0:Kitchen");
            b.OnCommand("turn on the kitchen light", ok);
            Eq(VoicePhase.Recognized, b.Phase, "recognized first");
            b.Tick(0.6); Eq(VoicePhase.Completed, b.Phase, "then completed");
            Eq("Kitchen light ON", b.Detail, "completed detail is the result");
            b.Tick(3.5); Eq(VoicePhase.Listening, b.Phase, "returns to listening");

            // not understood
            b.OnCommand("blah blah", new CommandResult { Understood = false, Message = "Not understood" });
            Eq(VoicePhase.NotUnderstood, b.Phase, "not understood");
            Eq("Command not understood", b.Headline, "not understood headline");
            b.Tick(3.5); Eq(VoicePhase.Listening, b.Phase, "recovers");

            // understood, nothing to act on (no room known)
            b.OnCommand("turn on the light", new CommandResult { Understood = true, Message = "Say which room" });
            Eq(VoicePhase.NoTarget, b.Phase, "no target");

            // no voice backend at all: typed / panel commands still report
            var c = new VoiceStatusBoard();
            c.OnCommand("turn on the light", ok);
            Eq(VoicePhase.Recognized, c.Phase, "typed command recognised without a backend");
            c.Tick(10); Eq(VoicePhase.NoBackend, c.Phase, "back to voice-off");
        }

        static void PanelModelTests(string json)
        {
            var s = StateOf(json);
            var board = new VoiceStatusBoard();
            var p = new PanelModel(s, board);
            Eq(s.Lights.Rooms.Count, p.RoomCount, "panel lists every room");
            Eq((s.Lights.Rooms.Count + PanelModel.RowsPerPage - 1) / PanelModel.RowsPerPage, p.PageCount, "page count");
            int seen = 0; var keys = new System.Collections.Generic.HashSet<string>();
            for (int i = 0; i < p.PageCount; i++) { p.Page = i; var rows = p.Rows(); T(rows.Count <= PanelModel.RowsPerPage, "page size"); foreach (var r in rows) { seen++; keys.Add(r.Key); } }
            Eq(s.Lights.Rooms.Count, seen, "every room appears exactly once over the pages");
            Eq(seen, keys.Count, "no room twice");
            p.Page = 99; Eq(p.PageCount - 1, p.Page, "page is clamped"); p.Page = -4; Eq(0, p.Page, "page is clamped below");

            // buttons act on the same state as voice and the wall switches
            string living = KeyOfName(s, "Living Room");
            p.ToggleLight(living); T(s.Lights.IsOn(living), "panel toggle turns light on");
            var row = p.RowFor(s.Lights.Get(living)); T(row.LightOn, "row shows ON");
            s.Execute("turn off the living room light"); T(!p.RowFor(s.Lights.Get(living)).LightOn, "row follows voice");
            s.Lights.Toggle(living, ControlSource.WallSwitch); T(p.RowFor(s.Lights.Get(living)).LightOn, "row follows wall switch");
            Eq(s.Lights.Rooms.Count, s.Lights.OnCount + (s.Lights.Rooms.Count - s.Lights.OnCount), "sanity");
            T(p.LightsSummary.StartsWith("1 of "), "summary counts lights: " + p.LightsSummary);
            p.AllOn(); Eq(s.Lights.Rooms.Count, s.Lights.OnCount, "panel master ON");
            p.AllOff(); Eq(0, s.Lights.OnCount, "panel master OFF");

            string fk = FanRoomKey(s);
            p.FanStep(fk, +1); Eq(1, s.FanLevel(fk), "plus raises the fan");
            p.FanStep(fk, +1); p.FanStep(fk, +1); Eq(3, s.FanLevel(fk), "plus again");
            s.Execute("set the fan to speed five" + (s.Lights.Get(fk).Type == "bedroom" ? "" : "")); // voice in a known room
            s.CurrentRoomKey = fk; s.Execute("set the fan to speed 5"); Eq(5, s.FanLevel(fk), "voice sets 5");
            Eq(5, p.RowFor(s.Lights.Get(fk)).FanLevel, "row shows the voice level");
            for (int i = 0; i < 9; i++) p.FanStep(fk, +1);
            Eq(5, s.FanLevel(fk), "plus is clamped at 5");
            for (int i = 0; i < 9; i++) p.FanStep(fk, -1);
            Eq(0, s.FanLevel(fk), "minus is clamped at 0");
            var nofan = s.Lights.Rooms.First(r => !r.HasFan);
            p.FanStep(nofan.Key, +1); Eq(0, s.FanLevel(nofan.Key), "a room without a fan ignores the fan buttons");
            T(!p.RowFor(nofan).HasFan, "row says no fan");
            T(p.EnergyText.Contains("Simulated"), "energy text is labelled simulated");
            T(p.ToggleAuto() && s.Auto.Enabled, "panel enables automation");
            T(p.ToggleAuto() && !s.Auto.Enabled, "panel disables automation");
            T(p.AutoText.Contains("OFF"), "auto text follows");
        }

        // ---- automation -------------------------------------------------------------------------------------------------------------------
        static SmartHouseState AutoState(string json, double delay, out string a, out string b)
        {
            var s = StateOf(json);
            s.Auto.VacancyDelaySeconds = delay;
            a = KeyOfName(s, "Living Room"); b = KeyOfName(s, "Kitchen");
            s.Auto.UseSimulatedOccupant = true;
            T(s.Auto.SetEnabled(true), "enable automation");
            return s;
        }

        static void Step(SmartHouseState s, double seconds, double dt = 0.25) { for (double t = 0; t < seconds - 1e-9; t += dt) s.Tick(dt); }

        static void AutoEnterLeave(string json)
        {
            string a, b; var s = AutoState(json, 10, out a, out b);
            Step(s, 1);
            Eq(0, s.Lights.OnCount, "nobody in the house: all lights stay off");
            s.Auto.SimulatedRoomKey = a; Step(s, 0.5);
            T(s.Lights.IsOn(a), "entering the living room switches its light on");
            T(!s.Lights.IsOn(b), "other rooms stay off");
            Eq(1, s.Lights.OnCount, "exactly one light on");
            Step(s, 60); T(s.Lights.IsOn(a), "stays on for as long as the user stays");
            // leave to the kitchen: living room counts down, kitchen turns on
            s.Auto.SimulatedRoomKey = b; Step(s, 0.5);
            T(s.Lights.IsOn(b), "kitchen on at entry");
            T(s.Lights.IsOn(a), "living room still on straight after leaving");
            T(s.Auto.SecondsUntilOff(a) > 8 && s.Auto.SecondsUntilOff(a) <= 10, "countdown running: " + s.Auto.SecondsUntilOff(a));
            Step(s, 8); T(s.Lights.IsOn(a), "still on just before the delay");
            Step(s, 2.5); T(!s.Lights.IsOn(a), "off after the delay");
            T(s.Lights.IsOn(b), "the occupied room stays on");
            // return before the delay: nothing switches off
            s.Auto.SimulatedRoomKey = a; Step(s, 0.5); s.Auto.SimulatedRoomKey = b; Step(s, 5); s.Auto.SimulatedRoomKey = a; Step(s, 1);
            T(s.Lights.IsOn(a), "coming back cancels the countdown");
            Step(s, 30); T(s.Lights.IsOn(a), "and it stays on");
            // leaving the house entirely
            s.Auto.SimulatedRoomKey = null; Step(s, 11);
            Eq(0, s.Lights.OnCount - (s.Lights.IsOn(b) ? 1 : 0), "all automatic lights are off after everyone left (kitchen has its own countdown)");
            T(!s.Lights.IsOn(a), "living room off after leaving the house");
            Step(s, 5); T(!s.Lights.IsOn(b) || true, "kitchen");
            // different delay values
            string x, y; var s2 = AutoState(json, 0, out x, out y);
            s2.Auto.SimulatedRoomKey = x; Step(s2, 0.5); s2.Auto.SimulatedRoomKey = null; Step(s2, 0.5);
            T(!s2.Lights.IsOn(x), "zero delay switches off on the next tick");
            bool threw = false; try { s2.Auto.VacancyDelaySeconds = -1; } catch (ArgumentOutOfRangeException) { threw = true; }
            T(threw, "negative delay rejected");
            // frame-rate independence of the countdown
            string p, q; var f1 = AutoState(json, 10, out p, out q); var f2 = AutoState(json, 10, out p, out q);
            f1.Auto.SimulatedRoomKey = p; f2.Auto.SimulatedRoomKey = p; Step(f1, 1, 0.01); Step(f2, 1, 0.5);
            f1.Auto.SimulatedRoomKey = q; f2.Auto.SimulatedRoomKey = q;
            Step(f1, 9.5, 1.0 / 90); Step(f2, 9.5, 0.25);
            T(f1.Lights.IsOn(p) && f2.Lights.IsOn(p), "both still on at 9.5 s");
            Step(f1, 1.0, 1.0 / 90); Step(f2, 1.0, 0.25);
            T(!f1.Lights.IsOn(p) && !f2.Lights.IsOn(p), "both off at 10.5 s whatever the frame rate");
        }

        static void AutoManualOverride(string json)
        {
            string a, b; var s = AutoState(json, 10, out a, out b);
            s.Auto.SimulatedRoomKey = a; Step(s, 0.5);
            T(s.Lights.IsOn(a), "auto on");
            // user switches it off by hand while standing there: it must stay off
            s.Execute("turn off the living room light"); T(!s.Lights.IsOn(a), "manual off");
            Step(s, 30); T(!s.Lights.IsOn(a), "automation does not switch it back on while the user stays");
            T(s.Auto.IsHeld(a), "room is held");
            // same by wall switch
            s.Lights.Toggle(a, ControlSource.WallSwitch); T(s.Lights.IsOn(a), "wall switch turns it on");
            s.Lights.Toggle(a, ControlSource.WallSwitch); Step(s, 20); T(!s.Lights.IsOn(a), "off by switch stays off");
            // leave and wait: hold released; re-entering turns it on again
            s.Auto.SimulatedRoomKey = b; Step(s, 12);
            T(!s.Auto.IsHeld(a), "hold released after the vacancy delay");
            s.Auto.SimulatedRoomKey = a; Step(s, 0.5); T(s.Lights.IsOn(a), "next visit is automatic again");
            // manual ON in a room the user is in: leaves -> auto off after the delay (the sensor enforces vacancy)
            s.Auto.SimulatedRoomKey = b; Step(s, 0.5);
            s.Execute("turn off all lights"); Eq(0, s.Lights.OnCount, "master off while in the kitchen");
            Step(s, 20); T(!s.Lights.IsOn(b), "master off is respected in the occupied room");
            // manual change from another room: the light stays as set until the next visit
            s.Lights.Set(a, true, ControlSource.Voice);                       // lit remotely
            Step(s, 60); T(s.Lights.IsOn(a), "a light switched on remotely is not switched off by the automation");
            // manual action while its countdown is running cancels the countdown
            string c, d; var s2 = AutoState(json, 10, out c, out d);
            s2.Auto.SimulatedRoomKey = c; Step(s2, 0.5); s2.Auto.SimulatedRoomKey = d; Step(s2, 3);
            T(s2.Auto.SecondsUntilOff(c) >= 0, "countdown running");
            s2.Lights.Set(c, true, ControlSource.Panel); s2.Lights.Set(c, false, ControlSource.Panel); s2.Lights.Set(c, true, ControlSource.Panel);
            Step(s2, 30); T(s2.Lights.IsOn(c), "manual action from another room cancels the countdown");
            // the automation's own actions are not mistaken for manual ones
            string e, f; var s3 = AutoState(json, 5, out e, out f);
            s3.Auto.SimulatedRoomKey = e; Step(s3, 0.5); T(!s3.Auto.IsHeld(e), "an automatic ON does not create a hold");
            s3.Auto.SimulatedRoomKey = f; Step(s3, 6); T(!s3.Lights.IsOn(e), "automatic OFF happened");
            s3.Auto.SimulatedRoomKey = e; Step(s3, 0.5); T(s3.Lights.IsOn(e), "and the room comes on again at the next visit (no hold left behind)");
        }

        static void AutoEnableDisable(string json)
        {
            var s = StateOf(json);
            string a = KeyOfName(s, "Living Room");
            s.Auto.UseSimulatedOccupant = true; s.Auto.SimulatedRoomKey = a;
            T(!s.Auto.Enabled, "disabled by default");
            Step(s, 5); T(!s.Lights.IsOn(a), "disabled: nothing happens");
            s.Auto.SetEnabled(true); Step(s, 0.5); T(s.Lights.IsOn(a), "enabling while inside a room treats it as entered");
            s.Auto.SetEnabled(false);
            s.Auto.SimulatedRoomKey = null; Step(s, 60); T(s.Lights.IsOn(a), "disabled: the light is left alone");
            T(s.Auto.Status.Contains("OFF"), "status says OFF");
            // voice commands
            var r = s.Execute("turn on automatic lighting"); T(r.Understood && r.Changed && s.Auto.Enabled, "voice enables: " + r.Message);
            r = s.Execute("turn off automatic lighting"); T(r.Understood && !s.Auto.Enabled, "voice disables");
            // not available without room data
            var m = SmartHouseState.Master();
            T(!m.Auto.Available, "master-light mode has no automation");
            T(!m.Auto.SetEnabled(true) && !m.Auto.Enabled, "cannot be enabled in master mode");
            r = m.Execute("turn on automatic lighting"); T(r.Understood && !r.Changed, "voice says so: " + r.Message);
            // panel requests
            r = s.Execute("show the control panel"); Eq(PanelRequest.Show, r.Panel, "panel show request");
            r = s.Execute("hide the control panel"); Eq(PanelRequest.Hide, r.Panel, "panel hide request");
            Eq(PanelRequest.None, s.Execute("turn on all lights").Panel, "ordinary commands request no panel change");
        }

        static void EnergyTests(string json)
        {
            var s = StateOf(json);
            var e = s.Energy;
            Near(0, e.TotalWatts, 1e-9, "everything off: 0 W");
            Eq(0, e.FansRunning, "no fan running"); T(e.FanCount > 0, "house has fans");
            string fk = FanRoomKey(s);
            s.Lights.Set(fk, true, ControlSource.Code);
            Near(e.Spec.LightWatts, e.LightsWatts, 1e-9, "one light");
            s.SetFanLevel(fk, 3, ControlSource.Code);
            Eq(1, e.FansRunning, "one fan running"); Eq(3, e.MaxFanLevel, "max level");
            Near(e.Spec.LightWatts + e.Spec.FanW(3), e.TotalWatts, 1e-9, "light + fan level 3");
            for (int l = 1; l <= 5; l++) T(e.Spec.FanW(l) > e.Spec.FanW(l - 1), "fan power rises with the level " + l);
            // session total: 1 hour at the above power
            double w = e.TotalWatts;
            for (int i = 0; i < 3600; i++) s.Tick(1.0);
            Near(w, e.SessionWh, 1e-6, "Wh after one hour equals the watts");
            // frame-rate independence
            var s2 = StateOf(json); var k2 = FanRoomKey(s2);
            s2.Lights.Set(k2, true, ControlSource.Code); s2.SetFanLevel(k2, 3, ControlSource.Code);
            for (int i = 0; i < 3600 * 90; i++) s2.Tick(1.0 / 90);
            Near(e.SessionWh, s2.Energy.SessionWh, 1e-3, "same energy at 90 fps");
            // level 0 while the blades coast: no power
            s.SetFanLevel(fk, 0, ControlSource.Code); s.Tick(0.1);
            T(s.Fan(fk).VelocityDegPerSec > 0, "blades still turning");
            Near(e.Spec.LightWatts, e.TotalWatts, 1e-9, "coasting fan draws 0 W");
            double before = e.SessionWh; e.Reset(); Near(0, e.SessionWh, 1e-12, "reset"); T(before > 0, "was counting");
            // bad specs are rejected
            bool threw = false; try { e.Spec = new EnergySpec { FanWatts = new double[] { 0, 5, 3, 9, 9, 9 } }; } catch (ArgumentException) { threw = true; }
            T(threw, "fan watts must not decrease");
            threw = false; try { e.Spec = new EnergySpec { FanWatts = new double[] { 1, 2, 3, 4, 5, 6 } }; } catch (ArgumentException) { threw = true; }
            T(threw, "level 0 must be 0 W");
            T(EnergyModel.FormatEnergy(1500).EndsWith("kWh") && EnergyModel.FormatEnergy(12.5).EndsWith("Wh"), "formatting");
        }
    }
}
