using System;
using System.Collections.Generic;
using System.Text;

namespace RealEstate.SmartHouse.Core
{
    public enum PanelRequest { None, Show, Hide }

    public sealed class CommandResult
    {
        public PanelRequest Panel = PanelRequest.None;   // the command asked to show / hide the control panel (the Unity layer does it)
        public bool Understood;          // a command was recognised
        public bool Changed;             // something really changed
        public string Message = "";      // for the on-screen confirmation
        public List<string> RoomKeys = new List<string>();
    }

    /// <summary>Lights + fans of one house and the voice-command executor.  No Unity types.</summary>
    public sealed class SmartHouseState
    {
        public readonly LightBank Lights;
        public readonly FanSpec Spec;
        readonly Dictionary<string, FanModel> fans = new Dictionary<string, FanModel>();

        /// <summary>Raised when a fan's level changed: (room key, level, who asked).</summary>
        public event Action<string, int, ControlSource> FanLevelChanged;

        /// <summary>The room the player is in (set by the room locator); null when outside or unknown.</summary>
        public string CurrentRoomKey;

        /// <summary>Optional motion-sensor automation (disabled until switched on).</summary>
        public readonly AutoLighting Auto;
        /// <summary>Simulated power / energy estimate.</summary>
        public readonly EnergyModel Energy;

        public SmartHouseState(LightBank lights, FanSpec spec)
        {
            Lights = lights; Spec = spec; spec.Validate();
            Auto = new AutoLighting(this);
            Energy = new EnergyModel(this);
        }

        public static SmartHouseState FromDocument(SmartHouseDocument doc, FanSpec spec = null)
        {
            spec = spec ?? new FanSpec();
            var lights = new LightBank();
            var st = new SmartHouseState(lights, spec);
            foreach (var r in doc.Rooms)
            {
                lights.Add(new RoomInfo { Key = RoomInfo.KeyOf(r), Name = r.Name, Type = r.Type, Floor = r.Floor, HasFan = r.Fan != null });
                if (r.Fan != null) st.fans[RoomInfo.KeyOf(r)] = new FanModel(spec);
            }
            return st;
        }

        /// <summary>Fallback when a model has no usable room data: one master light, no fans.</summary>
        public static SmartHouseState Master(FanSpec spec = null) { return new SmartHouseState(LightBank.Master(), spec ?? new FanSpec()); }

        public FanModel Fan(string key) { FanModel f; return key != null && fans.TryGetValue(key, out f) ? f : null; }
        public IEnumerable<string> FanKeys { get { return fans.Keys; } }
        public int FanLevel(string key) { var f = Fan(key); return f == null ? 0 : f.Level; }

        public bool SetFanLevel(string key, int level, ControlSource src)
        {
            var f = Fan(key);
            if (f == null) return false;
            level = FanSpec.Clamp(level);
            if (f.Level == level) return false;
            f.SetLevel(level);
            var h = FanLevelChanged; if (h != null) h(key, level, src);
            return true;
        }

        /// <summary>Master switch (all lights ON or OFF) from the panel or code.  Returns how many lights changed.</summary>
        public int SetAllLights(bool on, ControlSource src) { return Lights.SetAll(on, src); }

        /// <summary>Advance fans, the automation and the energy meter.  Set <see cref="CurrentRoomKey"/> first.</summary>
        public void Tick(double dt)
        {
            foreach (var kv in fans) kv.Value.Tick(dt);
            Auto.Tick(dt);
            Energy.Tick(dt);
        }

        // ---- voice ------------------------------------------------------------------------------------------------------------------------------
        public CommandResult Execute(string transcript) { return Execute(VoiceCommandParser.Parse(transcript)); }

