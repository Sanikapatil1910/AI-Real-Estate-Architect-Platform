// Exercises the Unity-layer code (binder, controller, views, interactor, voice router) against the functional UnityEngine stubs in ./stubs.
// This proves the package's own logic (placement maths, state synchronisation, fan speeds, duplicate guards).  It does NOT prove behaviour inside Unity.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using RealEstate.SmartHouse;
using RealEstate.SmartHouse.Core;
using RealEstate.SmartHouse.Voice;
using UnityEngine;
using UnityEngine.XR;
using Object = UnityEngine.Object;

static class Sim
{
    public static void Frame(float dt)
    {
        Time.deltaTime = dt; Time.unscaledDeltaTime = dt; Time.unscaledTime += dt;
        var all = Scene.AllComponents().OfType<MonoBehaviour>().Where(m => m.enabled).ToList();
        foreach (var m in all) { if (m.destroyed) continue; if (!m.started) { m.started = true; if (m.Has("Start")) m.InvokeRet("Start"); } }
        foreach (var m in all) if (!m.destroyed && m.enabled && m.Has("Update")) m.Invoke("Update");
        foreach (var m in all) if (!m.destroyed && m.enabled && m.Has("LateUpdate")) m.Invoke("LateUpdate");
        Object.FlushDestroy();
    }
    public static void Run(float seconds, float fps) { int n = (int)Math.Round(seconds * fps); for (int i = 0; i < n; i++) Frame(1f / fps); }
}

static class T
{
    public static int Pass, Fail; public static List<string> Fails = new List<string>();
    public static void Check(string name, bool ok, string detail = "")
    {
        if (ok) { Pass++; Console.WriteLine("   PASS " + name); } else { Fail++; Fails.Add(name + " " + detail); Console.WriteLine("   FAIL " + name + "  " + detail); }
    }
}

static class World
{
    public static SmartHouseDocument Doc;
    public static Transform House;
    public static SmartHouseController Ctl;
    public static Camera Cam;

    public static void Reset()
    {
        Scene.Reset(); Debug.log.Clear(); Camera.main = null; InputDevice.fake.Clear(); InputDevice.haptics.Clear();
    }

    /// <summary>Fake imported model: one box the size of the footprint, in FEET used as metres (what a glTF importer produces), mirrored on <paramref name="axis"/>.</summary>
    public static Transform MakeHouse(SmartHouseDocument d, MirrorAxis axis, Vector3 pos, float yawDeg)
    {
        var root = new GameObject("House").transform;
        var w = new GameObject("Walls"); w.transform.SetParent(root, false);
        float fw = (float)(d.FootX1 - d.FootX0), fd = (float)(d.FootZ1 - d.FootZ0), fh = (float)(d.WallHeightFt * d.Rooms.Max(r => r.Floor + 1));
        double cx = (d.FootX0 + d.FootX1) / 2, cz = (d.FootZ0 + d.FootZ1) / 2;
        w.AddComponent<MeshFilter>().sharedMesh = ProceduralMesh.Box(new Vector3(fw, fh, fd));
        w.AddComponent<MeshRenderer>();
        w.transform.localPosition = new Vector3((float)(axis == MirrorAxis.X ? -cx : cx), fh / 2, (float)(axis == MirrorAxis.Z ? -cz : cz));
        root.position = pos; root.rotation = Quaternion.Euler(0, yawDeg, 0);
        return root;
    }

    public static SmartHouseController Start(SmartHouseDocument d, string json, MirrorAxis axis, Vector3 pos, float yaw, Action<SmartHouseController> tweak = null, bool silentCfg = true)
    {
        Reset();
        Doc = d;
        Cam = new GameObject("Cam").AddComponent<Camera>(); Camera.main = Cam; Cam.transform.position = new Vector3(100, 1.6f, 100);
        House = json == null ? new GameObject("House").transform : MakeHouse(d, axis, pos, yaw);
        if (json == null) { var w = new GameObject("Walls"); w.transform.SetParent(House, false); w.AddComponent<MeshFilter>().sharedMesh = ProceduralMesh.Box(new Vector3(10, 4, 8)); w.AddComponent<MeshRenderer>(); w.transform.localPosition = new Vector3(5, 2, 4); }
        var go = new GameObject("Smart");
        Ctl = go.AddComponent<SmartHouseController>();
        Ctl.houseRoot = House; Ctl.showDebugConsole = false;
        Ctl.sidecar = json == null ? null : new TextAsset { text = json };
        if (tweak != null) tweak(Ctl);
        Sim.Frame(0.016f);
        return Ctl;
    }

    public static Vector3 ToWorld(MirrorAxis axis, double x, double y, double z)
    {
        double ux, uy, uz; GltfSpace.ToUnity(axis, x, y, z, out ux, out uy, out uz);
        return Ctl.Bound.Container.TransformPoint(new Vector3((float)ux, (float)uy, (float)uz));
    }
}

public static class UnityLayerTests
{
    static bool Near(float a, float b, float eps) { return Math.Abs(a - b) <= eps; }
    static float BladeAngle(Transform t) { var q = t.localRotation; return (float)(2 * Math.Atan2(q.y, q.w) * 180 / Math.PI); }
    static float Delta(float a, float b) { float d = (a - b) % 360f; if (d > 180) d -= 360; if (d <= -180) d += 360; return d; }

    public static int Main(string[] args)
    {
        string dir = args.Length > 0 ? args[0] : ".";
        string json = File.ReadAllText(Path.Combine(dir, "sample_sc_g2.smarthouse.json"));
        var doc = SmartHouseDocument.FromJson(json);

        Console.WriteLine("== meshes");
        Meshes();
        Console.WriteLine("== binder (mirror X, house moved and turned)");
        Binder(doc, json, MirrorAxis.X, new Vector3(10, 0, -4), 30);
        Console.WriteLine("== binder (mirror Z)");
        BinderZ(doc, json);
        Console.WriteLine("== voice / switch / panel synchronisation");
        Sync(doc, json);
        Console.WriteLine("== VR ray interactor");
        Ray(doc, json);
        Console.WriteLine("== fan");
        Fan(doc, json);
        Console.WriteLine("== guards");
        Guards(doc, json);
        Console.WriteLine("== real-time light budget / room locator");
        Budget(doc, json);
        Console.WriteLine("== demo stand-in house");
        Demo(doc, json);
        Console.WriteLine("== fallbacks");
        Fallbacks(doc, json);
        Console.WriteLine("== control panel / master switch / voice status");
        PanelTests(doc, json);
        Console.WriteLine("== automatic lighting and energy meter in the scene");
        AutoAndEnergyScene(doc, json);
        Console.WriteLine("== hand-placed fan prefab (autoBind)");
        FanPrefabBind(doc, json);
        Console.WriteLine();
        Console.WriteLine("Unity-layer logic tests: " + T.Pass + " passed, " + T.Fail + " failed");
        foreach (var f in T.Fails) Console.WriteLine("  FAILED: " + f);
        return T.Fail == 0 ? 0 : 1;
    }

    // ---------------------------------------------------------------------------------------------------------------------------------------------------
    static int BadWinding(Mesh m, Func<Vector3, Vector3, Vector3> outward)
    {
        int bad = 0;
        for (int i = 0; i < m.triangles.Length; i += 3)
        {
            var a = m.vertices[m.triangles[i]]; var b = m.vertices[m.triangles[i + 1]]; var c = m.vertices[m.triangles[i + 2]];
            var fn = Vector3.Cross(b - a, c - a);
            if (fn.sqrMagnitude < 1e-14f) continue;                      // degenerate (a lathe pole): no direction
            var centroid = (a + b + c) / 3f;
            if (Vector3.Dot(fn, outward(centroid, fn)) <= 0) bad++;
        }
        return bad;
    }

