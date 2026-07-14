#!/usr/bin/env python3
"""
SCH Media Day — Order Delivery Automation
─────────────────────────────────────────────
Reads orders from the Google Sheet (via Apps Script GET endpoint), resolves
each order's selected photos to their unwatermarked Drive files, copies them
into a per-order delivery folder inside Google Drive Desktop (auto-syncs to
cloud), and prints an email draft with the share link placeholder.

Usage:
    python3 deliver_order.py --list                       # list all orders
    python3 deliver_order.py --order SCH-260710-121234    # process ONE order
    python3 deliver_order.py --all-new                    # process all unresolved
    python3 deliver_order.py --dry-run --all-new          # preview only, no copies

After a delivery:
    1. Open the Deliveries folder in Google Drive
    2. Right-click the order folder → Share → copy link → paste into email draft
    3. Send email
    4. (Optional) Mark order "Delivered" in admin dashboard
"""

import argparse, json, os, re, shutil, sys, urllib.parse, urllib.request
from datetime import datetime
from pathlib import Path

# ─── CONFIG ────────────────────────────────────────────────────────────────
APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzlhjmQGd20iLJ0nLwQig7LMaJn_eGbp8ZGET1xc4oyFPzm3_yHq9N1JVZfn3sCz8kk/exec"
ADMIN_KEY       = "RkL6Bhkus9nbBYFZtYhM"
MANIFEST_URL    = "https://media-day-2026.sharkcityhoops.com/manifest.json"
DRIVE_ROOT      = Path.home() / "Library/CloudStorage/GoogleDrive-coachron@sharkcityhoops.com/Shared drives/SCH Media Day"
DELIVERY_ROOT   = DRIVE_ROOT / "Deliveries"   # auto-syncs to cloud via Drive Desktop
COACH_EMAIL     = "coachron@sharkcityhoops.com"
REPLY_TO        = "info@sharkcityhoops.com"

# Form team-name → Drive team folder
TEAM_TO_FOLDER = {
    "Boys 4th Grade Under": "Boys_4th-6th",
    "Boys 5th/6th Grade":   "Boys_4th-6th",
    "Boys 7th Grade":       "7th_Boys",
    "Boys 8th Grade":       "8th_Boys",
    "JV Boys":              "JV_Boys",
    "Girls 5th Grade":      "5th_Girls",
    "JV Girls":             "JV_Girls",
}

# ─── HELPERS ───────────────────────────────────────────────────────────────
def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

def load_orders() -> list:
    url = f"{APPS_SCRIPT_URL}?key={urllib.parse.quote(ADMIN_KEY)}"
    data = fetch_json(url)
    if not data.get("ok"):
        raise RuntimeError(f"Failed to fetch orders: {data.get('error')}")
    return data.get("orders", [])

def load_manifest() -> dict:
    return fetch_json(MANIFEST_URL)

def player_slug_lookup(manifest: dict, player_name: str) -> str | None:
    """Return the player slug for a display name (case-insensitive)."""
    name = player_name.strip().lower()
    for slug, p in manifest.get("players", {}).items():
        if p.get("displayName", "").lower() == name:
            return slug
    return None