        public CommandResult Execute(VoiceCommand c)
        {
            var res = new CommandResult();
            if (c.Kind == CommandKind.Unknown)
            {
                res.Message = c.Normalized.Length == 0 ? "Nothing heard" : "Not understood: “" + c.Heard.Trim() + "”";
                return res;
            }
            res.Understood = true;
            if (c.IsFan) return ExecuteFan(c, res);
            if (c.IsAuto) return ExecuteAuto(c, res);
            if (c.IsPanel)
            {
                res.Panel = c.Kind == CommandKind.PanelShow ? PanelRequest.Show : PanelRequest.Hide;
                res.Changed = true;
                res.Message = c.Kind == CommandKind.PanelShow ? "Control panel shown" : "Control panel hidden";
                return res;
            }

            bool on = c.Kind == CommandKind.LightOn;
            var rooms = Lights.Resolve(c.Room, CurrentRoomKey);
            if (rooms.Count == 0) { res.Message = NoRoom(c); return res; }
            int changed = 0;
            foreach (var r in rooms) { res.RoomKeys.Add(r.Key); if (Lights.Set(r.Key, on, ControlSource.Voice)) changed++; }
            res.Changed = changed > 0;
            res.Message = Describe(rooms, c.Room, "light", on ? "ON" : "OFF", changed);
            return res;
        }

        CommandResult ExecuteAuto(VoiceCommand c, CommandResult res)
        {
            bool want = c.Kind == CommandKind.AutoOn;
            if (!Auto.SetEnabled(want))
            {
                res.Message = "Automatic lights need the room data of the house";
                return res;
            }
            res.Changed = true;
            res.Message = "Automatic lights " + (want ? "ON" : "OFF");
            return res;
        }

        CommandResult ExecuteFan(VoiceCommand c, CommandResult res)
        {
            var rooms = Lights.Resolve(c.Room, CurrentRoomKey, true);
            if (rooms.Count == 0)
            {
                if (c.Room.Scope == RoomScope.Current && fans.Count == 1) { foreach (var k in fans.Keys) rooms = new List<RoomInfo> { Lights.Get(k) }; }
                else
                {
                    var here = Lights.Get(CurrentRoomKey);
                    res.Message = here != null && !here.HasFan ? "No ceiling fan in the " + here.Name : NoRoom(c, "fan");
                    return res;
                }
            }
            int changed = 0;
            string what = "";
            foreach (var r in rooms)
            {
                int cur = FanLevel(r.Key), next = cur;
                switch (c.Kind)
                {
                    case CommandKind.FanOff: next = 0; break;
                    case CommandKind.FanOn: next = cur == 0 ? Spec.DefaultOnLevel : cur; break;
                    case CommandKind.FanSet: next = c.Level; break;
                    case CommandKind.FanFaster: next = cur + 1; break;
                    case CommandKind.FanSlower: next = cur - 1; break;
                }
                res.RoomKeys.Add(r.Key);
                if (SetFanLevel(r.Key, next, ControlSource.Voice)) changed++;
                what = FanSpec.Clamp(next) == 0 ? "OFF" : "speed " + FanSpec.Clamp(next);
            }
            res.Changed = changed > 0;
            res.Message = Describe(rooms, c.Room, "fan", what, changed);
            return res;
        }

        static string NoRoom(VoiceCommand c, string noun = "light")
        {
            return "Say which room: I don't know where you are (try “" + (noun == "fan" ? "turn on the living room fan" : "turn on the living room light") + "”)";
        }

        string Describe(List<RoomInfo> rooms, RoomQuery q, string noun, string state, int changed)
        {
            var sb = new StringBuilder();
            if (Lights.IsMaster) sb.Append("House light ");
            else if (rooms.Count == 1) sb.Append(rooms[0].Name).Append(' ').Append(noun).Append(' ');
            else if (q.Scope == RoomScope.All && q.FloorMin == 0 && q.FloorMax == int.MaxValue) sb.Append("All ").Append(rooms.Count).Append(' ').Append(noun).Append("s ");
            else sb.Append(rooms.Count).Append(' ').Append(q.Label.Length > 0 ? q.Label + " " : "").Append(noun).Append("s ");
            sb.Append(state);
            if (changed == 0) sb.Append(" (already)");
            return sb.ToString();
        }
    }

    /// <summary>Which room a point (in the .glb's frame, feet) is in.</summary>
    public sealed class RoomLocator
    {
        readonly List<RoomData> rooms;
        public RoomLocator(SmartHouseDocument doc) { rooms = doc.Rooms; }

        /// <summary>The key of the room whose floor area contains (x, z) at height y (feet), or null.</summary>
        public string Locate(double x, double y, double z)
        {
            foreach (var r in rooms)
                if (r.Contains(x, z) && y >= r.FloorY - 0.5 && y <= r.CeilingY + 0.2) return SmartHouseDocument.Key(r);
            return null;
        }
    }
}
