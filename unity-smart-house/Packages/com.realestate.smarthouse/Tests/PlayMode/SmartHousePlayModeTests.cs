// PlayMode tests for the Unity layer, using the demo stand-in house.  Window > General > Test Runner > PlayMode.
// Written to mirror the Mono-stub suite in tools/mono-tests (which passes), but THESE HAVE NOT BEEN RUN IN UNITY by the author.
using System.Collections;
using System.IO;
using NUnit.Framework;
using UnityEditor.PackageManager;
using UnityEngine;
using UnityEngine.TestTools;
using RealEstate.SmartHouse.Core;

namespace RealEstate.SmartHouse.Tests
{
    public class SmartHousePlayModeTests
    {
        GameObject root; SmartHouseController ctl; string key;

        [UnitySetUp]
        public IEnumerator SetUp()
        {
            var cam = new GameObject("TestCam"); cam.tag = "MainCamera"; cam.AddComponent<Camera>(); cam.transform.position = new Vector3(0, 1.6f, -50);
            var info = PackageInfo.FindForAssembly(typeof(SmartHouseController).Assembly);
            string json = File.ReadAllText(Path.Combine(info.resolvedPath, "Tests", "Editor", "Data", "sample_sc_g2.smarthouse.json"));
            root = new GameObject("SmartTest");
            root.SetActive(false);                                       // configure before Awake/Start run
            var demo = root.AddComponent<DemoHouseBuilder>(); demo.sidecar = new TextAsset(json);
            ctl = root.AddComponent<SmartHouseController>(); ctl.showDebugConsole = false;
            root.SetActive(true);
            yield return null; yield return null;
            key = null;
            foreach (var r in SmartHouseDocument.FromJson(json).Rooms) if (r.Type == "living_room") { key = SmartHouseDocument.Key(r); break; }
        }

        [TearDown] public void TearDown() { Object.Destroy(root); foreach (var c in Camera.allCameras) Object.Destroy(c.gameObject); }

        [UnityTest]
        public IEnumerator Voice_and_switch_control_the_same_light()
        {
            Assert.IsTrue(ctl.Say("turn on the living room light").Changed);
            yield return new WaitForSeconds(0.5f);
            Assert.IsTrue(ctl.State.Lights.IsOn(key));
            Assert.IsTrue(ctl.Bound.LightViews[key].pointLight.enabled);
            Assert.AreEqual("LIGHT ON", ctl.Bound.SwitchViews[key].label.text);
            ctl.Bound.SwitchViews[key].Activate();
            Assert.IsFalse(ctl.State.Lights.IsOn(key));
            Assert.IsTrue(ctl.Say("turn on all lights").Changed);
            Assert.IsTrue(ctl.Say("turn off all lights").Changed);
            Assert.AreEqual(0, ctl.State.Lights.OnCount);
        }

        [UnityTest]
        public IEnumerator Fan_levels_get_faster_and_zero_stops()
        {
            string fk = null;
            foreach (var k in ctl.State.FanKeys) { fk = k; break; }
            Assert.NotNull(fk);
            var blades = ctl.Bound.FanViews[fk].bladeAssembly;
            var speeds = new float[6];
            for (int level = 1; level <= 5; level++)
            {
                ctl.State.SetFanLevel(fk, level, ControlSource.Code);
                yield return new WaitForSeconds(3f);
                // two consecutive frames: the turn per frame stays below 180 degrees even at 300 rpm, so Quaternion.Angle does not alias
                Quaternion a = blades.localRotation; float t0 = Time.time;
                yield return null;
                speeds[level] = Quaternion.Angle(a, blades.localRotation) / (Time.time - t0);
                Assert.AreEqual((float)ctl.State.Spec.DegPerSec(level), speeds[level], (float)(ctl.State.Spec.DegPerSec(level) * 0.06), "level " + level);
            }
            for (int level = 2; level <= 5; level++) Assert.Greater(speeds[level], speeds[level - 1]);
            ctl.State.SetFanLevel(fk, 0, ControlSource.Code);
            yield return new WaitForSeconds(4f);
            Quaternion s = blades.localRotation; yield return new WaitForSeconds(0.5f);
            Assert.Less(Quaternion.Angle(s, blades.localRotation), 0.01f);
            Assert.IsTrue(ctl.State.Fan(fk).IsStopped);
        }

        [UnityTest]
        public IEnumerator Control_panel_buttons_use_the_shared_state()
        {
            Assert.NotNull(ctl.Panel);
            yield return null;
            ctl.Panel.ButtonOf("AllOn").Activate();
            Assert.AreEqual(ctl.State.Lights.Rooms.Count, ctl.State.Lights.OnCount);
            foreach (var sw in ctl.Bound.SwitchViews.Values) Assert.IsTrue(sw.IsOn);
            ctl.Panel.ButtonOf("AllOff").Activate();
            Assert.AreEqual(0, ctl.State.Lights.OnCount);
            ctl.Say("turn on the living room light");
            yield return null;
            Assert.IsTrue(ctl.State.Lights.IsOn(key));
            Assert.AreEqual("Command recognized", ctl.Panel.VoiceHeadline);
        }

        [UnityTest]
        public IEnumerator Automatic_lighting_follows_a_simulated_occupant_and_respects_manual_override()
        {
            ctl.State.Auto.VacancyDelaySeconds = 1.0;
            ctl.State.Auto.SetEnabled(true);
            ctl.SetSimulatedOccupant(key);
            yield return new WaitForSeconds(0.3f);
            Assert.IsTrue(ctl.State.Lights.IsOn(key));
            ctl.State.Lights.Set(key, false, ControlSource.WallSwitch);
            yield return new WaitForSeconds(0.5f);
            Assert.IsFalse(ctl.State.Lights.IsOn(key), "held off while the user stays");
            ctl.SetSimulatedOccupant(null);
            yield return new WaitForSeconds(1.5f);
            ctl.SetSimulatedOccupant(key);
            yield return new WaitForSeconds(0.3f);
            Assert.IsTrue(ctl.State.Lights.IsOn(key), "next visit is automatic again");
        }

        [UnityTest]
        public IEnumerator Energy_is_simulated_and_follows_state()
        {
            Assert.AreEqual(0.0, ctl.State.Energy.TotalWatts, 1e-9);
            ctl.State.SetAllLights(true, ControlSource.Code);
            Assert.AreEqual(ctl.State.Lights.Rooms.Count * ctl.State.Energy.Spec.LightWatts, ctl.State.Energy.LightsWatts, 1e-9);
            double wh = ctl.State.Energy.SessionWh;
            yield return new WaitForSeconds(1f);
            Assert.Greater((float)ctl.State.Energy.SessionWh, (float)wh);
            StringAssert.Contains("Simulated", ctl.Panel.EnergyLabel);
        }
    }
}
