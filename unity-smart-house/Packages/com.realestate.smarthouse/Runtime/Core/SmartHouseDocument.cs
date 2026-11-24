// The smart-house sidecar (house-N.smarthouse.json) written by the web app next to the exported .glb.  Units: feet, in the .glb's frame
// (x = plan x, y = up, z = plan y).  Pure C#: no UnityEngine dependency, so it is tested outside Unity.
using System;
using System.Collections.Generic;

namespace RealEstate.SmartHouse.Core
{
    public struct Vec3
    {
        public double X, Y, Z;
        public Vec3(double x, double y, double z) { X = x; Y = y; Z = z; }
        public override string ToString() { return "(" + X + ", " + Y + ", " + Z + ")"; }
    }

    public sealed class AnchorData
    {
        public Vec3 Pos;
        public Vec3 Normal;          // into the room
        public string Wall = "";     // top / bottom / left / right
        public double WallThicknessFt;
        public bool ExteriorWall;
    }

    public sealed class FanData
    {
        public Vec3 Pos;             // x/z = the fan's axis; y = the BOTTOM of the down-rod (ceiling_y - down_rod_ft).  The canopy sits at RoomData.CeilingY.
        public double BladeRadiusFt;
        public double DownRodFt;
        public double BladePlaneAboveFloorFt;
    }

    public sealed class RoomData
    {
        public string Id = "", Name = "", Type = "";
        public int Floor;
        public double X0, Z0, X1, Z1;
        public double FloorY, CeilingY;
        public Vec3 LightPos;
        public double LightRangeFt;
        public FanData Fan;          // null: no fan in this room
        public AnchorData Switch;    // null: no automatic switch position (place by hand)
        public AnchorData Regulator; // null: no regulator
        public List<string> Notes = new List<string>();

        public bool Contains(double x, double z) { return x >= X0 && x <= X1 && z >= Z0 && z <= Z1; }
        public double CenterX { get { return (X0 + X1) / 2; } }
        public double CenterZ { get { return (Z0 + Z1) / 2; } }
    }

    public sealed class SmartHouseDocument
    {
        public const string Schema = "realestate.smart-house/1";
        public string SchemaId = "";
        public string Style = "";
        public int PlanNumber;
        public double WallHeightFt, SlabFt, InteriorWallFt, ExteriorWallFt;
        public double FootX0, FootZ0, FootX1, FootZ1;
        public List<RoomData> Rooms = new List<RoomData>();
        public List<string> Notes = new List<string>();

