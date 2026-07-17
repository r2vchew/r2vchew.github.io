#!/usr/bin/env python3
"""Thursday-morning pointer roll: re-run build_page.py and build_other_page.py
against whatever per-week JSON files already exist on disk (no re-pull, no new
doc) so that data/groceries/latest.json and data/others/latest.json flip over
to the now-live week the moment Thursday arrives.

Why this exists: build_page.py computes "which week is live" using
date.today() AT THE MOMENT IT RUNS, then freezes that answer into latest.json
and preview.json. The public groceries.html/other.html pages re-derive "live"
client-side on every page load (via JS, using the visitor's current date), so
they self-correct with no extra job. But the JSON pointer files the Cartwise
app reads do NOT re-derive anything client-side - they're a static snapshot.
Since the only puller task runs Wednesdays, without this script nothing ever
re-runs build_page.py on Thursday, so latest.json/preview.json stay frozen at
Wednesday's answer (last week showing as "current", the new week stuck behind
a "preview" toggle) for a full week.

Usage: python3 scripts/grocery/roll_live_pointer.py
"""
import sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from repo_worktree import fresh_worktree, build, commit_and_push


def main():
    with fresh_worktree() as work:
        build(work, 'scripts/grocery/build_page.py', 'scripts/grocery/build_other_page.py')
        commit_and_push(work,
                        ['data/groceries', 'data/others', 'groceries.html', 'other.html'],
                        'Roll live/preview pointers for Thursday cutover')


if __name__ == '__main__':
    main()