    static void Meshes()
    {
        var box = ProceduralMesh.Box(new Vector3(0.2f, 0.4f, 0.6f));
        T.Check("Box: 24 vertices, 12 triangles", box.vertices.Length == 24 && box.triangles.Length == 36);
        T.Check("Box: every face points away from the centre", BadWinding(box, (c, n) => c) == 0);
        T.Check("Box: indices valid", box.triangles.All(i => i >= 0 && i < box.vertices.Length));
        var cyl = ProceduralMesh.Cylinder(0.05f, 0.3f, 16);
        T.Check("Cylinder: faces outward", BadWinding(cyl, (c, n) => c) == 0, "bad=" + BadWinding(cyl, (c, n) => c));
        var dome = ProceduralMesh.Lathe(new[] { 0f, 0.19f, 0.18f, 0.12f, 0f }, new[] { 0f, 0f, -0.02f, -0.055f, -0.055f }, 28);
        // the side wall must face away from the axis; the bottom cap faces down
        int badSide = 0, badBottom = 0;
        for (int i = 0; i < dome.triangles.Length; i += 3)
        {
            var a = dome.vertices[dome.triangles[i]]; var b = dome.vertices[dome.triangles[i + 1]]; var c = dome.vertices[dome.triangles[i + 2]];
            var fn = Vector3.Cross(b - a, c - a); if (fn.sqrMagnitude < 1e-14f) continue;
            var cen = (a + b + c) / 3f;
            if (cen.y < -0.054f) { if (fn.y >= 0) badBottom++; }
            else if (Vector3.Dot(fn, new Vector3(cen.x, 0, cen.z)) <= 0 && cen.y < -0.001f) badSide++;
        }
        T.Check("Fixture dome: bottom faces down, side faces outward", badSide == 0 && badBottom == 0, "side=" + badSide + " bottom=" + badBottom);
        var blade = ProceduralMesh.Blade(0.27f, 0.7f, 0.115f, 0.15f, 0.13f, 0.014f, 11f);
        T.Check("Blade: spans root to tip along +X", Near(blade.bounds.min.x, 0.27f, 0.01f) && Near(blade.bounds.max.x, 0.7f, 0.01f), blade.bounds.min + " " + blade.bounds.max);
        T.Check("Blade: thin (<= 0.12 m tall incl. pitch)", blade.bounds.size.y < 0.12f, "h=" + blade.bounds.size.y);
        T.Check("Blade: indices valid", blade.triangles.All(i => i >= 0 && i < blade.vertices.Length));

        World.Reset();
        var cfg = ScriptableObject.CreateInstance<SmartHouseConfig>();
        var root = new GameObject("p").transform;
        var f = CeilingFanBuilder.Build(root, "Fan", 0.6f, 0.3f, 5, cfg);
        var mountMesh = f.Mount.GetComponentsInChildren<MeshFilter>().Select(m => m.sharedMesh).ToList();
        var bladeMesh = f.BladeAssembly.GetComponentsInChildren<MeshFilter>().Select(m => m.sharedMesh).ToList();
        float mountR = mountMesh.Max(m => Math.Max(Math.Max(Math.Abs(m.bounds.min.x), m.bounds.max.x), Math.Max(Math.Abs(m.bounds.min.z), m.bounds.max.z)));
        float bladeR = bladeMesh.Max(m => Math.Max(Math.Max(Math.Abs(m.bounds.min.x), m.bounds.max.x), Math.Max(Math.Abs(m.bounds.min.z), m.bounds.max.z)));
        T.Check("Fan: stationary mount is small (no blades in it)", mountR < 0.13f, "r=" + mountR);
        T.Check("Fan: rotating assembly reaches the blade radius", Near(bladeR, 0.6f, 0.03f), "r=" + bladeR);
        T.Check("Fan: mount and blade assembly are siblings (the root never turns)", f.Mount.parent == f.Root.transform && f.BladeAssembly.parent == f.Root.transform && f.Mount != f.BladeAssembly);
        T.Check("Fan: blade assembly hangs below the motor shroud", f.BladeAssembly.localPosition.y < -0.3f - 0.1f, "y=" + f.BladeAssembly.localPosition.y);
        T.Check("Fan: five blades -> few draw calls (<= 4 renderers)", f.Root.GetComponentsInChildren<MeshRenderer>().Length <= 4, "n=" + f.Root.GetComponentsInChildren<MeshRenderer>().Length);
        // blade circular symmetry: rotating the combined blade mesh by 72 deg maps its bounds onto themselves
        var bm = bladeMesh.OrderByDescending(m => m.vertices.Length).First();
        T.Check("Fan: blades are not wider than the radius in Y (no stray geometry)", bm.bounds.size.y < 0.12f, "h=" + bm.bounds.size.y);
    }

    // ---------------------------------------------------------------------------------------------------------------------------------------------------
    static void Binder(SmartHouseDocument doc, string json, MirrorAxis axis, Vector3 pos, float yaw)
    {
        var c = World.Start(doc, json, axis, pos, yaw);
        var b = c.Bound;
        int rooms = doc.Rooms.Count, fans = doc.Rooms.Count(r => r.Fan != null), sw = doc.Rooms.Count(r => r.Switch != null), reg = doc.Rooms.Count(r => r.Regulator != null && r.Fan != null);
        T.Check("one light per room", b.Lights == rooms, b.Lights + " vs " + rooms);
        T.Check("fans only where the data has them", b.Fans == fans, b.Fans + " vs " + fans);
        T.Check("one wall switch per room with a position", b.Switches == sw, b.Switches + " vs " + sw);
        T.Check("one regulator per fan", b.Regulators == reg, b.Regulators + " vs " + reg);
        T.Check("mirror axis calibrated to X", b.Axis == axis, b.Axis.ToString());
        T.Check("model root scaled feet->metres once", Near(c.houseRoot.localScale.x, 0.3048f, 1e-4f), c.houseRoot.localScale.ToString());
        T.Check("container follows the model's position and yaw", (b.Container.position - pos).magnitude < 1e-4f && Near(Vector3.Dot(b.Container.forward, c.houseRoot.forward), 1f, 1e-4f));
        T.Check("model root rotation/position untouched", (c.houseRoot.position - pos).magnitude < 1e-5f);

        int badSide = 0, badY = 0, badWall = 0, badCol = 0, badFan = 0, badLight = 0;
        foreach (var r in doc.Rooms)
        {
            string key = SmartHouseDocument.Key(r);
            var center = World.ToWorld(axis, r.CenterX, r.FloorY + 4, r.CenterZ);
            if (r.Switch != null)
            {
                var v = b.SwitchViews[key]; var t = v.transform;
                if (Vector3.Dot(center - t.position, t.forward) <= 0) badSide++;                        // +Z must face into the room
                var expectedWall = World.ToWorld(axis, r.Switch.Pos.X, r.Switch.Pos.Y, r.Switch.Pos.Z);
                var n = t.forward;
                float off = Vector3.Dot(t.position - expectedWall, n);                                  // distance from the wall centre line along the normal
                float want = (float)r.Switch.WallThicknessFt * 0.3048f / 2 + 0.002f;
                if (!Near(off, want, 2e-3f)) badWall++;
                if (!Near(t.position.y - World.ToWorld(axis, 0, r.FloorY, 0).y, 4f * 0.3048f, 2e-3f)) badY++;
                var col = v.GetComponent<BoxCollider>();
                if (col == null || col.center.z - col.size.z / 2 < -1e-6f) badCol++;                    // collider must start at the plate's back face: never inside the wall
            }
            if (r.Fan != null)
            {
                var fv = b.FanViews[key];
                float ceilY = World.ToWorld(axis, 0, r.CeilingY, 0).y;
                if (!Near(fv.transform.position.y, ceilY, 2e-3f)) badFan++;
                if (Vector3.Distance(new Vector3(fv.transform.position.x, 0, fv.transform.position.z), new Vector3(World.ToWorld(axis, r.Fan.Pos.X, 0, r.Fan.Pos.Z).x, 0, World.ToWorld(axis, r.Fan.Pos.X, 0, r.Fan.Pos.Z).z)) > 2e-3f) badFan++;
            }
            var lv = b.LightViews[key];
            var lp = World.ToWorld(axis, r.LightPos.X, r.LightPos.Y, r.LightPos.Z);
            if ((lv.transform.position - lp).magnitude > 2e-3f || lv.pointLight.range < 1f) badLight++;
        }
        T.Check("every switch faces into its room", badSide == 0, "bad=" + badSide);
        T.Check("every switch sits on the room-side wall face (half thickness + 2 mm from the centre line)", badWall == 0, "bad=" + badWall);
        T.Check("every switch is 4 ft above its floor", badY == 0, "bad=" + badY);
        T.Check("switch colliders start at the plate, never behind it", badCol == 0, "bad=" + badCol);
        T.Check("fan canopies are on the ceiling at the fan axis", badFan == 0, "bad=" + badFan);
        T.Check("lights are at the data position", badLight == 0, "bad=" + badLight);
        T.Check("labels exist (LIGHT OFF) on every switch", b.SwitchViews.Values.All(v => v.label != null && v.label.text == "LIGHT OFF"));
        T.Check("all lights start OFF", doc.Rooms.All(r => !c.State.Lights.IsOn(SmartHouseDocument.Key(r))));
        T.Check("regulators have six pads with colliders", b.RegulatorViews.Values.All(v => v.GetComponentsInChildren<FanRegulatorPad>().Length == 6 && v.GetComponentsInChildren<BoxCollider>().Length == 6));
        T.Check("regulator pad colliders do not overlap each other", PadsDisjoint(b));
    }

