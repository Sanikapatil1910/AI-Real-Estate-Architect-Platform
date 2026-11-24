using UnityEngine;
using UnityEngine.XR;

namespace RealEstate.SmartHouse.Voice
{
    /// <summary>Optional: hold a controller button to listen (saves battery and avoids the room's TV being heard as commands).</summary>
    public sealed class VoicePushToTalk : MonoBehaviour
    {
        public VoiceBackendBase backend;
        public XRNode hand = XRNode.LeftHand;
        public enum Button { Primary, Secondary, Grip }
        public Button button = Button.Primary;
        bool was;

        void Update()
        {
            if (backend == null) return;
            var dev = InputDevices.GetDeviceAtXRNode(hand);
            bool v = false;
            if (dev.isValid)
            {
                switch (button)
                {
                    case Button.Primary: dev.TryGetFeatureValue(CommonUsages.primaryButton, out v); break;
                    case Button.Secondary: dev.TryGetFeatureValue(CommonUsages.secondaryButton, out v); break;
                    default: dev.TryGetFeatureValue(CommonUsages.gripButton, out v); break;
                }
            }
            if (v && !was) backend.StartListening();
            else if (!v && was) backend.StopListening();
            was = v;
        }
    }
}
