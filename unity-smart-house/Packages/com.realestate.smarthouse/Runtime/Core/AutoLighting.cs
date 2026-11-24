// Optional motion-sensor style automation: entering a room switches its light ON, leaving it switches the light OFF after a delay.
//
// Rules (all of them are exercised by the tests):
//  1. Entering a room cancels its pending switch-off.  If its light is OFF and the room is not "held", the light goes ON (source Auto).
//  2. Leaving a room starts a vacancy countdown for it.  When the countdown reaches VacancyDelaySeconds the light goes OFF (source Auto) and the room's
//     hold is released.  Coming back before that cancels it.
//  3. Manual control always wins and automation never fights it:
//       - a light you switch OFF (voice, wall switch, panel) while you are in the room is "held" OFF: it is not switched back on while you stay;
//       - a light you change while you are NOT in the room stays as you set it (its countdown is cancelled) until you next enter and leave;
//       - no automatic action is ever taken in a room you are standing in, apart from the one switch-ON on entry.
//  4. Disabled (the default) the object does nothing and forgets every hold and timer; enabling treats the room you are in as just entered.
//  5. Not available in "master light" mode (a model without room data): there is no room to enter.
//
// Occupancy comes from the headset position (SmartHouseState.CurrentRoomKey).  It can be replaced by a simulated occupant (SimulatedRoomKey) for
// desktop tests; no real motion sensor hardware is involved.
using System;
using System.Collections.Generic;

namespace RealEstate.SmartHouse.Core
{
    public sealed class AutoLighting
    {
        readonly SmartHouseState state;
        readonly Dictionary<string, double> vacancy = new Dictionary<string, double>();   // room -> seconds vacant
        readonly HashSet<string> held = new HashSet<string>();
        string lastRoom;
        double delay = 30;
        bool enabled;

        /// <summary>(room key, light now on, why) after the automation changed a light.</summary>
        public event Action<string, bool> Acted;

        public AutoLighting(SmartHouseState s)
        {
            state = s;
            state.Lights.Changed += OnLightChanged;
        }

        public bool Available { get { return !state.Lights.IsMaster; } }
        public bool Enabled { get { return enabled; } }

        /// <summary>Seconds a room must stay empty before its light is switched off.</summary>
        public double VacancyDelaySeconds
        {
            get { return delay; }
            set { if (value < 0 || double.IsNaN(value) || double.IsInfinity(value)) throw new ArgumentOutOfRangeException("value"); delay = value; }
        }

        /// <summary>When true the occupant is <see cref="SimulatedRoomKey"/> instead of the headset (null = nobody anywhere).</summary>
        public bool UseSimulatedOccupant;
        public string SimulatedRoomKey;

        public string OccupiedRoomKey { get { return UseSimulatedOccupant ? SimulatedRoomKey : state.CurrentRoomKey; } }

        /// <summary>False when automation is not possible (no room data); the reason is in <see cref="Status"/>.</summary>
        public bool SetEnabled(bool on)
        {
            if (on && !Available) return false;
            if (on == enabled) return true;
            enabled = on;
            vacancy.Clear(); held.Clear(); lastRoom = null;
            return true;
        }

        public bool IsHeld(string key) { return held.Contains(key); }

        /// <summary>Seconds until the room's light is switched off, or -1 when no countdown is running for it.</summary>
        public double SecondsUntilOff(string key)
        {
            double t;
            return vacancy.TryGetValue(key, out t) && state.Lights.IsOn(key) ? Math.Max(0, delay - t) : -1;
        }

        public int PendingCountdowns { get { int n = 0; foreach (var kv in vacancy) if (state.Lights.IsOn(kv.Key)) n++; return n; } }

        public string Status
        {
            get
            {
                if (!Available) return "Automatic lights: needs room data";
                if (!enabled) return "Automatic lights: OFF";
                int p = PendingCountdowns;
                return p > 0 ? "Automatic lights: ON (" + p + " room" + (p == 1 ? "" : "s") + " switching off soon)" : "Automatic lights: ON";
            }
        }

        void OnLightChanged(string key, bool on, ControlSource src)
        {
            if (!enabled || src == ControlSource.Auto) return;
            if (key == OccupiedRoomKey) { if (!on) held.Add(key); }       // switched off by hand while standing there: keep it off until they leave
            else vacancy.Remove(key);                                    // changed by hand from elsewhere: leave it as set
        }

        public void Tick(double dt)
        {
            if (!enabled) return;
            if (dt < 0 || double.IsNaN(dt) || double.IsInfinity(dt)) dt = 0;

            string cur = OccupiedRoomKey;
            if (cur != lastRoom)
            {
                if (lastRoom != null) vacancy[lastRoom] = 0;                // just left
                lastRoom = cur;
                if (cur != null) Enter(cur);
            }

            if (vacancy.Count == 0) return;
            var due = new List<string>();
            var keys = new List<string>(vacancy.Keys);
            foreach (var k in keys)
            {
                if (k == cur) { vacancy.Remove(k); continue; }
                double t = vacancy[k] + dt;
                vacancy[k] = t;
                if (t >= delay) due.Add(k);
            }
            foreach (var k in due)
            {
                vacancy.Remove(k); held.Remove(k);
                if (state.Lights.Has(k) && state.Lights.Set(k, false, ControlSource.Auto)) Raise(k, false);
            }
        }

        void Enter(string key)
        {
            vacancy.Remove(key);
            if (!state.Lights.Has(key) || held.Contains(key)) return;
            if (state.Lights.Set(key, true, ControlSource.Auto)) Raise(key, true);
        }

        void Raise(string key, bool on) { var h = Acted; if (h != null) h(key, on); }
    }
}
