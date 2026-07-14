#!/usr/bin/env python3
"""
SCH Media Day — Photo Manifest Generator (v2)

Builds the manifest.json that the order form consumes. Supports players who
play on multiple teams via per-player sidecar files.

Expected folder layout under PREVIEWS_ROOT:

    previews/
        _groups/                  ← team group photos, organized by team slug
            5th_girls/
                team_pose.jpg
                team_action.jpg
            jv_girls/
                team_pose.jpg
            8th_boys/
                team_pose.jpg
        players/                  ← one folder per player (flat — no team subdivision)
            jeilani_young/
                pose1.jpg
                pose2.jpg
                pose3.jpg
                pose4.jpg
                player.json       ← REQUIRED sidecar (see below)
            sidak_singh/
                pose1.jpg
                pose2.jpg
                pose3.jpg
                player.json

Sidecar (player.json):
{
    "displayName": "Jeilani Young",
    "teams": [
        { "name": "Girls 5th Grade",       "jersey": "30" },
        { "name": "Girls JV (9th-10th)",   "jersey": "30" }
    ]
}

Generated manifest:
{
    "season": "2026",
    "lookups": {
        "jeilani_young_30": "jeilani_young",
        "sidak_singh_10":   "sidak_singh"
    },
    "players": {
        "jeilani_young": {
            "displayName": "Jeilani Young",
            "teams": [
                {
                    "name": "Girls 5th Grade",
                    "jersey": "30",
                    "groupPhotos": [ { "id": "...", "label": "...", "thumb": "...", "full": "..." } ]
                },
                { ... }
            ],
            "poses": [ { "id": "pose1", "label": "Hero", "thumb": "...", "full": "..." }, ... ]
        }
    }
}

Usage:
    python3 generate-photo-manifest.py PREVIEWS_ROOT [--base-url URL] [--out manifest.json]

Example:
    python3 generate-photo-manifest.py ~/Documents/Dev/sch-media-day/previews \\
        --base-url . --out ~/Documents/Dev/sch-media-day/manifest.json
"""

import argparse
import datetime
import json
import re
import sys
from pathlib import Path

VALID_EXTS = {'.jpg', '.jpeg', '.png', '.webp'}


def slugify(s: str) -> str:
    return re.sub(r'_+|^_|_$', '_',
                  re.sub(r'[^a-z0-9]+', '_', s.lower().strip())).strip('_')


def humanize(slug: str) -> str:
    # Add a space between letters and digits, e.g. "pose1" → "pose 1"
    s = re.sub(r'([a-zA-Z])(\d)', r'\1 \2', slug)
    s = re.sub(r'(\d)([a-zA-Z])', r'\1 \2', s)
    return ' '.join(p.capitalize() for p in s.split('_'))


def _grade_suffix(n: str) -> str:
    if n.endswith('1') and not n.endswith('11'): return 'st'
    if n.endswith('2') and not n.endswith('12'): return 'nd'
    if n.endswith('3') and not n.endswith('13'): return 'rd'
    return 'th'

def team_slug(name: str) -> str:
    """Slug used as a subfolder under _groups/ — e.g. 'Girls 5th Grade' → '5th_girls', 'Boys 7th Grade' → '7th_boys'."""
    n = name.lower()
    # Boys|Girls then number
    m = re.search(r'(boys|girls)\s+(\d+)(?:st|nd|rd|th)?', n)
    if m:
        return f"{m.group(2)}{_grade_suffix(m.group(2))}_{m.group(1)}"
    # Number then Boys|Girls
    m = re.search(r'(\d+)(?:st|nd|rd|th)?\s+(boys|girls)', n)
    if m:
        return f"{m.group(1)}{_grade_suffix(m.group(1))}_{m.group(2)}"
    if 'jv' in n and 'girl' in n: return 'jv_girls'
    if 'jv' in n and 'boy'  in n: return 'jv_boys'
    return slugify(name)


