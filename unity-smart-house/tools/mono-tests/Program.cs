using System;
using System.IO;
using RealEstate.SmartHouse.Tests;

static class Program
{
    static int Main(string[] args)
    {
        string dir = args.Length > 0 ? args[0] : ".";
        int rc = 0;
        foreach (var f in new[] { "sample_sc_g2.smarthouse.json", "sample_sc_a_f50.smarthouse.json" })
        {
            var r = CoreTests.RunAll(File.ReadAllText(Path.Combine(dir, f)));
            Console.WriteLine("== " + f + ": " + r.Passed.Count + "/" + r.Tests + " tests passed, " + r.Checks + " checks");
            foreach (var p in r.Passed) Console.WriteLine("   PASS " + p);
            foreach (var x in r.Failures) { Console.WriteLine("   FAIL " + x); rc = 1; }
        }
        return rc;
    }
}
