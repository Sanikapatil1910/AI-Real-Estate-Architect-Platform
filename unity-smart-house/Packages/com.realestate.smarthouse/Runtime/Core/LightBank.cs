// The on/off state of every room light, and the rule that turns a spoken room reference into rooms.  Voice, wall switches and the VR panel all go
// through this one object, so they cannot disagree: whatever changes a light raises the same event and every view (Light, fixture, switch plate,
// label) follows it.
using System;
using System.Collections.Generic;

namespace RealEstate.SmartHouse.Core
{
    public enum ControlSource { Code, Voice, WallSwitch, Panel, Auto }

    public sealed class RoomInfo
    {
        public string Key = "", Name = "", Type = "";
        public int Floor;
        public bool HasFan;
        public int Order;      // position in the file (stable ordering for "second bedroom")
        public static string KeyOf(RoomData r) { return SmartHouseDocument.Key(r); }
    }

    public sealed class LightBank
    {
        readonly List<RoomInfo> rooms = new List<RoomInfo>();
        readonly Dictionary<string, bool> on = new Dictionary<string, bool>();
        readonly Dictionary<string, RoomInfo> byKey = new Dictionary<string, RoomInfo>();

        /// <summary>Raised after a light really changed: (room key, new state, who asked).  Not raised when the light was already in that state.</summary>
        public event Action<string, bool, ControlSource> Changed;

        public IList<RoomInfo> Rooms { get { return rooms; } }
        public bool IsMaster { get; private set; }

        public void Add(RoomInfo r)
        {
            if (byKey.ContainsKey(r.Key)) throw new InvalidOperationException("Duplicate room " + r.Key);
            r.Order = rooms.Count;
            rooms.Add(r); byKey[r.Key] = r; on[r.Key] = false;
        }

        /// <summary>One light for the whole house (used when the rooms of a model are not known).</summary>
        public static LightBank Master()
        {
            var b = new LightBank { IsMaster = true };
            b.Add(new RoomInfo { Key = "master", Name = "House", Type = "master" });
            return b;
        }

        public bool Has(string key) { return key != null && byKey.ContainsKey(key); }
        public RoomInfo Get(string key) { RoomInfo r; return key != null && byKey.TryGetValue(key, out r) ? r : null; }
        public bool IsOn(string key) { bool v; return on.TryGetValue(key, out v) && v; }
        public int OnCount { get { int n = 0; foreach (var kv in on) if (kv.Value) n++; return n; } }

        /// <summary>Returns true when the light changed.</summary>
        public bool Set(string key, bool value, ControlSource src)
        {
            if (!on.ContainsKey(key)) throw new KeyNotFoundException("No light " + key);
            if (on[key] == value) return false;
            on[key] = value;
            var h = Changed; if (h != null) h(key, value, src);
            return true;
        }

        public bool Toggle(string key, ControlSource src) { return Set(key, !IsOn(key), src); }

        /// <summary>Master switch: every light to <paramref name="value"/>.  Returns how many really changed.</summary>
        public int SetAll(bool value, ControlSource src)
        {
            int n = 0;
            foreach (var r in rooms) if (Set(r.Key, value, src)) n++;
            return n;
        }

        /// <summary>Rooms a query refers to.  Scope Current needs the key of the room the player is in (null: unknown -> empty).</summary>
        public List<RoomInfo> Resolve(RoomQuery q, string currentKey, bool fansOnly = false)
        {
            var res = new List<RoomInfo>();
            if (IsMaster) { res.Add(rooms[0]); return res; }
            if (q.Scope == RoomScope.Current)
            {
                var r = Get(currentKey);
                if (r != null && (!fansOnly || r.HasFan)) res.Add(r);
                return res;
            }
            foreach (var r in rooms)
            {
                if (fansOnly && !r.HasFan) continue;
                if (r.Floor < q.FloorMin || r.Floor > q.FloorMax) continue;
                if (q.Scope == RoomScope.Type && !q.Types.Contains(r.Type)) continue;
                res.Add(r);
            }
            if (q.Scope == RoomScope.Type && q.Ordinal > 0 && res.Count > 0)
            {
                // "bedroom 2": a room whose own name carries that number, else the n-th in file order
                var named = res.FindAll(r => TrailingNumber(r.Name) == q.Ordinal);
                if (named.Count > 0) return named;
                res.Sort((a, b) => a.Order.CompareTo(b.Order));
                return q.Ordinal <= res.Count ? new List<RoomInfo> { res[q.Ordinal - 1] } : new List<RoomInfo>();
            }
            return res;
        }

        static int TrailingNumber(string s)
        {
            int i = s.Length - 1;
            while (i >= 0 && char.IsDigit(s[i])) i--;
            int n;
            return i < s.Length - 1 && int.TryParse(s.Substring(i + 1), out n) ? n : 0;
        }
    }
}
