#!/usr/bin/env python3
"""Publish helper: do all repo writing inside a throwaway git worktree.

Several scheduled tasks share the single clone at Projects/github-pages, and
they routinely leave it dirty (the email-overview morning build rewrites
email-overview/index.html in place) or parked on their own branch. These
scripts used to run `git checkout -B <branch> origin/main` directly in that
shared tree, which git refuses outright whenever an uncommitted change would
be overwritten - so one unrelated stale edit was enough to kill an entire
run's publish step. That is exactly what silently broke the Thursday pointer
roll for a week (the Cartwise app served an expired flyer week the whole
time), and update_week.py / update_other_week.py had the same landmine.

A worktree has its own checkout and index, so a build here cannot be blocked
by - and cannot disturb - whatever the shared tree is doing.
"""
import subprocess, sys, pathlib, tempfile, shutil, contextlib

REPO = pathlib.Path(__file__).resolve().parents[2]


def git(*args, cwd=REPO, check=True):
    return subprocess.run(['git', *args], cwd=cwd, check=check)


@contextlib.contextmanager
def fresh_worktree():
    """Yield a clean checkout of origin/main; always cleaned up afterwards."""
    git('fetch', 'origin', 'main')
    git('worktree', 'prune')  # clear anything a crashed run left registered
    tmp = pathlib.Path(tempfile.mkdtemp(prefix='gh-pages-'))
    work = tmp / 'wt'
    try:
        git('worktree', 'add', '--detach', str(work), 'origin/main')
        yield work
    finally:
        git('worktree', 'remove', '--force', str(work), check=False)
        shutil.rmtree(tmp, ignore_errors=True)
        git('worktree', 'prune', check=False)


def build(work, *scripts):
    """Run build scripts with the worktree as cwd, so they read and write the
    worktree's copies rather than the shared tree's."""
    for s in scripts:
        subprocess.run([sys.executable, s], check=True, cwd=work)


def commit_and_push(work, paths, message):
    """Commit the given paths and push straight to the live site. Returns
    False (not an error) when the build produced no change."""
    git('add', *paths, cwd=work)
    if git('commit', '-m', message, cwd=work, check=False).returncode != 0:
        print("nothing to commit (data unchanged)")
        return False
    git('push', 'origin', 'HEAD:main', cwd=work)
    print("pushed to main (live site) - it'll be live in a minute or two")
    return True
