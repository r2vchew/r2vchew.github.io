#!/usr/bin/env python3
"""One-shot weekly update: take the new Drive grocery-deals doc, save it,
parse it, rebuild groceries.html, and commit + push.

Usage:
    python3 scripts/grocery/update_week.py <path-to-doc.md>
    cat doc.md | python3 scripts/grocery/update_week.py -

Aborts (without writing/committing anything) if the doc doesn't have a
recognizable header or parses out far fewer items than expected, so a bad
fetch never gets pushed.
"""
import subprocess, sys, pathlib

REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'scripts' / 'grocery'))
from parse_deals import parse
from repo_worktree import fresh_worktree, build, commit_and_push

MIN_ITEMS = 200

def main():
    if len(sys.argv) != 2:
        sys.exit("usage: update_week.py <path-to-doc.md|->")
    text = sys.stdin.read() if sys.argv[1] == '-' else pathlib.Path(sys.argv[1]).read_text(encoding='utf-8-sig')

    meta, items = parse(text)
    if not meta['week_of']:
        sys.exit("could not find '# Grocery deals - week of YYYY-MM-DD' header - aborting")
    if len(items) < MIN_ITEMS:
        sys.exit(f"only parsed {len(items)} items (expected {MIN_ITEMS}+) - aborting without writing")

    # Always start from the live site (main) so the update lands where the
    # public page is published, no matter what branch this was run on - and in
    # an isolated worktree, so an unrelated uncommitted edit in the shared
    # clone can't block the publish (see repo_worktree.py).
    week_of = meta['week_of']
    with fresh_worktree() as work:
        raw_path = work / 'data' / 'groceries' / 'raw' / f'{week_of}.md'
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        raw_path.write_text(text, encoding='utf-8')
        print(f"wrote {raw_path} ({len(items)} items)")

        subprocess.run([sys.executable, 'scripts/grocery/parse_deals.py', str(raw_path)],
                        check=True, cwd=work)
        build(work, 'scripts/grocery/build_page.py')

        commit_and_push(work, ['data/groceries', 'groceries.html'],
                        f'Update grocery deals for week of {week_of}')

if __name__ == '__main__':
    main()
