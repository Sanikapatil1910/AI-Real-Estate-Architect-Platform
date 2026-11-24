using System.Text;
using RealEstate.SmartHouse.Core;
using UnityEngine;

namespace RealEstate.SmartHouse
{
    /// <summary>
    /// Editor / development-build panel (IMGUI, so it is NOT visible inside a headset): type a command as if it were spoken, flip lights, set fan
    /// levels, and read the binder's warnings.  It exists so every behaviour can be exercised on a desktop without a microphone.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class SmartDebugConsole : MonoBehaviour
    {
        public bool visible = true;
        string typed = "turn on the light";
        string last = "";
        Vector2 scroll;
        Rect rect = new Rect(10, 10, 420, 420);
        int simIndex = -1;

        void OnGUI()
        {
            if (!visible || !(Application.isEditor || Debug.isDebugBuild)) return;
            var c = SmartHouseController.Instance;
            if (c == null || c.State == null) return;
            rect = GUILayout.Window(0x5A17, rect, id =>
            {
                var s = c.State;
                GUILayout.Label("Room: " + (c.CurrentRoomKey ?? "(unknown)") + "   lights on: " + s.Lights.OnCount + "/" + s.Lights.Rooms.Count
                                + "   voice: " + (c.ActiveBackend != null ? c.ActiveBackend.State.ToString() : "none (typed only)"));
                GUILayout.BeginHorizontal();
                typed = GUILayout.TextField(typed, GUILayout.MinWidth(250));
                if (GUILayout.Button("Say", GUILayout.Width(50))) Run(c, typed);
                GUILayout.EndHorizontal();
                GUILayout.BeginHorizontal();
                foreach (var q in new[] { "turn on the light", "turn off the light", "turn on all lights", "turn off all lights" })
                    if (GUILayout.Button(q.Replace("turn ", "").Replace(" the light", " light"))) Run(c, q);
                GUILayout.EndHorizontal();
                GUILayout.BeginHorizontal();
                GUILayout.Label("Fan:", GUILayout.Width(30));
                for (int i = 0; i <= 5; i++) if (GUILayout.Button(i.ToString(), GUILayout.Width(32))) Run(c, i == 0 ? "turn off the fan" : "set the fan to speed " + i);
                GUILayout.EndHorizontal();
                GUILayout.BeginHorizontal();
                if (GUILayout.Button(s.Auto.Enabled ? "Auto lights: ON" : "Auto lights: OFF")) s.Auto.SetEnabled(!s.Auto.Enabled);
                GUILayout.Label("occupant:", GUILayout.Width(62));
                if (GUILayout.Button("<", GUILayout.Width(26))) StepSim(c, -1);
                GUILayout.Label(simIndex < 0 ? "headset" : s.Lights.Rooms[simIndex].Name, GUILayout.MinWidth(90));
                if (GUILayout.Button(">", GUILayout.Width(26))) StepSim(c, +1);
                if (GUILayout.Button("nobody", GUILayout.Width(60))) { simIndex = -2; c.SetSimulatedOccupant(null, true); }
                GUILayout.EndHorizontal();
                GUILayout.Label("Simulated power " + EnergyModel.FormatWatts(s.Energy.TotalWatts) + ", session " + EnergyModel.FormatEnergy(s.Energy.SessionWh) + "  (simulated, not measured)");
                GUILayout.Label(last);
                scroll = GUILayout.BeginScrollView(scroll);
                var sb = new StringBuilder();
                if (c.Bound != null) { sb.AppendLine("Mirror axis: " + c.Bound.Axis + (c.Bound.AxisAmbiguous ? " (AMBIGUOUS)" : "")); foreach (var w in c.Bound.Warnings) sb.AppendLine("• " + w); }
                GUILayout.Label(sb.ToString());
                GUILayout.EndScrollView();
                GUI.DragWindow();
            }, "Smart House");
        }

        void StepSim(SmartHouseController c, int d)
        {
            int n = c.State.Lights.Rooms.Count;
            if (n == 0) return;
            simIndex = simIndex < 0 ? (d > 0 ? 0 : n - 1) : simIndex + d;
            if (simIndex < 0 || simIndex >= n) { simIndex = -1; c.SetSimulatedOccupant(null, false); return; }     // past either end: back to the real headset
            c.SetSimulatedOccupant(c.State.Lights.Rooms[simIndex].Key, true);
        }

        void Run(SmartHouseController c, string text)
        {
            var r = c.Say(text);
            last = r == null ? "(ignored: same command repeated)" : "“" + text + "” → " + r.Message;
        }
    }
}