def collect_group_photos(groups_root: Path, team_slug_str: str, base_url: str):
    """Return list of group photo entries for a given team slug folder. Pairs *_thumb.jpg with its full counterpart."""
    team_dir = groups_root / team_slug_str
    if not team_dir.is_dir():
        return []
    all_imgs = [f for f in sorted(team_dir.iterdir())
                if f.is_file() and f.suffix.lower() in VALID_EXTS]
    full_imgs = [f for f in all_imgs if not f.stem.endswith('_thumb')]
    thumb_imgs = {f.stem.replace('_thumb',''): f for f in all_imgs if f.stem.endswith('_thumb')}
    photos = []
    for f in full_imgs:
        stem = f.stem
        thumb_path = thumb_imgs.get(stem, f)
        photos.append({
            'id':    f'g_{team_slug_str}_{stem}',
            'label': humanize(stem),
            'thumb': f'{base_url.rstrip("/")}/{thumb_path.relative_to(groups_root.parent.parent).as_posix()}',
            'full':  f'{base_url.rstrip("/")}/{f.relative_to(groups_root.parent.parent).as_posix()}',
        })
    return photos


def collect_buddy_photos(buddies_root: Path, base_url: str, players_by_slug: dict):
    """Return {player_slug: [buddy_photo_entries]} keyed by player.
    If _buddies_meta.json exists, use it for full display names; else derive from filename."""
    result = {}
    if not buddies_root.is_dir():
        return result

    # Load display metadata (all names, incl. coaches/non-players) if present
    meta_path = buddies_root / '_buddies_meta.json'
    display_meta = {}
    if meta_path.exists():
        try:
            records = json.loads(meta_path.read_text(encoding='utf-8'))
            for r in records:
                display_meta[r['stem']] = r
        except Exception:
            pass

    all_imgs = [f for f in sorted(buddies_root.iterdir())
                if f.is_file() and f.suffix.lower() in VALID_EXTS]
    full_imgs = [f for f in all_imgs if not f.stem.endswith('_thumb')]
    thumb_imgs = {f.stem.replace('_thumb',''): f for f in all_imgs if f.stem.endswith('_thumb')}

    for f in full_imgs:
        parts = f.stem.split('__')
        if len(parts) < 3:
            continue
        pose = parts[-1]
        player_slugs = parts[:-1]
        thumb_path = thumb_imgs.get(f.stem, f)

        # Get full display names (incl. coaches/non-players) if meta exists
        meta = display_meta.get(f.stem)
        all_display_names = meta['displayNames'] if meta else [players_by_slug.get(s, s) for s in player_slugs]

        for slug in player_slugs:
            if slug not in players_by_slug:
                continue
            self_name = players_by_slug[slug]
            # Buddies = all names EXCEPT the current player (case-insensitive, whitespace-normalized)
            self_norm = self_name.lower().strip()
            others = [n for n in all_display_names if n.lower().strip() != self_norm]
            if not others:
                continue
            entry = {
                'id':      f'buddy_{f.stem}',
                'label':   'with ' + ', '.join(others),
                'thumb':   f'{base_url.rstrip("/")}/{thumb_path.relative_to(buddies_root.parent.parent).as_posix()}',
                'full':    f'{base_url.rstrip("/")}/{f.relative_to(buddies_root.parent.parent).as_posix()}',
                'buddies': others,
            }
            result.setdefault(slug, []).append(entry)
    return result


