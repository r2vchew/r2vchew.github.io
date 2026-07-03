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

    subprocess.run(['git', 'fetch', 'origin', 'main'], check=True, cwd=REPO)
    subprocess.run(['git', 'checkout', '-B', 'other-deals-weekly', 'origin/main'],
                    check=True, cwd=REPO)

    pulled = meta['pulled']
    raw_path = REPO / 'data' / 'others' / 'raw' / f'{pulled}.md'
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    raw_path.write_text(text, encoding='utf-8')
    print(f"wrote {raw_path} ({len(items)} items)")

    subprocess.run([sys.executable, 'scripts/grocery/parse_other.py', str(raw_path)],
                    check=True, cwd=REPO)
    subprocess.run([sys.executable, 'scripts/grocery/build_other_page.py'], check=True, cwd=REPO)

    subprocess.run(['git', 'add', 'data/others', 'other.html'], check=True, cwd=REPO)
    commit = subprocess.run(['git', 'commit', '-m', f'Update other deals for {pulled}'],
                             cwd=REPO)
    if commit.returncode != 0:
        print("nothing to commit (data unchanged)")
        return

    subprocess.run(['git', 'push', 'origin', 'HEAD:main'], check=True, cwd=REPO)
    print("pushed to main (live site) - it'll be live in a minute or two")

if __name__ == '__main__':
    main()