def resolve_files(order: dict, manifest: dict) -> tuple[list[Path], list[str]]:
    """Return (existing_files, warnings) for an order.

    Looks up unwatermarked .png files from Drive/{team}/Player/{Player} - Pose N.png
    for player poses. Group photos come from Drive/{team}/Team/. Buddy photos from
    Drive/Partner_Fun_Photos/.
    """
    files = []
    warnings = []

    player_name = order.get("Player Name", "").strip()
    team        = order.get("Team", "").strip()
    team_folder = TEAM_TO_FOLDER.get(team)
    if not team_folder:
        warnings.append(f"Unknown team: {team!r}")
        return files, warnings

    slug = player_slug_lookup(manifest, player_name)
    if not slug:
        warnings.append(f"Player not in manifest: {player_name!r}")

    # ── Player poses ──
    pose_ids = [p.strip() for p in str(order.get("Player Poses Selected", "")).split(",") if p.strip()]
    for pose_id in pose_ids:
        # Match "pose3" → "Player Name - Pose 3.png"
        m = re.match(r"pose(\d+)$", pose_id)
        if not m:
            warnings.append(f"Unrecognized pose id: {pose_id!r}")
            continue
        n = m.group(1)
        candidate = DRIVE_ROOT / team_folder / "Player" / f"{player_name} - Pose {n}.png"
        if candidate.exists():
            files.append(candidate)
        else:
            # Fallback: try jpg (watermarked, worst case)
            fallback = DRIVE_ROOT / team_folder / "Player" / "Watermark" / f"{player_name} - Pose {n}.jpg"
            if fallback.exists():
                warnings.append(f"⚠ No unwatermarked PNG for {player_name} pose {n}; using watermarked JPG as fallback")
                files.append(fallback)
            else:
                warnings.append(f"❌ MISSING: {candidate.name}")

    # ── Group / team photos ──
    group_ids = [g.strip() for g in str(order.get("Group Photos Selected", "")).split(",") if g.strip()]
    if group_ids and slug:
        # Find the team entry in the manifest that contains these group IDs
        for team_entry in manifest["players"][slug].get("teams", []):
            for gp in team_entry.get("groupPhotos", []):
                if gp["id"] in group_ids:
                    # gp['full'] is a URL like "./previews/_groups/4th_boys/team_pose_1.jpg"
                    # Extract the filename, then look in Drive Team folder (unwatermarked)
                    fname = Path(gp["full"]).name
                    # Try Drive Team/ folder — files might be named differently
                    # For now, we know only the repo filename (team_pose_1.jpg); the Drive
                    # equivalent is one of the un-normalized team photos in Team/
                    # We'll list ALL team photos as candidates
                    team_dir = DRIVE_ROOT / team_folder / "Team"
                    team_photos = sorted([f for f in team_dir.iterdir()
                                          if f.is_file() and f.suffix.lower() in (".jpg", ".jpeg", ".png")])
                    if team_photos:
                        # Best-effort: map team_pose_1 → first team photo, _2 → second, etc.
                        m = re.search(r"team_pose_(\d+)", gp["id"])
                        if m:
                            idx = int(m.group(1)) - 1
                            if idx < len(team_photos):
                                files.append(team_photos[idx])
                            else:
                                warnings.append(f"⚠ Group photo index out of range: {gp['id']}")
                        else:
                            warnings.append(f"⚠ Couldn't parse team pose from {gp['id']}")
                    else:
                        warnings.append(f"⚠ No team photos in {team_dir}")

    # ── Buddy photos ──
    buddy_ids = [b.strip() for b in str(order.get("Buddy Photos Selected", "")).split(",") if b.strip()]
    buddy_dir = DRIVE_ROOT / "Partner_Fun_Photos"
    if buddy_ids:
        # For each buddy_id, look up the source filename from manifest
        if slug:
            player_buddies = manifest["players"][slug].get("buddyPhotos", [])
            for bid in buddy_ids:
                bp = next((b for b in player_buddies if b["id"] == bid), None)
                if not bp:
                    warnings.append(f"⚠ Buddy photo not in manifest: {bid}")
                    continue
                # bp['full'] path — extract filename, look in Partner_Fun_Photos root (unwatermarked)
                fname = Path(bp["full"]).name
                candidate = buddy_dir / fname
                # Buddy filenames in repo are like "sidak_sethi__anik_prakash__1.jpg"
                # But Drive Partner_Fun_Photos names them like "Sidak Sethi + Anik Prakash - 1.jpg"
                # Fallback: search buddy_dir for a file containing all the buddy names
                if candidate.exists():
                    files.append(candidate)
                else:
                    # Try to find by buddy name matching
                    buddy_names = bp.get("buddies", [])
                    for f in buddy_dir.glob("*"):
                        if f.is_file() and all(n.split()[0] in f.stem for n in buddy_names):
                            files.append(f)
                            break
                    else:
                        warnings.append(f"⚠ Buddy photo file not found for {bid} ({', '.join(buddy_names)})")
    elif int(order.get("Buddy Photos Qty", 0) or 0) > 0:
        warnings.append(
            f"⚠ Order has {order['Buddy Photos Qty']} buddy photo(s) but no IDs stored. "
            f"Manually pick from Partner_Fun_Photos. Buddy Names: {order.get('Buddy Names', '')}"
        )

    return files, warnings

