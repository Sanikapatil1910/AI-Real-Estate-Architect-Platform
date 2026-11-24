// Dependency-free JSON reader used for the smart-house sidecar (so the Core assembly needs neither Unity's JsonUtility nor a package).
// Objects -> Dictionary<string, object>, arrays -> List<object>, numbers -> double, strings, bool, null.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace RealEstate.SmartHouse.Core
{
    public static class MiniJson
    {
        public static object Parse(string json)
        {
            if (json == null) throw new ArgumentNullException(nameof(json));
            var p = new Parser(json);
            p.SkipWs();
            object v = p.Value();
            p.SkipWs();
            if (!p.End) throw new FormatException("Unexpected trailing characters at " + p.Pos);
            return v;
        }

        sealed class Parser
        {
            readonly string s; int i;
            public Parser(string s) { this.s = s; }
            public int Pos => i;
            public bool End => i >= s.Length;
            public void SkipWs() { while (i < s.Length && char.IsWhiteSpace(s[i])) i++; }
            char Peek() { if (i >= s.Length) throw new FormatException("Unexpected end of JSON"); return s[i]; }

            public object Value()
            {
                char c = Peek();
                switch (c)
                {
                    case '{': return Obj();
                    case '[': return Arr();
                    case '"': return Str();
                    case 't': Expect("true"); return true;
                    case 'f': Expect("false"); return false;
                    case 'n': Expect("null"); return null;
                    default: return Num();
                }
            }

            void Expect(string w)
            {
                if (string.CompareOrdinal(s, i, w, 0, w.Length) != 0) throw new FormatException("Expected '" + w + "' at " + i);
                i += w.Length;
            }

            Dictionary<string, object> Obj()
            {
                var d = new Dictionary<string, object>();
                i++; SkipWs();
                if (Peek() == '}') { i++; return d; }
                while (true)
                {
                    SkipWs();
                    if (Peek() != '"') throw new FormatException("Object key expected at " + i);
                    string k = Str();
                    SkipWs();
                    if (Peek() != ':') throw new FormatException("':' expected at " + i);
                    i++; SkipWs();
                    d[k] = Value();
                    SkipWs();
                    char c = Peek();
                    i++;
                    if (c == ',') continue;
                    if (c == '}') return d;
                    throw new FormatException("',' or '}' expected at " + (i - 1));
                }
            }

            List<object> Arr()
            {
                var l = new List<object>();
                i++; SkipWs();
                if (Peek() == ']') { i++; return l; }
                while (true)
                {
                    SkipWs();
                    l.Add(Value());
                    SkipWs();
                    char c = Peek();
                    i++;
                    if (c == ',') continue;
                    if (c == ']') return l;
                    throw new FormatException("',' or ']' expected at " + (i - 1));
                }
            }

            string Str()
            {
                var sb = new StringBuilder();
                i++;
                while (true)
                {
                    char c = Peek(); i++;
                    if (c == '"') return sb.ToString();
                    if (c != '\\') { sb.Append(c); continue; }
                    char e = Peek(); i++;
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (i + 4 > s.Length) throw new FormatException("Bad \\u escape");
                            sb.Append((char)int.Parse(s.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                            i += 4; break;
                        default: throw new FormatException("Bad escape \\" + e);
                    }
                }
            }

            double Num()
            {
                int st = i;
                while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
                if (st == i) throw new FormatException("Unexpected character '" + s[i] + "' at " + i);
                return double.Parse(s.Substring(st, i - st), NumberStyles.Float, CultureInfo.InvariantCulture);
            }
        }

        // ---- typed accessors (return a default instead of throwing: the sidecar is data from outside) -----------------------------------------------
        public static Dictionary<string, object> Obj(object o) { return o as Dictionary<string, object>; }
        public static List<object> Arr(object o) { return o as List<object>; }
        public static object Get(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) ? v : null; }
        public static double Num(object o, double def = 0) { return o is double ? (double)o : def; }
        public static string Str(object o, string def = "") { return o as string ?? def; }
        public static bool Bool(object o, bool def = false) { return o is bool ? (bool)o : def; }
    }
}
