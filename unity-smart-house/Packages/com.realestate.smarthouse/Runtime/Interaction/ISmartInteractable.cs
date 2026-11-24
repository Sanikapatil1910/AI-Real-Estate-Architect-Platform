using RealEstate.SmartHouse.Core;

namespace RealEstate.SmartHouse
{
    /// <summary>Anything a controller ray (or the mouse in the editor) can point at and press.</summary>
    public interface ISmartInteractable
    {
        string Label { get; }
        void SetHover(bool hovered);
        /// <summary>The trigger was pressed on it.</summary>
        void Activate();
    }
}
