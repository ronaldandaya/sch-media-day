# SCH Media Day — 2026

Hosts the photo preview gallery + digital order form for Shark City Hoops Media Day.

🔗 Live: https://YOUR_USERNAME.github.io/sch-media-day/

## What's here

```
sch-media-day/
├── index.html          ← order form (parents land here)
├── manifest.json       ← photo metadata, regenerated each season
├── previews/           ← watermarked JPEGs
│   ├── jv_girls/
│   │   └── jeilani_young_30/
│   │       ├── pose1.jpg
│   │       ├── pose2.jpg
│   │       └── pose3.jpg
│   ├── 8th_boys/
│   │   └── sidak_singh_10/
│   │       ├── pose1.jpg
│   │       └── pose2.jpg
│   └── _groups/
│       ├── jv_girls_team.jpg
│       └── 8th_boys_team.jpg
└── README.md
```

## Workflow each season

1. **Shoot & edit** raws in Lightroom Classic.
2. **Export player picks** — JPEG, sRGB, long edge 1200px, quality 75, strip metadata.
3. **Apply watermark** via Photoshop droplet. Output to a parallel folder tree.
4. **Run the manifest generator** (from the SCH project repo):
   ```bash
   python3 generate-photo-manifest.py /path/to/Exports \
     --base-url https://YOUR_USERNAME.github.io/sch-media-day \
     --roster sch_roster_2026.csv \
     --out manifest.json
   ```
5. **Copy outputs into this repo:**
   ```bash
   cp /path/to/Exports/* previews/      # mirror the structure
   cp /path/to/manifest.json .
   git add -A
   git commit -m "2026 Media Day previews"
   git push origin main
   ```
6. GH Pages auto-deploys within ~1 min.

## Parent-facing flow

1. Parent opens https://YOUR_USERNAME.github.io/sch-media-day/
2. Enters player first name, last name, jersey #
3. Form looks up in `manifest.json`, renders the player's poses + team group photos
4. Parent picks a package (Starter / All-Star) and selects poses (count enforced by package)
5. Add keepsakes, payment method, submit
6. Order POST hits the Apps Script URL configured in `index.html`

## Updating the form (not the photos)

If you only need to update form copy or pricing, edit
`/Users/ronaldandaya/Documents/Claude/Projects/Shark City Hoops/shark-city-photo-order-form.html`
in the workspace, then:

```bash
cd ~/Documents/Dev/sch-media-day
cp "$HOME/Documents/Claude/Projects/Shark City Hoops/shark-city-photo-order-form.html" index.html
git add index.html
git commit -m "form copy update"
git push origin main
```

## Configuration

In `index.html` (`<script>` block at bottom):
- `APPS_SCRIPT_URL` — Google Apps Script web app receiving order submissions
- `MANIFEST_URL` — set to `./manifest.json` for production (same-origin)
