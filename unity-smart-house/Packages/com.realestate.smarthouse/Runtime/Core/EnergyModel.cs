// SIMULATED energy estimate.  Nothing here is measured: the watt figures are assumed typical values (documented below, editable in the config), and the
// session total is those watts multiplied by the time they were on.  The panel labels every figure "simulated".
using System;

namespace RealEstate.SmartHouse.Core
{
    [Serializable]
    public sealed class EnergySpec
    {
        /// <summary>Assumed power of one room light: a 9 W LED lamp (about a 60 W incandescent).</summary>
        public double LightWatts = 9;
        /// <summary>Assumed power of a ceiling fan on regulator levels 0..5 (a 1200 mm AC-induction fan: ~75 W at full speed; BLDC fans use roughly a third).</summary>
        public double[] FanWatts = { 0, 18, 28, 40, 55, 75 };

        public void Validate()
        {
            if (LightWatts < 0) throw new ArgumentException("LightWatts must not be negative.");
            if (FanWatts == null || FanWatts.Length != FanSpec.MaxLevel + 1) throw new ArgumentException("FanWatts must hold " + (FanSpec.MaxLevel + 1) + " values (levels 0..5).");
            if (FanWatts[0] != 0) throw new ArgumentException("Fan level 0 must use 0 W.");
            for (int i = 1; i < FanWatts.Length; i++) if (!(FanWatts[i] >= FanWatts[i - 1])) throw new ArgumentException("FanWatts must not decrease with the level (level " + i + ").");
        }

        public double FanW(int level) { return FanWatts[FanSpec.Clamp(level)]; }
    }

    /// <summary>Current (simulated) power draw and the energy used since the session started or <see cref="Reset"/>.</summary>
    public sealed class EnergyModel
    {
        readonly SmartHouseState state;
        EnergySpec spec = new EnergySpec();

        public EnergyModel(SmartHouseState s) { state = s; }

        public EnergySpec Spec { get { return spec; } set { if (value == null) throw new ArgumentNullException("value"); value.Validate(); spec = value; } }

        public int LightsOn { get { return state.Lights.OnCount; } }
        public int FanCount { get { int n = 0; foreach (var k in state.FanKeys) { n++; } return n; } }
        /// <summary>Fans whose regulator level is above 0.</summary>
        public int FansRunning { get { int n = 0; foreach (var k in state.FanKeys) if (state.FanLevel(k) > 0) n++; return n; } }
        /// <summary>Highest selected fan level in the house (0 when no fan runs).</summary>
        public int MaxFanLevel { get { int m = 0; foreach (var k in state.FanKeys) m = Math.Max(m, state.FanLevel(k)); return m; } }

        public double LightsWatts { get { return LightsOn * spec.LightWatts; } }
        /// <summary>A fan draws the rated power of its SELECTED level; at level 0 it draws nothing even while the blades are still coasting down.</summary>
        public double FansWatts { get { double w = 0; foreach (var k in state.FanKeys) w += spec.FanW(state.FanLevel(k)); return w; } }
        public double TotalWatts { get { return LightsWatts + FansWatts; } }

        /// <summary>Watt-hours since the session started (or the last Reset).</summary>
        public double SessionWh { get; private set; }

        public void Tick(double dt)
        {
            if (dt <= 0 || double.IsNaN(dt) || double.IsInfinity(dt)) return;
            SessionWh += TotalWatts * dt / 3600.0;
        }

        public void Reset() { SessionWh = 0; }

        public static string FormatWatts(double w) { return Math.Round(w).ToString("0") + " W"; }

        public static string FormatEnergy(double wh)
        {
            return wh >= 1000 ? (wh / 1000.0).ToString("0.000", System.Globalization.CultureInfo.InvariantCulture) + " kWh"
                              : wh.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture) + " Wh";
        }
    }
}
