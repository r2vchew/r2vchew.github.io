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

Runs entirely inside a THROWAWAY GIT WORKTREE off origin/main, never touching
the main working tree or whatever branch it happens to be sitting on. This is
load-bearing, not tidiness: several scheduled tasks share this one clone and
routinely leave it dirty (the email-overview morning build rewrites
email-overview/index.html in place) or parked on their own branch. The old
version did `git checkout -B pointer-roll origin/main` in the shared tree,
which git refuses whenever an uncommitted file would be overwritten - so a
single stale edit sitting in the tree silently killed the roll every Thursday
and the app served an expired week all week long. A worktree has its own
index and checkout, so nothing another task does can block it.

Usage: python3 scripts/grocery/roll_live_pointer.py
"""
import subprocess, sys, pathlib, tempfile, shutil

REPO = pathlib.Path(__file__).resolve().parents[2]


def git(*args, cwd=REPO, check=True):
    return subprocess.run(['git', *args], cwd=cwd, check=check)


def main():
    git('fetch', 'origin', 'main')

    # Clear any worktree a previously-crashed run left registered.
    git('worktree', 'prune')

    tmp = pathlib.Path(tempfile.mkdtemp(prefix='pointer-roll-'))
    work = tmp / 'wt'
    try:
        git('worktree', 'add', '--detach', str(work), 'origin/main')

        subprocess.run([sys.executable, 'scripts/grocery/build_page.py'],
                       check=True, cwd=work)
        subprocess.run([sys.executable, 'scripts/grocery/build_other_page.py'],
                       check=True, cwd=work)

        git('add', 'data/groceries', 'data/others', 'groceries.html', 'other.html',
            cwd=work)
        commit = git('commit', '-m', 'Roll live/preview pointers for Thursday cutover',
                     cwd=work, check=False)
        if commit.returncode != 0:
            print("nothing to commit (pointers already correct)")
            return

        git('push', 'origin', 'HEAD:main', cwd=work)
        print("pushed to main (live site) - pointer roll complete")
    finally:
        git('worktree', 'remove', '--force', str(work), check=False)
        shutil.rmtree(tmp, ignore_errors=True)
        git('worktree', 'prune', check=False)


if __name__ == '__main__':
    main()