def prepare_delivery(order: dict, manifest: dict, dry_run: bool = False) -> None:
    """Copy files to delivery folder and print summary + email draft."""
    order_id     = order.get("Order ID", "UNKNOWN")
    player_name  = order.get("Player Name", "Unknown")
    parent_email = order.get("Parent Email", "").strip()
    package      = order.get("Package", "")
    total        = order.get("Order Total", "0")

    files, warnings = resolve_files(order, manifest)

    # Delivery folder: /Deliveries/{OrderID}_{Player Name}/
    safe_player = re.sub(r"[^\w\s-]", "", player_name).strip().replace(" ", "_")
    delivery_folder = DELIVERY_ROOT / f"{order_id}_{safe_player}"

    print("\n" + "═"*70)
    print(f"ORDER: {order_id}")
    print(f"  Player:  {player_name}  ({order.get('Team', '')})")
    print(f"  Parent:  {order.get('Parent Name', '')}  <{parent_email}>")
    print(f"  Package: {package}   Total: ${total}")
    print(f"  Delivery folder: {delivery_folder}")
    print("─"*70)

    if warnings:
        print("Warnings:")
        for w in warnings:
            print(f"  {w}")
        print()

    if not files:
        print("❌ No files resolved — skipping delivery.")
        return

    print(f"Files to deliver ({len(files)}):")
    total_size = 0
    for f in files:
        size_mb = f.stat().st_size / (1024*1024)
        total_size += size_mb
        print(f"  {f.name:60s}  ({size_mb:.1f} MB)")
    print(f"  Total: {total_size:.1f} MB")

    if dry_run:
        print("\n[DRY RUN — no files copied]")
    else:
        delivery_folder.mkdir(parents=True, exist_ok=True)
        for f in files:
            dst = delivery_folder / f.name
            if dst.exists() and dst.stat().st_size == f.stat().st_size:
                continue  # already there
            shutil.copy2(f, dst)
        print(f"\n✅ Copied {len(files)} file(s) to Drive Deliveries folder")
        print(f"   → Wait ~30s for Drive Desktop to sync, then right-click the folder in Drive to share.")

    # Email draft
    print("\n" + "─"*70)
    print("📧 EMAIL DRAFT (paste share link + send):")
    print("─"*70)
    print(f"To:      {parent_email}")
    print(f"Reply-to: {REPLY_TO}")
    print(f"Subject: Your Shark City Hoops Media Day Photos — {player_name}")
    print()
    print(f"Hi {order.get('Parent Name', 'there').split()[0]},")
    print()
    print(f"Your {package} package photos for {player_name} are ready.")
    print()
    print(f"📁 Download link:  [PASTE GOOGLE DRIVE SHARE URL HERE]")
    print(f"   {len(files)} file(s) — {total_size:.1f} MB")
    print()
    if order.get("Notes"):
        print(f"Note from order: {order['Notes']}")
        print()
    print("Photos are yours to print, share, and enjoy. If anything's missing")
    print("or the link doesn't work, reply and we'll get it sorted right away.")
    print()
    print("Thanks for supporting Shark City Hoops! 🦈")
    print()
    print("— Coach Ron & the SCH Staff")
    print(f"  {REPLY_TO}")
    print("═"*70 + "\n")

# ─── CLI ───────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="SCH Media Day order delivery")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--list",       action="store_true", help="List all orders")
    g.add_argument("--order",      metavar="ID",        help="Deliver a single order by ID")
    g.add_argument("--all-new",    action="store_true", help="Deliver all orders not yet marked Delivered")
    g.add_argument("--all-paid",   action="store_true", help="Deliver all orders with Status=Paid")
    ap.add_argument("--dry-run",   action="store_true", help="Show what would happen, don't copy files")
    args = ap.parse_args()

    print("Loading orders + manifest…")
    orders = load_orders()
    manifest = load_manifest()
    print(f"  {len(orders)} orders, {len(manifest.get('players', {}))} players in manifest\n")

    if args.list:
        print(f"{'Order ID':22s} {'Status':10s} {'Player':25s} {'Total':>8s}  Parent")
        print("─"*100)
        for o in orders:
            print(f"{o.get('Order ID',''):22s} "
                  f"{o.get('Status',''):10s} "
                  f"{o.get('Player Name',''):25s} "
                  f"${o.get('Order Total','0'):>7} "
                  f"{o.get('Parent Name','')} <{o.get('Parent Email','')}>")
        return

    if args.order:
        matches = [o for o in orders if o.get("Order ID") == args.order]
        if not matches:
            print(f"❌ Order {args.order} not found")
            sys.exit(1)
        prepare_delivery(matches[0], manifest, dry_run=args.dry_run)
        return

    if args.all_new:
        targets = [o for o in orders if o.get("Status") not in ("Delivered", "")]
    else:  # all_paid
        targets = [o for o in orders if o.get("Status") == "Paid"]

    print(f"Processing {len(targets)} order(s)…")
    for o in targets:
        prepare_delivery(o, manifest, dry_run=args.dry_run)

if __name__ == "__main__":
    main()
