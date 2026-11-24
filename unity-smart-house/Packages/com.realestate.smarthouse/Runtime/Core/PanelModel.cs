// The data behind the in-house control panel: which rooms are on the current page, what each row shows, and the actions its buttons run.  Every value
// is read from the shared SmartHouseState, so the panel can never disagree with voice, the wall switches or the regulator.
using System;
using System.Collections.Generic;
using System.Text;

namespace RealEstate.SmartHouse.Core
{
    public sealed class PanelRow
    {
        public string Key = "", Name = "";
        public int Floor;
        public bool LightOn;
        public bool HasFan;
        public int FanLevel;
        public int FanRpm;
        /// <summary>Seconds until the automation switches this room off, or -1.</summary>
        public double OffInSeconds = -1;
    }

    public sealed class PanelModel
    {
        public const int RowsPerPage = 6;
        readonly SmartHouseState state;
        public readonly VoiceStatusBoard Voice;
        readonly List<RoomInfo> rooms = new List<RoomInfo>();
        int page;

        public bool ShowEnergy = true;

        public PanelModel(SmartHouseState s, VoiceStatusBoard board)
        {
            state = s; Voice = board ?? new VoiceStatusBoard();
            rooms.AddRange(s.Lights.Rooms);
            rooms.Sort((a, b) => a.Floor != b.Floor ? a.Floor.CompareTo(b.Floor) : a.Order.CompareTo(b.Order));
        }

        public int RoomCount { get { return rooms.Count; } }
        public int PageCount { get { return Math.Max(1, (rooms.Count + RowsPerPage - 1) / RowsPerPage); } }
        public int Page { get { return page; } set { page = Math.Max(0, Math.Min(PageCount - 1, value)); } }
        public void NextPage() { Page = page + 1; }
        public void PrevPage() { Page = page - 1; }

        public static string FloorLabel(int floor) { return floor == 0 ? "G" : floor + "F"; }

        /// <summary>Rows of the current page (fewer than RowsPerPage on the last page).</summary>
        public List<PanelRow> Rows()
        {
            var list = new List<PanelRow>();
            for (int i = page * RowsPerPage; i < Math.Min(rooms.Count, (page + 1) * RowsPerPage); i++) list.Add(RowFor(rooms[i]));
            return list;
        }

        public PanelRow RowFor(RoomInfo r)
        {
            var f = state.Fan(r.Key);
            return new PanelRow
            {
                Key = r.Key, Floor = r.Floor, HasFan = f != null,
                Name = state.Lights.IsMaster ? "Whole house" : r.Name + " (" + FloorLabel(r.Floor) + ")",
                LightOn = state.Lights.IsOn(r.Key),
                FanLevel = f != null ? f.Level : 0,
                FanRpm = f != null ? (int)Math.Round(f.VelocityDegPerSec / 6.0) : 0,
                OffInSeconds = state.Auto.SecondsUntilOff(r.Key)
            };
        }

        // ---- actions (what the buttons do) ---------------------------------------------------------------------------------------------------
        public void ToggleLight(string key) { if (state.Lights.Has(key)) state.Lights.Toggle(key, ControlSource.Panel); }
        public int AllOn() { return state.SetAllLights(true, ControlSource.Panel); }
        public int AllOff() { return state.SetAllLights(false, ControlSource.Panel); }
        public void FanStep(string key, int delta) { if (state.Fan(key) != null) state.SetFanLevel(key, state.FanLevel(key) + delta, ControlSource.Panel); }
        public bool ToggleAuto() { return state.Auto.SetEnabled(!state.Auto.Enabled); }

        // ---- text ------------------------------------------------------------------------------------------------------------------------------
        public string LightsSummary { get { return state.Lights.OnCount + " of " + state.Lights.Rooms.Count + " lights ON"; } }
        public string PageText { get { return "Page " + (page + 1) + "/" + PageCount; } }
        public string AutoText { get { return state.Auto.Status; } }

        public string FanSummary
        {
            get
            {
                var e = state.Energy;
                if (e.FanCount == 0) return "No ceiling fans";
                if (e.FansRunning == 0) return "Fans: all OFF";
                return "Fans: " + e.FansRunning + " running, highest speed " + e.MaxFanLevel;
            }
        }

        /// <summary>Two short lines for the energy section.  Every figure is labelled simulated.</summary>
        public string EnergyText
        {
            get
            {
                var e = state.Energy;
                var sb = new StringBuilder();
                sb.Append("Simulated power: ").Append(EnergyModel.FormatWatts(e.TotalWatts))
                  .Append("  (lights ").Append(EnergyModel.FormatWatts(e.LightsWatts)).Append(", fans ").Append(EnergyModel.FormatWatts(e.FansWatts)).Append(")\n");
                sb.Append("Simulated session total: ").Append(EnergyModel.FormatEnergy(e.SessionWh));
                return sb.ToString();
            }
        }
    }
}
