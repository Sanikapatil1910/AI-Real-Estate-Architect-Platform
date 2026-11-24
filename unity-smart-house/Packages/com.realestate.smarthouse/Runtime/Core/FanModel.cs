// Ceiling-fan physics: speed level 0..5 -> blade angular velocity, with smooth acceleration and deceleration, integrated EXACTLY so the rotation
// after a given time is the same whatever the frame rate (the velocity ramp is linear, and the angle is the area under it).
using System;

namespace RealEstate.SmartHouse.Core
{
    [Serializable]
    public sealed class FanSpec
    {
        public const int MaxLevel = 5;
        /// <summary>Blade revolutions per minute for levels 0..5 (a 48-56 in. household fan runs roughly 70-320 rpm on its five regulator steps).</summary>
        public double[] Rpm = { 0, 90, 140, 190, 240, 300 };
        /// <summary>Spin-up, degrees per second squared (1800 deg/s at level 5 is reached in ~4 s).</summary>
        public double AccelDegPerSec2 = 450;
        /// <summary>Slow-down when a lower level is chosen.</summary>
        public double DecelDegPerSec2 = 300;
        /// <summary>Slow-down when level 0 is chosen (the fan brakes to a stop; a coasting fan would keep spinning for a minute).</summary>
        public double StopDecelDegPerSec2 = 600;
        /// <summary>Level a spoken "turn on the fan" selects.</summary>
        public int DefaultOnLevel = 3;

        public double DegPerSec(int level) { return Rpm[Clamp(level)] * 6.0; }
        public static int Clamp(int level) { return level < 0 ? 0 : level > MaxLevel ? MaxLevel : level; }

        public void Validate()
        {
            if (Rpm == null || Rpm.Length != MaxLevel + 1) throw new ArgumentException("Rpm must hold " + (MaxLevel + 1) + " values (levels 0..5).");
            if (Rpm[0] != 0) throw new ArgumentException("Level 0 must be 0 rpm.");
            for (int i = 1; i <= MaxLevel; i++)
                if (!(Rpm[i] > Rpm[i - 1])) throw new ArgumentException("Rpm must increase with every level (level " + i + ").");
            if (AccelDegPerSec2 <= 0 || DecelDegPerSec2 <= 0 || StopDecelDegPerSec2 <= 0) throw new ArgumentException("Accelerations must be positive.");
        }
    }

    public sealed class FanModel
    {
        readonly FanSpec spec;
        public int Level { get; private set; }
        /// <summary>Current angular velocity of the blade assembly (deg/s, can be below the target while accelerating).</summary>
        public double VelocityDegPerSec { get; private set; }
        /// <summary>Angle accumulated since creation (never wrapped: handy for tests).</summary>
        public double TotalDeg { get; private set; }
        /// <summary>Angle to apply to the blade assembly, 0..360.</summary>
        public double AngleDeg { get { double a = TotalDeg % 360.0; return a < 0 ? a + 360.0 : a; } }
        public double TargetDegPerSec { get { return spec.DegPerSec(Level); } }
        public bool IsStopped { get { return VelocityDegPerSec == 0 && Level == 0; } }

        public FanModel(FanSpec spec) { spec.Validate(); this.spec = spec; }

        public void SetLevel(int level) { Level = FanSpec.Clamp(level); }

        /// <summary>Advance by dt seconds.  Returns the angle turned in this step (deg).</summary>
        public double Tick(double dt)
        {
            if (dt <= 0 || double.IsNaN(dt) || double.IsInfinity(dt)) return 0;
            double turned = 0, remaining = dt;
            double target = TargetDegPerSec;
            while (remaining > 0)
            {
                double v = VelocityDegPerSec;
                if (v == target) { turned += v * remaining; break; }
                double a = target > v ? spec.AccelDegPerSec2 : (target == 0 ? spec.StopDecelDegPerSec2 : spec.DecelDegPerSec2);
                double tReach = Math.Abs(target - v) / a;
                if (tReach > remaining)
                {
                    double vn = v + (target > v ? 1 : -1) * a * remaining;
                    turned += (v + vn) / 2 * remaining;
                    VelocityDegPerSec = vn;
                    remaining = 0;
                }
                else
                {
                    turned += (v + target) / 2 * tReach;
                    VelocityDegPerSec = target;
                    remaining -= tReach;
                }
            }
            TotalDeg += turned;
            return turned;
        }
    }
}