def build_manifest(previews_root: Path, base_url: str):
    previews_root = previews_root.resolve()
    players_dir = previews_root / 'players'
    groups_dir  = previews_root / '_groups'
    buddies_dir = previews_root / '_buddies'

    if not players_dir.is_dir():
        raise SystemExit(f"ERROR: {players_dir} not found")

    # Preload player displayNames for buddy photo label lookup
    players_by_slug = {}
    for player_dir in sorted(players_dir.iterdir()):
        if not player_dir.is_dir(): continue
        sidecar = player_dir / 'player.json'
        if sidecar.exists():
            try:
                meta = json.loads(sidecar.read_text(encoding='utf-8'))
                players_by_slug[player_dir.name] = meta.get('displayName') or humanize(player_dir.name)
            except Exception:
                pass

    buddy_photos_by_player = collect_buddy_photos(buddies_dir, base_url, players_by_slug)

    players = {}
    lookups = {}

    for player_dir in sorted(players_dir.iterdir()):
        if not player_dir.is_dir():
            continue
        sidecar = player_dir / 'player.json'
        if not sidecar.exists():
            print(f"  ⚠ {player_dir.name}: missing player.json — skipping")
            continue

        try:
            meta = json.loads(sidecar.read_text(encoding='utf-8'))
        except Exception as e:
            print(f"  ⚠ {player_dir.name}: bad player.json ({e})")
            continue

        player_id = player_dir.name
        display   = meta.get('displayName') or humanize(player_id)
        teams_raw = meta.get('teams', [])
        if not teams_raw:
            print(f"  ⚠ {player_dir.name}: no teams in sidecar — skipping")
            continue

        # Pose files. Pair *_thumb.jpg with its full counterpart.
        # If poses.json sidecar exists, use it to attach the original Drive
        # filename to each pose entry (so admin knows which raw file to send).
        poses_map_path = player_dir / 'poses.json'
        poses_map = {}
        if poses_map_path.exists():
            try:
                poses_map = json.loads(poses_map_path.read_text(encoding='utf-8'))
            except Exception as e:
                print(f"  ⚠ {player_dir.name}: bad poses.json ({e})")

        poses = []
        all_imgs = [f for f in sorted(player_dir.iterdir())
                    if f.is_file() and f.suffix.lower() in VALID_EXTS]
        full_imgs = [f for f in all_imgs if not f.stem.endswith('_thumb')]
        thumb_imgs = {f.stem.replace('_thumb',''): f for f in all_imgs if f.stem.endswith('_thumb')}
        for f in full_imgs:
            pose_id = f.stem
            thumb_path = thumb_imgs.get(pose_id, f)
            poses.append({
                'id':     pose_id,
                'label':  humanize(pose_id),
                'thumb':  f'{base_url.rstrip("/")}/{thumb_path.relative_to(previews_root.parent).as_posix()}',
                'full':   f'{base_url.rstrip("/")}/{f.relative_to(previews_root.parent).as_posix()}',
                'source': poses_map.get(pose_id),  # original Drive filename, or None
            })
        if not poses:
            print(f"  ⚠ {player_dir.name}: no pose files — skipping")
            continue

        # Teams + each team's group photos. Sidecar keys: prefer "team", accept "name".
        # Empty jersey is allowed (e.g. practice players with no number assigned).
        teams_out = []
        for t in teams_raw:
            tname  = t.get('team') or t.get('name')
            jersey = str(t.get('jersey', '')).strip()
            if not tname:
                print(f"  ⚠ {player_dir.name}: team entry missing team name")
                continue
            tslug = team_slug(tname)
            group_photos = collect_group_photos(groups_dir, tslug, base_url)
            teams_out.append({
                'name':        tname,
                'jersey':      jersey,
                'groupPhotos': group_photos,
            })
            # Lookup key per team (lets parent enter either jersey)
            key = f'{slugify(display.split()[0])}_{slugify(" ".join(display.split()[1:]))}_{slugify(jersey)}'
            lookups[key] = player_id

        if not teams_out:
            print(f"  ⚠ {player_dir.name}: no valid teams")
            continue

        players[player_id] = {
            'displayName': display,
            'teams':       teams_out,
            'poses':       poses,
            'buddyPhotos': buddy_photos_by_player.get(player_id, []),
        }
        team_summary = ', '.join(f"{t['name']} #{t['jersey']}" for t in teams_out)
        print(f"  ✓ {display:25s}  {len(poses)} poses · {team_summary}")

    return {
        'season':      str(datetime.datetime.now().year),
        'generatedAt': datetime.datetime.now().isoformat(),
        'lookups':     lookups,
        'players':     players,
    }


def main():
    p = argparse.ArgumentParser(description='Generate SCH photo manifest.')
    p.add_argument('previews_root', type=Path,
                   help='Path to the previews/ folder containing players/ and _groups/.')
    p.add_argument('--base-url', default='.',
                   help='Base URL prefix for photo paths in the manifest. '
                        'Use "." for same-origin (production GH Pages) or full URL for cross-origin.')
    p.add_argument('--out', type=Path, default=Path('manifest.json'),
                   help='Output JSON path (default: manifest.json in cwd).')
    args = p.parse_args()

    if not args.previews_root.is_dir():
        print(f"ERROR: previews root not found: {args.previews_root}")
        sys.exit(1)

    print(f"Scanning {args.previews_root} …\n")
    manifest = build_manifest(args.previews_root, args.base_url)
    args.out.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f"\n✅ Wrote {args.out}")
    print(f"   {len(manifest['players'])} players, {len(manifest['lookups'])} lookup keys")


if __name__ == '__main__':
    main()
