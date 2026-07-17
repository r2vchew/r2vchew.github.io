#!/usr/bin/env python3
"""One-shot Other Deals update: take the new other-deals doc, save it, parse
it, rebuild other.html, and commit + push. Mirrors update_week.py.

Usage:
    python3 scripts/grocery/update_other_week.py <path-to-doc.md>
    cat doc.md | python3 scripts/grocery/update_other_week.py -

Aborts (without writing/committing anything) if the doc doesn't have a
recognizable header or parses out far fewer items than expected.
"""
import subprocess, sys, pathlib

REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'scripts' / 'grocery'))
from parse_other import parse
from repo_worktree import fresh_worktree, build, commit_and_push

MIN_ITEMS = 100

def main():
    if len(sys.argv) != 2:
        sys.exit("usage: update_other_week.py <path-to-doc.md|->")
    text = sys.stdin.read() if sys.argv[1] == '-' else pathlib.Path(sys.argv[1]).read_text(encoding='utf-8-sig')

    meta, items = parse(text)
    if not meta['pulled']:
        sys.exit("could not find '# Other deals - pulled YYYY-MM-DD' header - aborting")
    if len(items) < MIN_ITEMS:
        sys.exit(f"only parsed {len(items)} items (expected {MIN_ITEMS}+) - aborting without writing")

    # Isolated worktree off origin/main - see repo_worktree.py for why this
    # can't run in the shared clone.
    pulled = meta['pulled']
    with fresh_worktree() as work:
        raw_path = work / 'data' / 'others' / 'raw' / f'{pulled}.md'
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        raw_path.write_text(text, encoding='utf-8')
        print(f"wrote {raw_path} ({len(items)} items)")

        subprocess.run([sys.executable, 'scripts/grocery/parse_other.py', str(raw_path)],
                        check=True, cwd=work)
        build(work, 'scripts/grocery/build_other_page.py')

        commit_and_push(work, ['data/others', 'other.html'],
                        f'Update other deals for {pulled}')

if __name__ == '__main__':
    main()
