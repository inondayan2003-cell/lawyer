#!/usr/bin/env python3
"""Runs the test scenarios through `claude -p` with the skill loaded, then checks them.

The skill is loaded the way a user would install it: a temporary project folder
gets `.claude/skills/jewish-legal-assistant` pointing at this repo, and `claude -p` runs
there. Nothing in ~/.claude is touched.

Usage:
  python3 tests/run_scenarios.py                 # run all 8 in parallel, then check
  python3 tests/run_scenarios.py 01 06           # run only some
  python3 tests/run_scenarios.py --check-only    # re-check saved results

Outputs: tests/results/NN.md (the answer), NN.meta.json (skill triggered?, tools,
cost), NN.raw.json (stream, git-ignored), and tests/RESULTS.md (summary).
"""
import argparse
import concurrent.futures as cf
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse

REPO = pathlib.Path(__file__).resolve().parent.parent
SCEN = REPO / "tests" / "scenarios"
RES = REPO / "tests" / "results"
FIXTURE = REPO / "tests" / "fixtures" / "demo-store"
TOOLS = "Skill Read Glob Grep WebFetch Bash(python3:*)"


def prompt_of(path):
    m = re.search(r"```prompt\n(.*?)\n```", path.read_text(encoding="utf-8"), re.S)
    if not m:
        sys.exit(f"no prompt block in {path.name}")
    return m.group(1).replace("{FIXTURE}", str(FIXTURE))


def scrub(text, workdir):
    """Keep local paths and the user name out of saved results."""
    for real, alias in [(str(REPO), "<repo>"), (os.path.realpath(workdir), "<tmp>"), (str(workdir), "<tmp>"),
                        (str(pathlib.Path.home()), "~")]:
        text = text.replace(real, alias)
    text = text.replace(urllib.parse.quote(str(REPO)), "<repo>")
    return re.sub(r"/(private/)?var/folders/[^\s\"']+", "<tmp>", text)


def run_one(path, workdir, model):
    sid = path.name[:2]
    cmd = ["claude", "-p", prompt_of(path), "--output-format", "stream-json", "--verbose",
           "--allowedTools", TOOLS, "--add-dir", str(REPO)]
    if model:
        cmd += ["--model", model]
    t0 = time.time()
    proc = subprocess.run(cmd, cwd=workdir, capture_output=True, text=True, timeout=1800)
    dur = round(time.time() - t0, 1)
    (RES / f"{sid}.raw.json").write_text(proc.stdout, encoding="utf-8")
    final, tools, skill_hit, cost = "", [], False, None
    for line in proc.stdout.splitlines():
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if ev.get("type") == "assistant":
            for c in ev.get("message", {}).get("content", []):
                if c.get("type") == "tool_use":
                    inp = c.get("input", {})
                    tools.append(c.get("name") + (":" + str(inp.get("skill") or inp.get("command", ""))[:60]))
                    blob = json.dumps(inp, ensure_ascii=False)
                    if c.get("name") == "Skill" and "jewish-legal-assistant" in blob:
                        skill_hit = True
                    if c.get("name") == "Read" and blob.find("SKILL.md") >= 0 and (
                            "jewish-legal-assistant" in blob or str(REPO) in blob):
                        skill_hit = True
        if ev.get("type") == "result":
            final = ev.get("result", "") or ""
            cost = ev.get("total_cost_usd")
    (RES / f"{sid}.md").write_text(scrub(final, workdir), encoding="utf-8")
    meta = {"scenario": path.name, "duration_s": dur, "exit_code": proc.returncode,
            "skill_triggered": skill_hit, "tools": tools, "cost_usd": cost,
            "stderr_tail": proc.stderr[-500:]}
    (RES / f"{sid}.meta.json").write_text(scrub(json.dumps(meta, ensure_ascii=False, indent=2), workdir), encoding="utf-8")
    return sid, dur, proc.returncode, skill_hit


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*", help="scenario numbers, e.g. 01 06")
    ap.add_argument("--check-only", action="store_true")
    ap.add_argument("--model", help="model for claude -p (default: the CLI default)")
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    RES.mkdir(exist_ok=True)
    paths = sorted(SCEN.glob("*.md"))
    if a.ids:
        paths = [p for p in paths if p.name[:2] in a.ids]
    if not a.check_only:
        with tempfile.TemporaryDirectory(prefix="jl-run-") as wd:
            skills = pathlib.Path(wd) / ".claude" / "skills"
            skills.mkdir(parents=True)
            os.symlink(REPO, skills / "jewish-legal-assistant")
            with cf.ThreadPoolExecutor(max_workers=a.jobs) as ex:
                for sid, dur, rc, hit in ex.map(lambda p: run_one(p, wd, a.model), paths):
                    print(f"ran {sid}: {dur}s exit={rc} skill_triggered={hit}", flush=True)
    rc = subprocess.run([sys.executable, str(REPO / "tests" / "check_results.py")] + [p.name[:2] for p in paths]).returncode
    sys.exit(rc)


if __name__ == "__main__":
    main()
