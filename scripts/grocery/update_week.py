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

MIN_ITEMS = 200

def main():
    if len(sys.argv) != 2:
        sys.exit("usage: update_week.py <path-to-doc.md|->")
    text = sys.stdin.read() if sys.argv[1] == '-' else pathlib.Path(sys.argv[1]).read_text()

    meta, items = parse(text)
    if not meta['week_of']:
        sys.exit("could not find '# Grocery deals - week of YYYY-MM-DD' header - aborting")
    if len(items) < MIN_ITEMS:
        sys.exit(f"only parsed {len(items)} items (expected {MIN_ITEMS}+) - aborting without writing")

    week_of = meta['week_of']
    raw_path = REPO / 'data' / 'groceries' / 'raw' / f'{week_of}.md'
    raw_path.write_text(text)
    print(f"wrote {raw_path} ({len(items)} items)")

    subprocess.run([sys.executable, 'scripts/grocery/parse_deals.py', str(raw_path)],
                    check=True, cwd=REPO)
    subprocess.run([sys.executable, 'scripts/grocery/build_page.py'], check=True, cwd=REPO)

    subprocess.run(['git', 'add', 'data/groceries', 'groceries.html'], check=True, cwd=REPO)
    commit = subprocess.run(['git', 'commit', '-m', f'Update grocery deals for week of {week_of}'],
                             cwd=REPO)
    if commit.returncode != 0:
        print("nothing to commit (data unchanged)")
        return

    branch = subprocess.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
                             check=True, cwd=REPO, capture_output=True, text=True).stdout.strip()
    subprocess.run(['git', 'push', '-u', 'origin', branch], check=True, cwd=REPO)
    print(f"pushed to {branch}")

if __name__ == '__main__':
    main()