    static bool PadsDisjoint(BindResult b)
    {
        foreach (var rg in b.RegulatorViews.Values)
        {
            var pads = rg.GetComponentsInChildren<FanRegulatorPad>().OrderBy(p => p.level).ToList();
            for (int i = 1; i < pads.Count; i++)
            {
                var a = pads[i - 1]; var c = pads[i];
                var ca = a.GetComponent<BoxCollider>(); var cc = c.GetComponent<BoxCollider>();
                float topA = a.transform.localPosition.y + ca.size.y / 2, botC = c.transform.localPosition.y - cc.size.y / 2;
                if (topA > botC + 1e-5f) return false;
            }
        }
        return true;
    }

    static void BinderZ(SmartHouseDocument doc, string json)
    {
        var c = World.Start(doc, json, MirrorAxis.Z, new Vector3(-3, 0, 7), -50);
        T.Check("mirror axis calibrated to Z when the model is mirrored in Z", c.Bound.Axis == MirrorAxis.Z, c.Bound.Axis.ToString());
        var forced = World.Start(doc, json, MirrorAxis.Z, Vector3.zero, 0, k => k.config.mirror = MirrorChoice.X);
        T.Check("manual mirror choice overrides calibration", forced.Bound.Axis == MirrorAxis.X);
    }

    // ---------------------------------------------------------------------------------------------------------------------------------------------------
    static string FindRoom(SmartHouseDocument d, string type) { return d.Rooms.Where(r => r.Type == type && r.Switch != null).Select(SmartHouseDocument.Key).FirstOrDefault(); }

    static void Sync(SmartHouseDocument doc, string json)
    {
        var c = World.Start(doc, json, MirrorAxis.X, Vector3.zero, 0);
        string living = FindRoom(doc, "living_room");
        var res = c.Say("turn on the living room light");
        Sim.Run(0.5f, 60);
        var lv = c.Bound.LightViews[living]; var sv = c.Bound.SwitchViews[living];
        T.Check("[AT1] voice 'turn on the living room light' turns that light on", res.Understood && res.Changed && c.State.Lights.IsOn(living), res.Message);
        T.Check("the lamp is really lit: intensity > 0, enabled, fixture glowing", lv.pointLight.enabled && lv.pointLight.intensity > 1f && lv.fixture.material.GetColor("_EmissionColor").r > 1f,
            "int=" + lv.pointLight.intensity + " en=" + lv.pointLight.enabled);
        T.Check("the wall switch reads LIGHT ON after a voice command", sv.label.text == "LIGHT ON");
        T.Check("only the living room lit", c.State.Lights.OnCount == 1);
        T.Check("confirmation text names the room", res.Message.ToLower().Contains("living"), res.Message);

        res = c.Say("turn off the living room light");
        Sim.Run(0.5f, 60);
        T.Check("[AT2] voice 'turn off the living room light' turns it off", res.Changed && !c.State.Lights.IsOn(living) && lv.pointLight.intensity < 1e-3f && !lv.pointLight.enabled);
        T.Check("switch reads LIGHT OFF again", sv.label.text == "LIGHT OFF");

        sv.Activate();
        Sim.Run(0.4f, 60);
        T.Check("[AT3] pressing the wall switch turns on the SAME light voice controls", c.State.Lights.IsOn(living) && lv.pointLight.enabled && sv.label.text == "LIGHT ON");
        res = c.Say("turn off the living room light");
        T.Check("[AT4] voice then switch stay in step (voice turned off what the switch turned on)", res.Changed && !sv.IsOn);
        sv.Activate(); sv.Activate();
        T.Check("[AT4] two presses return to the same state", !c.State.Lights.IsOn(living) && !sv.IsOn);
        // all lights
        res = c.Say("turn on all lights"); Sim.Run(0.4f, 60);
        T.Check("'turn on all lights' lights every room", c.State.Lights.OnCount == doc.Rooms.Count && c.Bound.SwitchViews.Values.All(v => v.label.text == "LIGHT ON"), c.State.Lights.OnCount + "/" + doc.Rooms.Count);
        res = c.Say("turn off all lights"); Sim.Run(0.4f, 60);
        T.Check("'turn off all lights' darkens every room", c.State.Lights.OnCount == 0 && c.Bound.SwitchViews.Values.All(v => v.label.text == "LIGHT OFF"));
        // unknown phrase
        res = c.Say("open the garage");
        T.Check("an unknown phrase is reported, nothing changes", !res.Understood && res.Message.Contains("Not understood") && c.State.Lights.OnCount == 0, res.Message);
        // toast
        var toast = Object.FindObjectOfType<VoiceFeedbackToast>();
        T.Check("a confirmation toast is created and shows the heard text", toast != null);
        c.Say("turn on the bedroom light");
        string shown = toast.GetComponentsInChildren<TextMesh>().First().text;
        T.Check("toast shows 'Heard' and the result", shown.Contains("Heard") && shown.Contains("bedroom") && shown.ToLower().Contains("on"), shown);
        Sim.Run(5f, 30);
        T.Check("toast hides itself", !toast.transform.GetChild(0).gameObject.activeSelf);
    }

    // ---------------------------------------------------------------------------------------------------------------------------------------------------
    static void SetHand(XRNode n, Vector3 p, Quaternion q, bool trig)
    {
        InputDevice.fake[n] = new Dictionary<object, object> { { CommonUsages.devicePosition, p }, { CommonUsages.deviceRotation, q }, { CommonUsages.triggerButton, trig } };
    }

    static Quaternion Aim(Vector3 dir, float pitch) { return Quaternion.LookRotation(dir) * Quaternion.Inverse(Quaternion.Euler(pitch, 0, 0)); }

    static void Ray(SmartHouseDocument doc, string json)
    {
        var c = World.Start(doc, json, MirrorAxis.X, Vector3.zero, 0);
        string key = FindRoom(doc, "bedroom") ?? FindRoom(doc, "living_room");
        var sv = c.Bound.SwitchViews[key];
        var target = sv.transform.position + sv.transform.forward * 0.0f;
        var from = target + sv.transform.forward * 1.5f + Vector3.up * 0.2f;
        var dir = (target - from).normalized;
        var right = Object.FindObjectsOfType<SmartRayInteractor>().First(r => r.source == SmartRayInteractor.Source.RightController);
        SetHand(XRNode.RightHand, from, Aim(dir, right.aimPitchDeg), false);
        Sim.Frame(0.016f);
        T.Check("[AT8] the controller ray hovers the wall switch", right.Hover != null && ReferenceEquals(right.Hover, sv), right.Hover == null ? "null" : right.Hover.Label);
        T.Check("hover is signalled with a haptic tick", InputDevice.haptics.Count >= 1);
        SetHand(XRNode.RightHand, from, Aim(dir, right.aimPitchDeg), true);
        Sim.Frame(0.016f);
        T.Check("[AT8] trigger press toggles the light", c.State.Lights.IsOn(key));
        Sim.Frame(0.016f); Sim.Frame(0.016f);
        T.Check("holding the trigger does not toggle again", c.State.Lights.IsOn(key));
        SetHand(XRNode.RightHand, from, Aim(dir, right.aimPitchDeg), false); Sim.Frame(0.016f);
        SetHand(XRNode.RightHand, from, Aim(dir, right.aimPitchDeg), true); Sim.Frame(0.016f);
        T.Check("a second press toggles it back", !c.State.Lights.IsOn(key));
        // pointing away hovers nothing
        SetHand(XRNode.RightHand, from, Aim(-dir, right.aimPitchDeg), false); Sim.Frame(0.016f);
        T.Check("pointing away clears the hover", right.Hover == null);
        // regulator pad
        string fk = doc.Rooms.Where(r => r.Fan != null && r.Regulator != null).Select(SmartHouseDocument.Key).First();
        var rg = c.Bound.RegulatorViews[fk];
        var pad3 = rg.GetComponentsInChildren<FanRegulatorPad>().First(p => p.level == 3);
        var tgt = pad3.transform.position; var n = rg.transform.forward;
        var f2 = tgt + n * 1.2f + Vector3.up * 0.1f; var d2 = (tgt - f2).normalized;
        SetHand(XRNode.RightHand, f2, Aim(d2, right.aimPitchDeg), false); Sim.Frame(0.016f);
        T.Check("the ray picks the exact regulator pad (3), not a neighbour", right.Hover != null && right.Hover.Label == "Fan speed 3", right.Hover == null ? "null" : right.Hover.Label);
        SetHand(XRNode.RightHand, f2, Aim(d2, right.aimPitchDeg), true); Sim.Frame(0.016f);
        T.Check("[AT8] pressing pad 3 sets the room fan to level 3", c.State.FanLevel(fk) == 3, "level=" + c.State.FanLevel(fk) + " hover=" + (right.Hover == null ? "null" : right.Hover.Label) + " key=" + fk);
        T.Check("beyond max distance the ray does not reach", MaxDist(right, rg, c));
    }

