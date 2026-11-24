using System.Collections.Generic;

namespace RealEstate.SmartHouse.Core
{
    public enum RoomScope { Current, All, Type, ByName }

    /// <summary>Which rooms a spoken command refers to.</summary>
    public sealed class RoomQuery
    {
        public RoomScope Scope = RoomScope.Current;
        /// <summary>Room types for <see cref="RoomScope.Type"/> (e.g. "bedroom" also means master / guest bedrooms).</summary>
        public List<string> Types = new List<string>();
        /// <summary>1-based "bedroom two" / "second bedroom"; 0 = every match.</summary>
        public int Ordinal;
        /// <summary>Floor range the rooms must be on (0 = ground, 1 = first, ...); the defaults accept every floor.</summary>
        public int FloorMin = 0;
        public int FloorMax = int.MaxValue;
        /// <summary>The words that selected the rooms, for feedback ("living room").</summary>
        public string Label = "";
    }
}
