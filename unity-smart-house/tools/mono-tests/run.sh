#!/usr/bin/env bash
# Compiles the package against stand-in UnityEngine stubs and runs both logic suites under Mono (needs `mcs` and `mono`; apt install mono-mcs mono-runtime).
set -e
cd "$(dirname "$0")/../.."
U=Packages/com.realestate.smarthouse
OUT=${TMPDIR:-/tmp}/smarthouse-tests; mkdir -p "$OUT"
echo "== core (no UnityEngine)"
mcs -langversion:7 -out:$OUT/core.exe $U/Runtime/Core/*.cs $U/Tests/Editor/CoreTests*.cs tools/mono-tests/Program.cs
mono $OUT/core.exe $U/Tests/Editor/Data
echo "== Unity layer against stubs"
mcs -langversion:7 -out:$OUT/layer.exe tools/mono-tests/stubs/*.cs $(find $U/Runtime -name '*.cs') tools/mono-tests/UnityLayerTests.cs
mono $OUT/layer.exe $U/Tests/Editor/Data | grep -E "FAIL|passed|^=="
echo "== type-check the Android code path and the Editor/test assemblies"
mcs -langversion:7 -define:UNITY_ANDROID -target:library -out:$OUT/android.dll tools/mono-tests/stubs/UnityStubs.cs tools/mono-tests/android-stubs/AndroidStubs.cs $(find $U/Runtime -name '*.cs')
mcs -langversion:7 -target:library -out:$OUT/editor.dll tools/mono-tests/stubs/UnityStubs.cs tools/mono-tests/editor-stubs/EditorStubs.cs $(find $U/Runtime $U/Editor -name '*.cs') $U/Tests/Editor/CoreTests*.cs $U/Tests/Editor/CoreNUnitTests.cs $U/Tests/PlayMode/SmartHousePlayModeTests.cs
echo "all compiled"