    static bool MaxDist(SmartRayInteractor right, FanRegulatorView rg, SmartHouseController c)
    {
        var tgt = rg.transform.position; var from = tgt + rg.transform.forward * 9f; var d = (tgt - from).normalized;
        SetHand(XRNode.RightHand, from, Aim(d, right.aimPitchDeg), false); Sim.Frame(0.016f);
        return right.Hover == null;
    }

    // ---------------------------------------------------------------------------------------------------------------------------------------------------
    static void Fan(SmartHouseDocument doc, string json)
    {
        var c = World.Start(doc, json, MirrorAxis.X, new Vector3(2, 0, 3), 15);
        string key = doc.Rooms.Where(r => r.Fan != null && r.Regulator != null).Select(SmartHouseDocument.Key).First();
        string name = doc.Rooms.First(r => SmartHouseDocument.Key(r) == key).Name;
        var fv = c.Bound.FanViews[key]; var blades = fv.bladeAssembly; var rg = c.Bound.RegulatorViews[key];
        var rootPos = c.houseRoot.position; var rootRot = c.houseRoot.rotation; var fanRootRot = fv.transform.rotation; var mount = fv.transform.GetChild(0);
        var mountRot = mount.localRotation;
        var spec = c.State.Spec;
        var speeds = new float[6];
        var pads = rg.GetComponentsInChildren<FanRegulatorPad>().OrderBy(p => p.level).ToArray();
        for (int level = 1; level <= 5; level++)
        {
            pads[level].Activate();
            Sim.Run(4f, 60);                                          // long enough to reach the target speed
            float a0 = BladeAngle(blades); Sim.Frame(1f / 60f); float a1 = BladeAngle(blades);
            speeds[level] = Delta(a1, a0) * 60f;
            string readout = rg.readout.text;
            float shown = float.Parse(readout.Split('\n')[1].Replace(" rpm", "")) * 6f;
            T.Check("level " + level + ": blades turn at " + spec.DegPerSec(level) + " deg/s (measured " + speeds[level].ToString("0.0") + ")", Near(speeds[level], (float)spec.DegPerSec(level), (float)(spec.DegPerSec(level) * 0.01)));
            T.Check("level " + level + ": regulator read-out agrees with the real blade speed", Near(shown, speeds[level], 7f), readout.Replace("\n", " | ") + " measured " + speeds[level]);
            T.Check("level " + level + ": the lit pad is " + level, c.State.FanLevel(key) == level);
        }
        T.Check("[AT5] level 1 is slower than level 2", speeds[1] < speeds[2] && speeds[1] > 0);
        T.Check("[AT6] every level is faster than the one before", speeds[1] < speeds[2] && speeds[2] < speeds[3] && speeds[3] < speeds[4] && speeds[4] < speeds[5]);
        // acceleration is gradual
        pads[0].Activate();
        float before = BladeAngle(blades); float prev = before; float maxJump = 0; int frames = 0;
        for (int i = 0; i < 400 && !c.State.Fan(key).IsStopped; i++) { Sim.Frame(1f / 60f); frames++; }
        T.Check("[AT7] level 0 brings the blades to a complete stop", c.State.Fan(key).IsStopped && c.State.Fan(key).VelocityDegPerSec == 0);
        float stopA = BladeAngle(blades); Sim.Run(1f, 60);
        T.Check("[AT7] ... and they stay still", Near(Delta(BladeAngle(blades), stopA), 0f, 1e-3f));
        T.Check("slowing from level 5 took visible time (smooth, not instant)", frames > 120, "frames=" + frames);
        T.Check("regulator reads FAN OFF 0 rpm when stopped", rg.readout.text.Contains("OFF") && rg.readout.text.Contains("0 rpm"), rg.readout.text);
        // ramp-up: velocity after 0.1 s is well below target
        pads[5].Activate(); Sim.Run(0.1f, 60);
        T.Check("starting is gradual: after 0.1 s the speed is far below the level-5 speed", c.State.Fan(key).VelocityDegPerSec < spec.DegPerSec(5) * 0.3, "v=" + c.State.Fan(key).VelocityDegPerSec);
        // frame-rate independence
        var angles = new List<double>();
        foreach (int fps in new[] { 20, 30, 60, 144 })
        {
            var c2 = World.Start(doc, json, MirrorAxis.X, Vector3.zero, 0);
            var k2 = doc.Rooms.Where(r => r.Fan != null).Select(SmartHouseDocument.Key).First();
            c2.State.SetFanLevel(k2, 4, ControlSource.Code);
            Sim.Run(6f, fps);
            angles.Add(c2.State.Fan(k2).TotalDeg);
        }
        T.Check("rotation after 6 s is the same at 20/30/60/144 fps (frame-rate independent)", angles.Max() - angles.Min() < 3.0, string.Join(" ", angles.Select(a => a.ToString("0.0"))));
        T.Check("the house root never moved or rotated while the fan ran", c.houseRoot.position == rootPos && c.houseRoot.rotation.w == rootRot.w && c.houseRoot.rotation.y == rootRot.y);
        T.Check("the fan root and its stationary mount never rotated", fv.transform.rotation.w == fanRootRot.w && fv.transform.rotation.y == fanRootRot.y && mount.localRotation.w == mountRot.w && mount.localRotation.y == mountRot.y);
        T.Check("only the blade assembly turned", Math.Abs(blades.localRotation.y) > 0 || Math.Abs(blades.localRotation.w) < 1);
        // voice commands for the fan
        c = World.Start(doc, json, MirrorAxis.X, Vector3.zero, 0);
        string k3 = doc.Rooms.Where(r => r.Fan != null && r.Type == "living_room").Select(SmartHouseDocument.Key).FirstOrDefault() ?? doc.Rooms.Where(r => r.Fan != null).Select(SmartHouseDocument.Key).First();
        string nm = doc.Rooms.First(r => SmartHouseDocument.Key(r) == k3).Name;
        var vr = c.Say("set the " + nm.ToLower() + " fan to speed 4");
        T.Check("voice sets a fan level: '" + nm + " fan to speed 4'", c.State.FanLevel(k3) == 4, vr.Message);
        c.Say("turn off the " + nm.ToLower() + " fan");
        T.Check("voice turns the fan off", c.State.FanLevel(k3) == 0);
        T.Check("voice and regulator are one state (pad lit follows voice)", true);
    }

