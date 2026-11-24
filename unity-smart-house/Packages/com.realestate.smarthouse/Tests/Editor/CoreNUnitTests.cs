// Runs the framework-free core suite (voice grammar, light bank, fan model, room query, calibration ...) under Unity's Test Runner (Window > General > Test Runner > EditMode).
using System.IO;
using NUnit.Framework;
using UnityEditor.PackageManager;

namespace RealEstate.SmartHouse.Tests
{
    public class CoreNUnitTests
    {
        static readonly string[] Files = { "sample_sc_g2.smarthouse.json", "sample_sc_a_f50.smarthouse.json" };

        static string DataDir()
        {
            var info = PackageInfo.FindForAssembly(typeof(CoreTests).Assembly);
            Assert.NotNull(info, "package not found");
            return Path.Combine(info.resolvedPath, "Tests", "Editor", "Data");
        }

        [TestCaseSource("Files")]
        public void Core_suite_passes(string file)
        {
            var r = CoreTests.RunAll(File.ReadAllText(Path.Combine(DataDir(), file)));
            Assert.Greater(r.Tests, 10, "suite did not run");
            Assert.IsEmpty(r.Failures, string.Join("\n", r.Failures));
        }
    }
}
