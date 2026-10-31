#!/usr/bin/env python3
"""Checks saved scenario answers (tests/results/NN.md) against the expectations
in tests/scenarios/NN-*.md, and writes tests/RESULTS.md.

Common checks on every answer:
  - the fixed closing line is present, word for word;
  - every number in the answer is explained: it is in evidence.json, or it was
    given by the user in the prompt, or it is a date, a clock time, a day count,
    or listed under "allowed_numbers" in the scenario with a reason;
  - where the scenario says so: a Hebrew letter is present ("הנדון" / "לכבוד"),
    and arguments carry a score (חזקה / בינונית / חלשה);
  - the skill was actually triggered (Skill tool, or SKILL.md read).
Scenario checks: must_include, must_match, must_not_match, order,
warning_before (the "don't pay" warning comes before given items),
warning_within_chars, min_count.
"""
import json
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
SCEN = REPO / "tests" / "scenarios"
RES = REPO / "tests" / "results"
CLOSING = "זו המחשה שעוזרת לכם להכין את המסמכים, לא ייעוץ משפטי. בתיק רציני, או כשיש נקודות ברישיון, דברו עם עורך דין."
WARNING_MARKERS = ["ליתר ביטחון", "229(ח)", "אל תשלמו"]
HEB = "֐-׿"

ev = json.loads((REPO / "evidence.json").read_text(encoding="utf-8"))
def norm(n): return re.sub(r"(?<=\d),(?=\d{3}\b)", "", n)
BACKED = {norm(n) for c in ev["claims"] for n in c["numbers"]} | {norm(s["value"]) for s in ev["structural_numbers"]}


def numbers(text):
    text = re.sub(r"https?://\S+", "", text)
    out = []
    for m in re.finditer(r"(?<![%s\w])\d+(?:[.,:/\-]\d+)*" % HEB, text):
        tok = m.group(0).rstrip(".,:-/")
        after = text[m.end():m.end() + 12]
        out.append((tok, after))
    return out


def unexplained(answer, prompt, allowed):
    given = {norm(t) for t, _ in numbers(prompt)}
    # also allow the parts of hyphenated / dotted user numbers (plates, dates)
    given |= {p for t in list(given) for p in re.split(r"[.\-/:]", t)}
    bad = []
    for tok, after in numbers(answer):
        n = norm(tok)
        if n in BACKED or n in given or n in allowed:
            continue
        if re.fullmatch(r"\d{1,2}\.\d{1,2}(\.\d{4})?", n):       # a date (computed deadline), or a 3.1-style paragraph number
            continue
        if re.fullmatch(r"\d{1,2}:\d{2}", n):                       # a clock time
            continue
        if re.fullmatch(r"\d{1,3}", n) and re.match(r"\s*(יום|ימים|ימי|שעות|שעה|דקות|חודשים)", after):
            continue                                                 # a counted interval
        if n in ("0", "2026", "2027"):                              # zero (a computed "nothing owed") and the current years
            continue
        bad.append(tok)
    return sorted(set(bad), key=lambda x: (len(x), x))


def warning_pos(answer):
    pos = [answer.find(m) for m in WARNING_MARKERS if m in answer]
    return min(pos) if pos else -1


def check(sid):
    scen = next(SCEN.glob(f"{sid}-*.md"))
    spec_text = scen.read_text(encoding="utf-8")
    spec = json.loads(re.search(r"```json\n(.*?)\n```", spec_text, re.S).group(1))
    prompt = re.search(r"```prompt\n(.*?)\n```", spec_text, re.S).group(1)
    ans_path = RES / f"{sid}.md"
    if not ans_path.exists():
        return scen.name, ["no saved answer"], []
    ans = ans_path.read_text(encoding="utf-8")
    meta = json.loads((RES / f"{sid}.meta.json").read_text(encoding="utf-8")) if (RES / f"{sid}.meta.json").exists() else {}
    fails, notes = [], []
    flat = re.sub(r"\s+", " ", ans.replace(">", " ").replace("*", ""))
    if CLOSING not in flat:
        fails.append("closing line missing or changed")
    if spec.get("skill_must_trigger") and not meta.get("skill_triggered"):
        fails.append("skill was not triggered")
    if spec.get("letter_required") and not re.search(r"הנדון|לכבוד", ans):
        fails.append("no Hebrew letter (הנדון / לכבוד)")
    if spec.get("scores_required") and not re.search(r"חזקה|בינונית|חלשה", ans):
        fails.append("no argument scores")
    for s in spec.get("must_include", []):
        if s not in ans:
            fails.append(f"missing: {s}")
    for r in spec.get("must_match", []):
        if not re.search(r, ans):
            fails.append(f"no match: /{r}/")
    for r in spec.get("must_not_match", []):
        m = re.search(r, ans)
        if m:
            fails.append(f"forbidden match: /{r}/ -> '{ans[max(0, m.start()-30):m.end()+30]}'")
    for first, second in spec.get("order", []):
        a, b = re.search(first, ans), re.search(second, ans)
        if not (a and b and a.start() < b.start()):
            fails.append(f"order: '{first}' should come before '{second}'")
    wp = warning_pos(ans)
    for item in spec.get("warning_before", []):
        ip = ans.find(item)
        if wp < 0:
            fails.append("don't-pay warning missing")
            break
        if ip >= 0 and ip < wp:
            fails.append(f"warning comes after '{item}'")
    lim = spec.get("warning_within_chars")
    if lim and not (0 <= wp <= lim):
        fails.append(f"warning not within the first {lim} characters (at {wp})")
    for s, n in spec.get("min_count", {}).items():
        if ans.count(s) < n:
            fails.append(f"'{s}' appears {ans.count(s)} times (need {n})")
    given_text = prompt
    for pattern in spec.get("input_files", []):           # files the user handed over (e.g. the fixture site)
        for f in sorted(REPO.glob(pattern)):
            given_text += "\n" + f.read_text(encoding="utf-8", errors="ignore")
    bad = unexplained(ans, given_text, set(spec.get("allowed_numbers", {})))
    if bad:
        fails.append("numbers without evidence: " + ", ".join(bad))
    notes.append(f"skill_triggered={meta.get('skill_triggered')} tools={len(meta.get('tools', []))} "
                 f"time={meta.get('duration_s')}s")
    return scen.name, fails, notes


def main():
    ids = sys.argv[1:] or sorted(p.name[:2] for p in SCEN.glob("*.md"))
    rows, all_ok = [], True
    for sid in ids:
        name, fails, notes = check(sid)
        ok = not fails
        all_ok &= ok
        rows.append((name, ok, fails, notes))
        print(("PASS " if ok else "FAIL ") + name)
        for f in fails:
            print("   - " + f)
    lines = ["# Scenario results", "", "Generated by `tests/check_results.py` from the answers in `tests/results/`.", "",
             "| Scenario | Result | Details |", "|---|---|---|"]
    for name, ok, fails, notes in rows:
        lines.append(f"| {name} | {'PASS' if ok else 'FAIL'} | {'; '.join(fails + notes).replace('|', '/')} |")
    if set(ids) == {p.name[:2] for p in SCEN.glob('*.md')}:
        (REPO / "tests" / "RESULTS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