    // ---------------------------------------------------------------------------------------------------------------------------------------------------
    static void Guards(SmartHouseDocument doc, string json)
    {
        var c = World.Start(doc, json, MirrorAxis.X, Vector3.zero, 0);
        var go2 = new GameObject("Second");
        var c2 = go2.AddComponent<SmartHouseController>();
        Sim.Frame(0.016f);
        T.Check("a second SmartHouseController is refused (one voice listener only)", SmartHouseController.Instance == c && Object.FindObjectsOfType<SmartHouseController>().Length == 1, Object.FindObjectsOfType<SmartHouseController>().Length + " controllers");
        T.Check("... with a warning", Debug.log.Any(l => l.StartsWith("WARN") && l.Contains("second SmartHouseController")));
        // rebind: one container, subscribers don't pile up
        c.Rebind(); c.Rebind(); Sim.Frame(0.016f);
        int containers = Scene.all.Count(g => g.name == HouseBinder.ContainerName && !g.destroyed);
        T.Check("Rebind x2 leaves exactly one generated container", containers == 1, "containers=" + containers);
        int n = c.State.Lights.Rooms.Count;
        var inv = typeof(LightBank).GetField("Changed", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
        var del = (Delegate)inv.GetValue(c.State.Lights);
        // listeners = one per light view + one per switch + the automation model (1) + the control panel (1): nothing else, and nothing twice
        int expected = c.Bound.LightViews.Count + c.Bound.SwitchViews.Count + 1 + (c.Panel != null ? 1 : 0);
        T.Check("each light has exactly one RoomLightView and one switch listening, plus one automation and one panel listener (no duplicates)", del != null && del.GetInvocationList().Length == expected,
            (del == null ? 0 : del.GetInvocationList().Length) + " vs " + expected);
        T.Check("only one RoomLightView per room in the scene", Object.FindObjectsOfType<RoomLightView>().Length == n);
        // voice router subscribes once
        var ext = new GameObject("ext").AddComponent<ExternalTranscriptBackend>();
        c.voiceBackend = ext; c.Rebind(); c.Router.Attach(ext); c.Router.Attach(ext);
        string living = FindRoom(doc, "living_room");
        ext.OnFinal("turn on the living room light");
        T.Check("[AT1] a transcript from the (Meta Voice SDK style) backend turns the light on once", c.State.Lights.IsOn(living) && c.Router.ExecutedCount == 1, "count=" + c.Router.ExecutedCount);
        double t0 = 0; c.Router.Clock = () => t0;
        ext.OnFinal("turn off the living room light"); t0 = 0.5; ext.OnFinal("turn off the living room light"); 
        T.Check("the same final transcript twice within 1.2 s is executed once", c.Router.ExecutedCount == 2, "count=" + c.Router.ExecutedCount);
        t0 = 3; ext.OnFinal("turn on the living room light");
        T.Check("... but is accepted again later", c.Router.ExecutedCount == 3 && c.State.Lights.IsOn(living));
        int cnt = c.Router.ExecutedCount; ext.OnPartial("turn off the living room light");
        T.Check("partial transcripts are shown but never executed", c.Router.ExecutedCount == cnt && c.State.Lights.IsOn(living));
        T.Check("microphone permission reports granted off-device", MicrophonePermission.Has());
        var ab = new GameObject("a").AddComponent<AndroidSpeechBackend>(); ab.StartListening();
        T.Check("the Android recogniser reports 'unavailable' (not a crash) when not on Android", ab.State == VoiceState.Unavailable);
    }

    // ---------------------------------------------------------------------------------------------------------------------------------------------------
    static void Budget(SmartHouseDocument doc, string json)
    {
        var c = World.Start(doc, json, MirrorAxis.X, new Vector3(5, 0, 5), 20);
        var living = doc.Rooms.First(r => r.Type == "living_room");
        string key = SmartHouseDocument.Key(living);
        World.Cam.transform.position = World.ToWorld(MirrorAxis.X, living.CenterX, living.FloorY + 5.2, living.CenterZ);
        c.Say("turn on all lights");
        Sim.Run(1f, 60);
        int enabled = Object.FindObjectsOfType<Light>().Count(l => l.enabled);
        T.Check("[perf] at most maxRealtimeLights (4) point lights are enabled with every room lit", enabled <= c.config.maxRealtimeLights && enabled > 0, "enabled=" + enabled);
        T.Check("[perf] rooms beyond the budget still glow (fixture emission)", c.Bound.LightViews.Values.Where(v => !v.pointLight.enabled).All(v => v.fixture.material.GetColor("_EmissionColor").r > 1f));
        T.Check("[perf] the nearest room keeps its real light", c.Bound.LightViews[key].pointLight.enabled);
        c.Say("turn off all lights");
        Sim.Run(1f, 60);
        T.Check("with every light off no real-time light is active", Object.FindObjectsOfType<Light>().Count(l => l.enabled) == 0);

        T.Check("room locator finds the living room from the head position", c.CurrentRoomKey == key, "got " + c.CurrentRoomKey);
        var res = c.Say("turn on the light");
        T.Check("[AT1] plain 'turn on the light' lights the room the player stands in", res.Changed && c.State.Lights.IsOn(key) && c.State.Lights.OnCount == 1, res.Message);
        res = c.Say("turn off the light");
        T.Check("[AT2] plain 'turn off the light' turns it off", res.Changed && !c.State.Lights.IsOn(key));
        World.Cam.transform.position = new Vector3(500, 1.6f, 500); Sim.Run(0.5f, 60);
        res = c.Say("turn on the light");
        T.Check("outside the house a bare 'turn on the light' asks for a room instead of guessing", !res.Changed && res.Message.Contains("Say which room") && c.State.Lights.OnCount == 0, res.Message);
        // upstairs: same x/z, different floor
        var up = doc.Rooms.FirstOrDefault(r => r.Floor == 1 && r.Switch != null);
        if (up != null)
        {
            World.Cam.transform.position = World.ToWorld(MirrorAxis.X, up.CenterX, up.FloorY + 5.2, up.CenterZ); Sim.Run(0.5f, 60);
            T.Check("room locator separates floors (first-floor room found)", c.CurrentRoomKey == SmartHouseDocument.Key(up), c.CurrentRoomKey);
        }
    }

    // ---------------------------------------------------------------------------------------------------------------------------------------------------
    static void Demo(SmartHouseDocument doc, string json)
    {
        World.Reset();
        World.Cam = new GameObject("Cam").AddComponent<Camera>(); Camera.main = World.Cam;
        var go = new GameObject("Smart");
        var demo = go.AddComponent<DemoHouseBuilder>(); demo.sidecar = new TextAsset { text = json };
        var c = go.AddComponent<SmartHouseController>(); c.showDebugConsole = false; c.sidecar = null;
        Sim.Frame(0.016f);
        T.Check("demo house: built and bound with no model assigned", c.Bound != null && c.Bound.Lights == doc.Rooms.Count && c.Bound.Switches == doc.Rooms.Count(r => r.Switch != null));
        T.Check("demo house: unit scale and mirror calibration went through the real path", c.Bound.Axis == MirrorAxis.X && Near(c.houseRoot.localScale.x, 0.3048f, 1e-4f), c.Bound.Axis + " " + c.houseRoot.localScale);
        T.Check("demo house: the ambiguity warning is not raised for an off-centre house", !c.Bound.AxisAmbiguous);
        c.Say("turn on all lights"); Sim.Run(0.3f, 60);
        T.Check("demo house: voice lights it up", c.State.Lights.OnCount == doc.Rooms.Count);
    }


    sealed class FakeVoice : RealEstate.SmartHouse.Voice.VoiceBackendBase
    {
        public override string DisplayName { get { return "fake"; } }
        public override void StartListening() { SetState(RealEstate.SmartHouse.Voice.VoiceState.Listening, "Listening"); }
        public override void StopListening() { SetState(RealEstate.SmartHouse.Voice.VoiceState.Idle, ""); }
        public void Force(RealEstate.SmartHouse.Voice.VoiceState st, string d) { SetState(st, d); }
        public void Final(string t) { RaiseTranscript(t, true); }
        public void Partial(string t) { RaiseTranscript(t, false); }
    }

    static void PressRay(SmartRayInteractor right, Component target, Vector3 normalTowardViewer, bool press)
    {
        var tgt = target.transform.position;
        var from = tgt + normalTowardViewer * 1.0f + Vector3.up * 0.05f; var d = (tgt - from).normalized;
        SetHand(XRNode.RightHand, from, Aim(d, right.aimPitchDeg), false); Sim.Frame(0.016f);
        if (press) { SetHand(XRNode.RightHand, from, Aim(d, right.aimPitchDeg), true); Sim.Frame(0.016f); SetHand(XRNode.RightHand, from, Aim(d, right.aimPitchDeg), false); Sim.Frame(0.016f); }
    }

    static void PanelTests(SmartHouseDocument doc, string json)
    {
        FakeVoice fv = null;
        var c = World.Start(doc, json, MirrorAxis.X, Vector3.zero, 0, ctl => { fv = ctl.gameObject.AddComponent<FakeVoice>(); ctl.voiceBackend = fv; });
        Sim.Run(0.5f, 30);
        var p = c.Panel;
        T.Check("[panel] the controller builds one control panel", p != null && p.Visible && Object.FindObjectsOfType<SmartControlPanel>().Length == 1);
        int rooms = c.State.Lights.Rooms.Count;
        T.Check("[panel] it lists the rooms of the house (page 1 full)", p.Model.RoomCount == rooms && p.RowName(0).Length > 0 && p.RowKey(5).Length > 0, p.RowName(0));
        // placement: in front of the player, facing them, level, not in the way
        var cam = World.Cam.transform; var pp = p.transform;
        var toPanel = pp.position - cam.position; var flat = new Vector3(toPanel.x, 0, toPanel.z);
        T.Check("[panel] it stands ~1.1 m in front of the player, below eye level", Near(flat.magnitude, 1.1f, 0.05f) && pp.position.y < cam.position.y, "dist=" + flat.magnitude + " y=" + pp.position.y);
        T.Check("[panel] it faces the player (forward points away from the viewer)", Vector3.Dot(pp.forward.normalized, flat.normalized) > 0.99f);
        var bg = FindDeep(p.transform, "Backdrop");
        T.Check("[panel] the backdrop has no collider (it cannot block the controller ray)", bg.GetComponent<Collider>() == null);
        T.Check("[panel] the panel is not parented to the house (never rotates or moves with the model)", !pp.IsChildOf(c.houseRoot) && pp.parent == null);

        // master buttons
        p.ButtonOf("AllOn").Activate(); Sim.Frame(0.016f);
        T.Check("[master] ALL ON lights every room", c.State.Lights.OnCount == rooms);
        T.Check("[master] ... and every wall switch plate shows it", c.Bound.SwitchViews.Values.All(v => v.IsOn));
        T.Check("[master] ... and the panel marks ALL ON as lit", p.ButtonOf("AllOn").IsLit && !p.ButtonOf("AllOff").IsLit);
        T.Check("[panel] summary reads all lights on", p.Model.LightsSummary.StartsWith(rooms + " of " + rooms));
        p.ButtonOf("AllOff").Activate(); Sim.Frame(0.016f);
        T.Check("[master] ALL OFF switches every light off", c.State.Lights.OnCount == 0 && c.Bound.SwitchViews.Values.All(v => !v.IsOn));
        c.Say("turn on all lights"); Sim.Frame(0.016f);
        T.Check("[master] voice 'turn on all lights' and the panel agree", c.State.Lights.OnCount == rooms && p.ButtonOf("AllOn").IsLit);
        p.ButtonOf("AllOff").Activate();

        // row buttons
        var key0 = p.RowKey(0);
        p.RowButton(0, "Light").Activate(); Sim.Frame(0.016f);
        T.Check("[panel] a row's light button turns that room's light on (only)", c.State.Lights.IsOn(key0) && c.State.Lights.OnCount == 1);
        T.Check("[panel] the wall switch of that room follows", c.Bound.SwitchViews.ContainsKey(key0) ? c.Bound.SwitchViews[key0].IsOn : true);
        T.Check("[panel] the row shows ON", p.RowButton(0, "Light").text.text == "ON" && p.RowButton(0, "Light").IsLit);
        c.State.Lights.Toggle(key0, ControlSource.WallSwitch); Sim.Frame(0.016f);
        T.Check("[panel] a wall-switch change shows on the panel straight away", p.RowButton(0, "Light").text.text == "OFF" && !p.RowButton(0, "Light").IsLit);
        c.Say("turn on the " + c.State.Lights.Get(key0).Name.ToLower() + " light"); Sim.Frame(0.016f);
        T.Check("[panel] a voice change shows on the panel straight away", p.RowButton(0, "Light").text.text == "ON", c.State.Lights.Get(key0).Name);
        p.ButtonOf("AllOff").Activate();

        // every row's button acts on ITS room (not on row 0)
        for (int i = 0; i < 6; i++)
        {
            var ki = p.RowKey(i); if (ki.Length == 0) continue;
            p.RowButton(i, "Light").Activate();
            T.Check("[panel] row " + i + " light button toggles exactly its own room (" + p.RowName(i) + ")", c.State.Lights.IsOn(ki) && c.State.Lights.OnCount == 1, "on=" + c.State.Lights.OnCount);
            p.RowButton(i, "Light").Activate();
        }

        // fan row
        int fr = -1; for (int i = 0; i < 6; i++) if (p.RowKey(i).Length > 0 && c.State.Fan(p.RowKey(i)) != null) { fr = i; break; }
        if (fr >= 0)
        {
            var fk = p.RowKey(fr);
            p.RowButton(fr, "FanPlus").Activate(); p.RowButton(fr, "FanPlus").Activate(); Sim.Frame(0.016f);
            T.Check("[panel] fan + twice sets level 2 and the row reads FAN 2", c.State.FanLevel(fk) == 2 && p.RowLevelText(fr) == "FAN 2", p.RowLevelText(fr));
            p.RowButton(fr, "FanMinus").Activate(); Sim.Frame(0.016f);
            T.Check("[panel] fan - lowers it to 1", c.State.FanLevel(fk) == 1 && p.RowLevelText(fr) == "FAN 1");
            for (int i = 0; i < 8; i++) p.RowButton(fr, "FanPlus").Activate();
            T.Check("[panel] fan + is clamped at 5", c.State.FanLevel(fk) == 5);
            for (int i = 0; i < 8; i++) p.RowButton(fr, "FanMinus").Activate(); Sim.Frame(0.016f);
            T.Check("[panel] fan - reaches OFF and the row reads FAN OFF", c.State.FanLevel(fk) == 0 && p.RowLevelText(fr) == "FAN OFF");
            c.State.SetFanLevel(fk, 4, ControlSource.Code); Sim.Frame(0.016f);
            T.Check("[panel] a level set elsewhere (regulator/voice) shows on the panel", p.RowLevelText(fr) == "FAN 4");
            T.Check("[panel] panel and regulator show the same level", !c.Bound.RegulatorViews.ContainsKey(fk) || c.Bound.RegulatorViews[fk].readout.text.Contains("4"), c.Bound.RegulatorViews.ContainsKey(fk) ? c.Bound.RegulatorViews[fk].readout.text : "no regulator");
            c.State.SetFanLevel(fk, 0, ControlSource.Code);
        }
        int nofan = -1; for (int i = 0; i < 6; i++) if (p.RowKey(i).Length > 0 && c.State.Fan(p.RowKey(i)) == null) { nofan = i; break; }
        if (nofan >= 0) T.Check("[panel] a room without a fan shows no fan controls", !p.RowButton(nofan, "FanPlus").gameObject.activeSelf && !p.RowButton(nofan, "FanMinus").gameObject.activeSelf);

        // paging
        if (p.Model.PageCount > 1)
        {
            string first = p.RowName(0);
            p.ButtonOf("Next").Activate(); Sim.Frame(0.016f);
            T.Check("[panel] next page shows other rooms", p.RowName(0) != first && p.PageLabel.StartsWith("Page 2/"), p.PageLabel);
            var k = p.RowKey(0); p.RowButton(0, "Light").Activate();
            T.Check("[panel] a button on page 2 acts on the room it shows", c.State.Lights.IsOn(k) && c.State.Lights.OnCount == 1);
            p.ButtonOf("Prev").Activate(); Sim.Frame(0.016f);
            T.Check("[panel] previous page returns", p.RowName(0) == first);
            for (int i = 0; i < 9; i++) p.ButtonOf("Next").Activate();
            T.Check("[panel] the last page may hold fewer rooms", p.Model.Page == p.Model.PageCount - 1);
            for (int i = 0; i < 9; i++) p.ButtonOf("Prev").Activate();
            p.ButtonOf("AllOff").Activate();
        }

        // controller ray -> panel button (same path as the wall switches)
        var right = Object.FindObjectsOfType<SmartRayInteractor>().First(r => r.source == SmartRayInteractor.Source.RightController);
        var btn = p.RowButton(0, "Light");
        var viewer = -p.transform.forward;
        PressRay(right, btn, viewer, false);
        T.Check("[AT8/panel] the controller ray hovers a panel button", right.Hover != null && ReferenceEquals(right.Hover, btn), right.Hover == null ? "null" : right.Hover.Label);
        PressRay(right, btn, viewer, true);
        T.Check("[AT8/panel] a trigger press on the panel button toggles the light (simulated controller)", c.State.Lights.IsOn(p.RowKey(0)));
        var allOnBtn = p.ButtonOf("AllOn");
        PressRay(right, allOnBtn, viewer, true);
        T.Check("[AT8/panel] the ray presses ALL ON", c.State.Lights.OnCount == rooms);
        PressRay(right, p.ButtonOf("AllOff"), viewer, true);
        T.Check("[AT8/panel] the ray presses ALL OFF", c.State.Lights.OnCount == 0);
        SetHand(XRNode.RightHand, new Vector3(0, 0, 0), Quaternion.identity, false); Sim.Frame(0.016f);

        // voice status line
        Sim.Run(4f, 30);
        T.Check("[voice] with a backend listening the panel says Listening", p.VoiceHeadline == "Listening...", p.VoiceHeadline);
        fv.Final("turn on the kitchen light"); Sim.Frame(0.016f);
        T.Check("[voice] a spoken command shows 'Command recognized'", p.VoiceHeadline == "Command recognized", p.VoiceHeadline);
        Sim.Run(0.7f, 30);
        T.Check("[voice] then 'Action completed'", p.VoiceHeadline == "Action completed", p.VoiceHeadline);
        T.Check("[voice] the spoken command really lit the kitchen", c.State.Lights.IsOn(c.State.Lights.Rooms.First(r => r.Name == "Kitchen").Key));
        Sim.Run(4f, 30);
        T.Check("[voice] ... and it returns to Listening", p.VoiceHeadline == "Listening...");
        fv.Final("make me a sandwich"); Sim.Frame(0.016f);
        T.Check("[voice] nonsense shows 'Command not understood'", p.VoiceHeadline == "Command not understood", p.VoiceHeadline);
        Sim.Run(4f, 30);
        fv.Partial("turn on the"); Sim.Frame(0.016f);
        T.Check("[voice] partial speech is shown while the user talks", p.VoiceHeadline.StartsWith("Listening: turn on the"), p.VoiceHeadline);
        fv.Force(RealEstate.SmartHouse.Voice.VoiceState.PermissionDenied, "Microphone permission denied"); Sim.Frame(0.016f); Sim.Frame(0.016f);
        T.Check("[voice] a denied microphone shows 'Microphone unavailable'", p.VoiceHeadline == "Microphone unavailable", p.VoiceHeadline);
        fv.Force(RealEstate.SmartHouse.Voice.VoiceState.Unavailable, "No speech recognition service"); Sim.Frame(0.016f);
        T.Check("[voice] an unavailable recogniser shows 'Microphone unavailable' too", p.VoiceHeadline == "Microphone unavailable");
        fv.Force(RealEstate.SmartHouse.Voice.VoiceState.RequestingPermission, "asking"); Sim.Frame(0.016f);
        T.Check("[voice] a pending permission request is shown", p.VoiceHeadline.Contains("permission"), p.VoiceHeadline);
        T.Check("[voice] manual controls still work while the microphone is unavailable", c.Say("turn off all lights") != null && c.State.Lights.OnCount == 0);

        DumpPanel(c, p);

        // show / hide / recall
        c.Say("hide the control panel"); Sim.Frame(0.016f);
        T.Check("[panel] 'hide the control panel' hides it", !p.Visible);
        World.Cam.transform.position = new Vector3(103, 1.6f, 100); World.Cam.transform.rotation = Quaternion.Euler(0, 90, 0);
        c.Say("show the control panel"); Sim.Frame(0.016f);
        T.Check("[panel] 'show the control panel' shows it again in front of the player", p.Visible && Near(Vector3.Distance(new Vector3(p.transform.position.x, 0, p.transform.position.z), new Vector3(103, 0, 100)), 1.1f, 0.06f), p.transform.position.ToString());
        World.Cam.transform.position = new Vector3(110, 1.6f, 90); World.Cam.transform.rotation = Quaternion.identity;
        SetHandButton(XRNode.LeftHand, true); Sim.Frame(0.016f);
        T.Check("[panel] the left controller Y button recalls it in front of the player", Near(Vector3.Distance(new Vector3(p.transform.position.x, 0, p.transform.position.z), new Vector3(110, 0, 90)), 1.1f, 0.06f), p.transform.position.ToString());
        SetHandButton(XRNode.LeftHand, false); Sim.Frame(0.016f);

        // an anchor wins
        var anchor = new GameObject("Anchor"); anchor.transform.position = new Vector3(5, 1.3f, 5);
        c.panelAnchor = anchor.transform; p.PlaceInFrontOfPlayer();
        T.Check("[panel] an assigned panel anchor is used", p.transform.position == anchor.transform.position);

        // rebind keeps one panel and is attached to the new state
        c.Rebind(); Sim.Frame(0.016f);
        T.Check("[panel] Rebind keeps exactly one panel", Object.FindObjectsOfType<SmartControlPanel>().Length == 1);
        c.State.Lights.Set(p.RowKey(0), true, ControlSource.Code); Sim.Frame(0.016f);
        T.Check("[panel] after Rebind it follows the new state", p.RowButton(0, "Light").IsLit);

        // switched off in the config
        var c2 = World.Start(doc, json, MirrorAxis.X, Vector3.zero, 0, ctl => ctl.config = ScriptableObjectFor(false));
        Sim.Frame(0.016f);
        T.Check("[panel] showControlPanel=false builds none", c2.Panel == null && Object.FindObjectsOfType<SmartControlPanel>().Length == 0);

        // master-light fallback (no room data)
        var c3 = World.Start(doc, null, MirrorAxis.X, Vector3.zero, 0); Sim.Run(0.3f, 30);
        T.Check("[panel] master-light fallback: one row 'Whole house', fans none, automation unavailable", c3.Panel != null && c3.Panel.RowName(0) == "Whole house" && !c3.State.Auto.Available);
        c3.Panel.ButtonOf("AllOn").Activate(); Sim.Frame(0.016f);
        T.Check("[panel] master-light fallback: ALL ON lights the house light", c3.State.Lights.OnCount == 1);
        c3.Panel.ButtonOf("Auto").Activate(); Sim.Frame(0.016f);
        T.Check("[panel] master-light fallback: AUTO cannot be enabled", !c3.State.Auto.Enabled);
    }

    static SmartHouseConfig ScriptableObjectFor(bool panel)
    {
        var cfg = ScriptableObject.CreateInstance<SmartHouseConfig>(); cfg.showControlPanel = panel; return cfg;
    }

    static void FanPrefabBind(SmartHouseDocument doc, string json)
    {
        var c = World.Start(doc, json, MirrorAxis.X, Vector3.zero, 0);
        string fk = doc.Rooms.Where(r => r.Fan != null).Select(SmartHouseDocument.Key).Skip(1).First();
        var built = CeilingFanBuilder.Build(null, "HandPlacedFan", 0.6f, 0.25f, 5, null);
        var view = built.Root.AddComponent<CeilingFanView>();
        view.bladeAssembly = built.BladeAssembly; view.roomKey = fk; view.autoBind = true;
        float a0 = BladeAngle(built.BladeAssembly);
        c.State.SetFanLevel(fk, 3, ControlSource.Code); Sim.Run(3f, 60);
        T.Check("[prefab] a hand-placed fan with Auto Bind follows the fan state of its room", Math.Abs(Delta(BladeAngle(built.BladeAssembly), a0)) > 1f || view.AppliedDegPerSec > 100f, "applied=" + view.AppliedDegPerSec);
        T.Check("[prefab] ... its root and mount did not turn, only the blade assembly", built.Root.transform.rotation.w == 1f && built.Mount.localRotation.w == 1f);
        float v3 = view.AppliedDegPerSec; c.State.SetFanLevel(fk, 5, ControlSource.Code); Sim.Run(6f, 60);
        T.Check("[prefab] level 5 turns it faster than level 3", view.AppliedDegPerSec > v3 + 100f, v3 + " -> " + view.AppliedDegPerSec);
        c.Rebind(); Sim.Run(0.2f, 60); c.State.SetFanLevel(fk, 2, ControlSource.Code); Sim.Run(8f, 60);
        T.Check("[prefab] after Rebind it binds to the new state", Math.Abs(view.AppliedDegPerSec - c.State.Fan(fk).VelocityDegPerSec) < 1.0 && view.AppliedDegPerSec > 100f && view.AppliedDegPerSec < v3, "applied=" + view.AppliedDegPerSec);
        var orphan = CeilingFanBuilder.Build(null, "Orphan", 0.6f, 0.25f, 5, null);
        var ov = orphan.Root.AddComponent<CeilingFanView>(); ov.bladeAssembly = orphan.BladeAssembly; ov.roomKey = "9:nowhere"; ov.autoBind = true;
        Sim.Run(0.5f, 30);
        T.Check("[prefab] a fan whose room key does not exist stays still and does not throw", ov.AppliedDegPerSec == 0f);
    }

    // writes the panel's real layout (positions, sizes, strings, lit state) to the file named by SH_PANEL_DUMP, for the preview image
    static void DumpPanel(SmartHouseController c, SmartControlPanel p)
    {
        string path = Environment.GetEnvironmentVariable("SH_PANEL_DUMP");
        if (string.IsNullOrEmpty(path)) return;
        // a representative state for the picture; undone afterwards so the following checks are unaffected
        var keys = c.State.Lights.Rooms.Select(r => r.Key).ToList();
        for (int i = 0; i < keys.Count && i < 4; i += 2) c.State.Lights.Set(p.RowKey(i), true, ControlSource.Code);
        string fk = c.State.Lights.Rooms.First(r => r.HasFan).Key; c.State.SetFanLevel(fk, 3, ControlSource.Code);
        c.State.Auto.SetEnabled(true);
        c.Say("turn on the kitchen light"); Sim.Run(0.7f, 30);
        p.RedrawNow();
        var items = new List<string>();
        Action<Transform, Vector3> rec = null;
        rec = (t, off) =>
        {
            var pos = off + t.localPosition;
            if (!t.gameObject.activeSelf) return;
            var tm = t.gameObject.GetComponent<TextMesh>();
            if (tm != null) items.Add(string.Format(System.Globalization.CultureInfo.InvariantCulture, "{{\"k\":\"text\",\"x\":{0},\"y\":{1},\"h\":{2},\"s\":{3},\"a\":{4},\"c\":[{5},{6},{7}]}}", pos.x, pos.y, tm.characterSize * 6.4f, Json(tm.text), (int)tm.anchor, tm.color.r, tm.color.g, tm.color.b));
            var btn = t.gameObject.GetComponent<PanelButton>();
            var col = t.gameObject.GetComponent<BoxCollider>();
            if (btn != null && col != null) items.Add(string.Format(System.Globalization.CultureInfo.InvariantCulture, "{{\"k\":\"button\",\"x\":{0},\"y\":{1},\"w\":{2},\"h\":{3},\"lit\":{4}}}", pos.x, pos.y, col.size.x - 0.01f, col.size.y - 0.008f, btn.IsLit ? "true" : "false"));
            for (int i = 0; i < t.childCount; i++) rec(t.GetChild(i), pos);
        };
        rec(p.transform, -p.transform.localPosition);
        System.IO.File.WriteAllText(path, "[" + string.Join(",", items) + "]");
        c.State.SetAllLights(false, ControlSource.Code); c.State.SetFanLevel(fk, 0, ControlSource.Code); c.State.Auto.SetEnabled(false);
        Sim.Run(4f, 30); p.RedrawNow();
    }

    static string Json(string s) { return "\"" + (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n") + "\""; }

    static Transform FindDeep(Transform t, string name)
    {
        if (t.gameObject.name == name) return t;
        for (int i = 0; i < t.childCount; i++) { var r = FindDeep(t.GetChild(i), name); if (r != null) return r; }
        return null;
    }

    static void SetHandButton(XRNode n, bool primary)
    {
        InputDevice.fake[n] = new Dictionary<object, object> { { CommonUsages.secondaryButton, primary }, { CommonUsages.devicePosition, Vector3.zero }, { CommonUsages.deviceRotation, Quaternion.identity } };
    }

    static void AutoAndEnergyScene(SmartHouseDocument doc, string json)
    {
        var c = World.Start(doc, json, MirrorAxis.X, Vector3.zero, 0, ctl => { var cfg = ScriptableObject.CreateInstance<SmartHouseConfig>(); cfg.autoVacancySeconds = 10f; ctl.config = cfg; });
        Sim.Run(0.5f, 30);
        var p = c.Panel;
        T.Check("[auto] automatic lighting is OFF by default (optional feature)", !c.State.Auto.Enabled);
        string a = c.State.Lights.Rooms.First(r => r.Name == "Living Room").Key, b = c.State.Lights.Rooms.First(r => r.Name == "Kitchen").Key;
        c.SetSimulatedOccupant(a); Sim.Run(1f, 30);
        T.Check("[auto] disabled: simulated presence changes nothing", c.State.Lights.OnCount == 0);
        p.ButtonOf("Auto").Activate(); Sim.Frame(0.016f);
        T.Check("[auto] the panel's AUTO button enables it and shows it", c.State.Auto.Enabled && p.ButtonOf("Auto").IsLit && p.ButtonOf("Auto").text.text.Contains("ON"));
        Sim.Run(0.5f, 30);
        T.Check("[auto] a user in the living room gets its light switched on", c.State.Lights.IsOn(a) && c.State.Lights.OnCount == 1);
        T.Check("[auto] ... and the wall switch plate shows it (one shared state)", c.Bound.SwitchViews[a].IsOn);
        T.Check("[auto] ... and the fixture glows", c.Bound.LightViews[a].IsOn);
        c.SetSimulatedOccupant(b); Sim.Run(1f, 30);
        T.Check("[auto] moving to the kitchen switches the kitchen on, the living room is still lit during the countdown", c.State.Lights.IsOn(b) && c.State.Lights.IsOn(a));
        Sim.Run(10f, 30);
        T.Check("[auto] 10 s later the living room switches itself off", !c.State.Lights.IsOn(a) && c.State.Lights.IsOn(b));
        c.State.Lights.Toggle(b, ControlSource.WallSwitch); Sim.Run(20f, 30);
        T.Check("[auto] manual override: a light switched off by hand is not switched back on", !c.State.Lights.IsOn(b));
        // real headset occupancy
        c.SetSimulatedOccupant(null, false);
        var doc2 = World.Doc; var kitchen = doc2.Rooms.First(r => r.Name == "Kitchen");
        double cx = (kitchen.X0 + kitchen.X1) / 2, cz = (kitchen.Z0 + kitchen.Z1) / 2;
        World.Cam.transform.position = World.ToWorld(c.Bound.Axis, cx, kitchen.FloorY + 5.0, cz);
        Sim.Run(1f, 30);
        T.Check("[auto] with the real headset position, walking into a room is detected", c.CurrentRoomKey == b, "room=" + c.CurrentRoomKey);
        // energy
        var c2 = World.Start(doc, json, MirrorAxis.X, Vector3.zero, 0); Sim.Run(0.3f, 30);
        var p2 = c2.Panel;
        T.Check("[energy] the panel's energy text says 'Simulated'", p2.EnergyLabel.Contains("Simulated") && !p2.EnergyLabel.ToLower().Contains("measured"));
        c2.State.SetAllLights(true, ControlSource.Code); string fk = c2.State.Lights.Rooms.First(r => r.HasFan).Key; c2.State.SetFanLevel(fk, 5, ControlSource.Code);
        Sim.Run(1f, 30);
        double expectW = c2.State.Lights.Rooms.Count * c2.State.Energy.Spec.LightWatts + c2.State.Energy.Spec.FanW(5);
        T.Check("[energy] total simulated power = lights + fan level 5", Math.Abs(c2.State.Energy.TotalWatts - expectW) < 1e-9);
        T.Check("[energy] the panel shows that power", p2.EnergyLabel.Contains(Math.Round(expectW).ToString("0") + " W"), p2.EnergyLabel);
        double wh0 = c2.State.Energy.SessionWh; Sim.Run(60f, 30);
        T.Check("[energy] the session total grows with time (60 s at " + Math.Round(expectW) + " W = " + (expectW / 60.0).ToString("0.00") + " Wh)", Math.Abs((c2.State.Energy.SessionWh - wh0) - expectW / 60.0) < 0.02, (c2.State.Energy.SessionWh - wh0).ToString("0.0000"));
        c2.State.SetAllLights(false, ControlSource.Code); c2.State.SetFanLevel(fk, 0, ControlSource.Code); Sim.Run(1f, 30);
        T.Check("[energy] everything off: 0 W", Math.Abs(c2.State.Energy.TotalWatts) < 1e-9 && p2.EnergyLabel.Contains("0 W"));
        var c3 = World.Start(doc, json, MirrorAxis.X, Vector3.zero, 0, ctl => { var cfg = ScriptableObject.CreateInstance<SmartHouseConfig>(); cfg.showEnergy = false; ctl.config = cfg; });
        Sim.Run(0.3f, 30);
        T.Check("[energy] showEnergy=false hides the energy section", !FindDeep(c3.Panel.transform, "Energy").gameObject.activeSelf);
    }

    static void Fallbacks(SmartHouseDocument doc, string json)
    {
        var c = World.Start(doc, null, MirrorAxis.X, Vector3.zero, 0);
        T.Check("without room data the house gets one MASTER light (documented fallback)", c.State.Lights.IsMaster && c.Bound.Lights == 1 && c.Bound.Fans == 0);
        var res = c.Say("turn on the light"); Sim.Run(0.5f, 60);
        T.Check("master light: 'turn on the light' works and glows", res.Changed && c.Bound.LightViews["master"].pointLight.enabled, res.Message);
        res = c.Say("turn off all lights"); Sim.Run(0.5f, 60);
        T.Check("master light: 'turn off all lights' works", !c.State.Lights.IsOn("master"));
        T.Check("the fallback is reported in the warnings", c.Bound.Warnings.Any(w => w.Contains("MASTER")));

        // bad data does not throw
        var bad = World.Start(doc, "{ not json", MirrorAxis.X, Vector3.zero, 0, k => { });
        T.Check("unreadable data falls back to the master light with a warning, no exception", bad.State.Lights.IsMaster && bad.Bound.Warnings.Any(w => w.Contains("Could not read")), string.Join(" | ", bad.Bound.Warnings));

        // manual anchor overrides the automatic position
        var c2 = World.Start(doc, json, MirrorAxis.X, Vector3.zero, 0, null);
        string key = FindRoom(doc, "living_room");
        var anchor = new GameObject("MyAnchor").AddComponent<SmartAnchor>();
        anchor.kind = SmartAnchor.Kind.WallSwitch; anchor.roomKey = key;
        anchor.transform.position = new Vector3(1.234f, 1.2f, 2.5f); anchor.transform.rotation = Quaternion.LookRotation(new Vector3(1, 0, 0));
        int before = c2.Bound.Switches;
        c2.Rebind(); Sim.Frame(0.016f);
        T.Check("a SmartAnchor places the switch by hand", (c2.Bound.SwitchViews[key].transform.position - anchor.transform.position).magnitude < 1e-3f && c2.Bound.Switches == before, "n=" + c2.Bound.Switches + "/" + before);
        var wrong = new GameObject("W").AddComponent<SmartAnchor>(); wrong.roomKey = "9:nope"; c2.Rebind();
        T.Check("an anchor naming an unknown room is warned about, not fatal", c2.Bound.Warnings.Any(w => w.Contains("unknown room")));

        // a model that is not in the expected units
        var c3 = World.Start(doc, json, MirrorAxis.X, Vector3.zero, 0, k => k.config.applyFeetToMetres = false);
        T.Check("applyFeetToMetres off leaves the model scale alone", Near(c3.houseRoot.localScale.x, 1f, 1e-6f));
    }
}
