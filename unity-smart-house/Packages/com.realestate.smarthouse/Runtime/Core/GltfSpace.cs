// Coordinate conversion between the .glb frame (right-handed, feet) and Unity (left-handed, metres).
//
// A glTF importer turns the right-handed glTF frame into Unity's left-handed one by mirroring one horizontal axis, and importers differ in which
// (and the choice is not something this package can verify without the importer in front of it).  So the mirror axis is a setting, and by default it
// is CALIBRATED: both mappings are tried against the real bounds of the imported house and the one that puts the rooms inside the house wins.
using System;
using System.Collections.Generic;

namespace RealEstate.SmartHouse.Core
{
    public enum MirrorAxis { X, Z }

    public sealed class Calibration
    {
        public MirrorAxis Axis = MirrorAxis.X;
        public bool Ambiguous;
        public double InsideX, InsideZ;          // fraction of room centres that land inside the house bounds, per candidate
        public double DistX, DistZ;              // distance (m) between the mapped footprint centre and the bounds centre
        public string Message = "";
    }

    public static class GltfSpace
    {
        public const double FeetToMeters = 0.3048;

        /// <summary>Feet in the .glb frame -> metres in the importer's Unity frame (relative to the model root).</summary>
        public static void ToUnity(MirrorAxis m, double x, double y, double z, out double ux, out double uy, out double uz)
        {
            ux = (m == MirrorAxis.X ? -x : x) * FeetToMeters;
            uy = y * FeetToMeters;
            uz = (m == MirrorAxis.Z ? -z : z) * FeetToMeters;
        }

        /// <summary>Inverse of <see cref="ToUnity"/>: metres in the importer's frame -> feet in the .glb frame.</summary>
        public static void FromUnity(MirrorAxis m, double ux, double uy, double uz, out double x, out double y, out double z)
        {
            x = (m == MirrorAxis.X ? -ux : ux) / FeetToMeters;
            y = uy / FeetToMeters;
            z = (m == MirrorAxis.Z ? -uz : uz) / FeetToMeters;
        }

        /// <summary>A direction (no scale, no offset).</summary>
        public static void DirToUnity(MirrorAxis m, double x, double y, double z, out double ux, out double uy, out double uz)
        {
            ux = m == MirrorAxis.X ? -x : x; uy = y; uz = m == MirrorAxis.Z ? -z : z;
        }

        /// <summary>
        /// Decide the mirror axis from the imported model's horizontal bounds (metres, relative to the model root, Unity frame) and the rooms of the
        /// sidecar.  The mapping under which more room centres fall inside the bounds wins; a tie is broken by the distance between footprint centre
        /// and bounds centre; if the two are still within half a metre of each other the result is marked ambiguous (the caller should warn and let
        /// the developer choose).
        /// </summary>
        public static Calibration Calibrate(IList<RoomData> rooms, double minX, double minZ, double maxX, double maxZ)
        {
            var c = new Calibration();
            if (rooms == null || rooms.Count == 0) { c.Message = "no rooms to calibrate with"; c.Ambiguous = true; return c; }
            const double tol = 0.5;
            int inX = 0, inZ = 0;
            double fx0 = double.MaxValue, fz0 = double.MaxValue, fx1 = double.MinValue, fz1 = double.MinValue;
            foreach (var r in rooms)
            {
                double cx = r.CenterX, cz = r.CenterZ, ux, uy, uz;
                ToUnity(MirrorAxis.X, cx, 0, cz, out ux, out uy, out uz);
                if (ux >= minX - tol && ux <= maxX + tol && uz >= minZ - tol && uz <= maxZ + tol) inX++;
                ToUnity(MirrorAxis.Z, cx, 0, cz, out ux, out uy, out uz);
                if (ux >= minX - tol && ux <= maxX + tol && uz >= minZ - tol && uz <= maxZ + tol) inZ++;
                fx0 = Math.Min(fx0, r.X0); fz0 = Math.Min(fz0, r.Z0); fx1 = Math.Max(fx1, r.X1); fz1 = Math.Max(fz1, r.Z1);
            }
            c.InsideX = inX / (double)rooms.Count; c.InsideZ = inZ / (double)rooms.Count;
            double bcx = (minX + maxX) / 2, bcz = (minZ + maxZ) / 2, px, py, pz;
            ToUnity(MirrorAxis.X, (fx0 + fx1) / 2, 0, (fz0 + fz1) / 2, out px, out py, out pz);
            c.DistX = Math.Sqrt((px - bcx) * (px - bcx) + (pz - bcz) * (pz - bcz));
            ToUnity(MirrorAxis.Z, (fx0 + fx1) / 2, 0, (fz0 + fz1) / 2, out px, out py, out pz);
            c.DistZ = Math.Sqrt((px - bcx) * (px - bcx) + (pz - bcz) * (pz - bcz));

            if (Math.Abs(c.InsideX - c.InsideZ) > 1e-9) c.Axis = c.InsideX > c.InsideZ ? MirrorAxis.X : MirrorAxis.Z;
            else if (Math.Abs(c.DistX - c.DistZ) > 1e-9) c.Axis = c.DistX < c.DistZ ? MirrorAxis.X : MirrorAxis.Z;
            bool tie = Math.Abs(c.InsideX - c.InsideZ) < 1e-9 && Math.Abs(c.DistX - c.DistZ) < 0.5;
            c.Ambiguous = tie;
            c.Message = tie
                ? "The model's bounds fit both mirror choices equally (a house centred on the origin); using " + c.Axis + ". Check the room lights against the walls and set the mirror axis by hand if they are on the wrong side."
                : "Mirror axis " + c.Axis + " chosen (" + (int)Math.Round(100 * (c.Axis == MirrorAxis.X ? c.InsideX : c.InsideZ)) + "% of room centres inside the model).";
            return c;
        }
    }
}