        public static SmartHouseDocument FromJson(string json)
        {
            var root = MiniJson.Obj(MiniJson.Parse(json));
            if (root == null) throw new FormatException("The smart-house file is not a JSON object.");
            string schema = MiniJson.Str(MiniJson.Get(root, "schema"));
            if (!schema.StartsWith("realestate.smart-house/", StringComparison.Ordinal))
                throw new FormatException("Not a smart-house file (schema '" + schema + "').");
            if (schema != Schema)
                throw new FormatException("Unsupported smart-house schema '" + schema + "' (this package reads '" + Schema + "'). Update the package or re-export the file.");
            var d = new SmartHouseDocument();
            d.SchemaId = schema;
            d.Style = MiniJson.Str(MiniJson.Get(root, "style"));
            d.PlanNumber = (int)MiniJson.Num(MiniJson.Get(root, "plan_number"));
            d.WallHeightFt = MiniJson.Num(MiniJson.Get(root, "wall_height_ft"), 10);
            d.SlabFt = MiniJson.Num(MiniJson.Get(root, "slab_ft"), 0.3);
            d.InteriorWallFt = MiniJson.Num(MiniJson.Get(root, "interior_wall_ft"), 0.394);
            d.ExteriorWallFt = MiniJson.Num(MiniJson.Get(root, "exterior_wall_ft"), 0.755);
            var fp = MiniJson.Obj(MiniJson.Get(root, "footprint"));
            d.FootX0 = MiniJson.Num(MiniJson.Get(fp, "x0")); d.FootZ0 = MiniJson.Num(MiniJson.Get(fp, "z0"));
            d.FootX1 = MiniJson.Num(MiniJson.Get(fp, "x1")); d.FootZ1 = MiniJson.Num(MiniJson.Get(fp, "z1"));
            foreach (var n in MiniJson.Arr(MiniJson.Get(root, "notes")) ?? new List<object>()) d.Notes.Add(MiniJson.Str(n));
            var seen = new HashSet<string>();
            foreach (var ro in MiniJson.Arr(MiniJson.Get(root, "rooms")) ?? new List<object>())
            {
                var o = MiniJson.Obj(ro);
                if (o == null) continue;
                var r = new RoomData();
                r.Id = MiniJson.Str(MiniJson.Get(o, "id"));
                r.Name = MiniJson.Str(MiniJson.Get(o, "name"), r.Id);
                r.Type = MiniJson.Str(MiniJson.Get(o, "type"));
                r.Floor = (int)MiniJson.Num(MiniJson.Get(o, "floor"));
                var rect = MiniJson.Obj(MiniJson.Get(o, "rect"));
                r.X0 = MiniJson.Num(MiniJson.Get(rect, "x0")); r.Z0 = MiniJson.Num(MiniJson.Get(rect, "z0"));
                r.X1 = MiniJson.Num(MiniJson.Get(rect, "x1")); r.Z1 = MiniJson.Num(MiniJson.Get(rect, "z1"));
                r.FloorY = MiniJson.Num(MiniJson.Get(o, "floor_y")); r.CeilingY = MiniJson.Num(MiniJson.Get(o, "ceiling_y"));
                var light = MiniJson.Obj(MiniJson.Get(o, "light"));
                r.LightPos = V(MiniJson.Get(light, "pos"));
                r.LightRangeFt = MiniJson.Num(MiniJson.Get(light, "range_ft"), 12);
                var fan = MiniJson.Obj(MiniJson.Get(o, "fan"));
                if (fan != null)
                    r.Fan = new FanData
                    {
                        Pos = V(MiniJson.Get(fan, "pos")), BladeRadiusFt = MiniJson.Num(MiniJson.Get(fan, "blade_radius_ft"), 2),
                        DownRodFt = MiniJson.Num(MiniJson.Get(fan, "down_rod_ft")), BladePlaneAboveFloorFt = MiniJson.Num(MiniJson.Get(fan, "blade_plane_above_floor_ft"), 8)
                    };
                r.Switch = Anchor(MiniJson.Obj(MiniJson.Get(o, "switch")));
                r.Regulator = Anchor(MiniJson.Obj(MiniJson.Get(o, "regulator")));
                foreach (var n in MiniJson.Arr(MiniJson.Get(o, "notes")) ?? new List<object>()) r.Notes.Add(MiniJson.Str(n));
                if (r.Id.Length == 0) throw new FormatException("A room has no id.");
                string key = r.Floor + ":" + r.Id;
                if (!seen.Add(key)) throw new FormatException("Duplicate room " + key);
                // the key the rest of the code uses is Floor:Id, because ids repeat nowhere inside a floor but may across floors
                d.Rooms.Add(r);
            }
            if (d.Rooms.Count == 0) throw new FormatException("The smart-house file has no rooms.");
            return d;
        }

        static AnchorData Anchor(Dictionary<string, object> o)
        {
            if (o == null) return null;
            return new AnchorData
            {
                Pos = V(MiniJson.Get(o, "pos")), Normal = V(MiniJson.Get(o, "normal")), Wall = MiniJson.Str(MiniJson.Get(o, "wall")),
                WallThicknessFt = MiniJson.Num(MiniJson.Get(o, "wall_thickness_ft"), 0.4), ExteriorWall = MiniJson.Bool(MiniJson.Get(o, "exterior_wall"))
            };
        }

        static Vec3 V(object o)
        {
            var a = MiniJson.Arr(o);
            if (a == null || a.Count < 3) return new Vec3();
            return new Vec3(MiniJson.Num(a[0]), MiniJson.Num(a[1]), MiniJson.Num(a[2]));
        }

        /// <summary>The key that identifies a room across the whole house.</summary>
        public static string Key(RoomData r) { return r.Floor + ":" + r.Id; }
    }
}
