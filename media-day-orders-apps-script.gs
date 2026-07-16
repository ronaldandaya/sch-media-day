/**
 * SCH Media Day — Orders backend
 * -------------------------------------------
 * Handles POST from the order form (writes to Sheet, emails parent + coach)
 * Handles GET for the admin dashboard (returns orders as JSON, key-protected).
 *
 * SETUP:
 *   1. Open script.google.com under coachron@sharkcityhoops.com
 *   2. New project → paste this file → save
 *   3. Create a new Google Sheet named "SCH Media Day Orders"
 *      Add tab "Orders" (this script creates headers on first submit)
 *   4. Update SHEET_ID below to that sheet's ID (from its URL)
 *   5. Update ADMIN_KEY to a random string (used by admin.html)
 *   6. Deploy → New deployment → Type: Web app
 *      - Execute as: Me (coachron@sharkcityhoops.com)
 *      - Who has access: Anyone
 *      - Copy the /exec URL — paste into index.html APPS_SCRIPT_URL
 *   7. On first deploy, Google will ask you to authorize; approve Gmail + Sheets scopes.
 */

// ──────────────────── CONFIG ────────────────────
const SHEET_ID       = 'PASTE_SHEET_ID_HERE';
const SHEET_TAB      = 'Orders';
const MAKER_SHEET_TAB= 'Maker Orders';                     // ← NEW
const NOTIFY_EMAIL   = 'coachron@sharkcityhoops.com';
const REPLY_TO       = 'info@sharkcityhoops.com';
const MAKER_EMAIL    = 'krisharae.young@gmail.com';        // ← NEW  (Krisha Rae Young — keepsake maker)
const ADMIN_KEY      = 'CHANGE_ME_TO_A_LONG_RANDOM_STRING';
const ZELLE_ADDRESS  = 'sharkcityhoops@gmail.com';
const DELIVERY_ETA   = 'within 1 week of payment confirmation';
// ────────────────────────────────────────────────

// Physical keepsake items: [ Orders-tab-column-name, form-field-key, unit-price, label-for-maker ]
const KEEPSAKE_META = [
  ['Slam Shirt',         'slam_shirt',     30, 'Player Slam Shirt'],
  ['Round Keychain',     'round_keychain', 12, 'Round Keychain (double-sided, set of 2)'],
  ['Rectangle Keychain', 'rect_keychain',  12, 'Rectangle Keychain (double-sided, set of 2)'],
  ['Mug',                'mug_11oz',       12, '11 oz White Mug'],
  ['Tumbler',            'tumbler_20oz',   18, '20 oz Sublimation Tumbler'],
  ['Mouse Pad',          'mouse_pad',      18, 'Mouse Pad'],
  ['Magnet',             'magnet',          8, 'Magnet'],
  ['Can Sleeve',         'can_sleeve',     16, 'Neoprene Can Sleeve'],
  ['Metal Sign',         'metal_sign',     30, 'Metal Sign'],
  ['Shot Glass',         'shot_glass',     12, 'Frosted Shot Glass'],
  ['Ornament',           'ornament',        8, 'Christmas Ornament'],
  ['Car Coasters',       'car_coasters',   12, 'Car Coasters (set of 2)'],
];

const MAKER_HEADERS = [
  'Timestamp','Order ID','Player Name','Team','Parent Name','Parent Email',
  'Item','Qty','Unit Price','Line Total',
  'Photo Filename','Photo Notes',
  'Status','Sent to Maker','Ready Date','Delivered Date','Maker Notes'
];

const HEADERS = [
  'Timestamp','Order ID','Status',
  'Parent Name','Parent Email','Parent Phone',
  'Player Name','Team','Jersey #',
  'Package','Package Price',
  'Player Poses Selected','Group Photos Selected',
  'Buddy Photos Qty','Buddy Names','Buddy Subtotal',
  'Slam Shirt',
  'Round Keychain','Rectangle Keychain','Mug','Tumbler','Mouse Pad',
  'Magnet','Can Sleeve','Metal Sign','Shot Glass','Ornament','Car Coasters',
  'Keepsake Subtotal','Discount %','Discount Amount','Order Total',
  'Payment Method','Notes',
  'Buddy Photos Selected','Delivery Folder','Delivered At'  // ← new columns appended (safe: no shift)
];

// ──────────────────── ENTRY POINTS ────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // ROUTING: delivery action from deliver_order.py
    if (data.action === 'deliver') {
      if (data.key !== ADMIN_KEY) return json({ ok: false, error: 'unauthorized' });
      return handleDeliver(data);
    }

    // Default: new customer order from the form
    const orderId = 'SCH-' + Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyMMdd-HHmmss');
    const row = buildRow(data, orderId);
    appendRow(row);
    appendMakerRows(data, orderId);        // ← NEW: extract per-item rows
    sendParentReceipt(data, orderId);
    sendCoachNotification(data, orderId);
    return json({ ok: true, orderId });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  // Admin dashboard fetch. Requires ?key=ADMIN_KEY
  if ((e.parameter.key || '') !== ADMIN_KEY) {
    return json({ ok: false, error: 'unauthorized' });
  }
  const sheet = getSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length === 0) return json({ ok: true, orders: [] });
  const headers = values[0];
  const orders = values.slice(1).map(row =>
    Object.fromEntries(headers.map((h, i) => [h, row[i]]))
  );
  return json({ ok: true, orders });
}

// ──────────────────── HELPERS ────────────────────
function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_TAB);
  if (!sheet) sheet = ss.insertSheet(SHEET_TAB);
  // Ensure headers
  const firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (firstRow[0] !== HEADERS[0]) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function appendRow(row) {
  const sheet = getSheet();
  sheet.appendRow(row);
}

function buildRow(d, orderId) {
  const n = k => Number(d[k] || 0);
  const s = k => String(d[k] || '');
  return [
    d.timestamp || new Date(),
    orderId,
    'New',
    s('parentName'), s('email'), s('phone'),
    s('playerName'), s('team'), s('jerseyNumber'),
    s('package'), n('packagePrice'),
    s('selectedPlayerPoses'), s('selectedGroupPhotos'),
    n('buddy_photo'), s('buddyNames'), n('buddySubtotal'),
    n('slam_shirt'),
    n('round_keychain'), n('rect_keychain'), n('mug_11oz'),
    n('tumbler_20oz'), n('mouse_pad'), n('magnet'),
    n('can_sleeve'), n('metal_sign'), n('shot_glass'),
    n('ornament'), n('car_coasters'),
    n('keepsakeSubtotal'), Number((n('discountPct')*100).toFixed(0)) + '%',
    n('discountAmt'), n('orderTotal'),
    s('payment'), s('notes'),
    // ─── new columns appended safely at the end ───
    s('selectedBuddyPhotos'),  // Buddy Photos Selected
    '',                        // Delivery Folder — filled by delivery script
    ''                         // Delivered At    — filled by delivery script
  ];
}

// ──────────────────── EMAILS ────────────────────
function sendParentReceipt(d, orderId) {
  const to = String(d.email || '').trim();
  if (!to || !to.includes('@')) return;

  const total = '$' + Number(d.orderTotal || 0).toFixed(2);
  const payInstructions = buildPaymentInstructions(d.payment, total);

  const html = `
    <div style="font-family:Segoe UI,system-ui,sans-serif;max-width:600px;margin:0 auto;color:#222;">
      <div style="background:#0d2a30;padding:24px;text-align:center;border-radius:12px 12px 0 0;">
        <div style="color:#fff;font-size:1.6rem;font-weight:900;letter-spacing:2px;">SHARK CITY <span style="color:#00b4c8">HOOPS</span></div>
        <div style="color:#00d4ea;letter-spacing:4px;text-transform:uppercase;font-size:0.75rem;margin-top:4px;">2026 Media Day Order</div>
      </div>
      <div style="padding:24px;background:#fff;border:1px solid #eee;border-top:none;">
        <h2 style="margin-top:0;font-size:1.2rem;">Order Received 🦈</h2>
        <p>Hi ${escapeHtml(d.parentName)},</p>
        <p>We've received your Media Day photo order for <strong>${escapeHtml(d.playerName)}</strong> (${escapeHtml(d.team)} · #${escapeHtml(d.jerseyNumber)}).</p>

        <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:0.9rem;">
          <tr><td style="padding:4px 0;color:#666;">Order ID:</td><td style="padding:4px 0;font-weight:700;">${orderId}</td></tr>
          <tr><td style="padding:4px 0;color:#666;">Package:</td><td style="padding:4px 0;">${escapeHtml(d.package || 'None')}</td></tr>
          <tr><td style="padding:4px 0;color:#666;">Player Poses:</td><td style="padding:4px 0;">${escapeHtml(d.selectedPlayerPoses) || '—'}</td></tr>
          <tr><td style="padding:4px 0;color:#666;">Group Photos:</td><td style="padding:4px 0;">${escapeHtml(d.selectedGroupPhotos) || '—'}</td></tr>
          <tr><td style="padding:4px 0;color:#666;">Total:</td><td style="padding:4px 0;font-size:1.3rem;font-weight:900;color:#008fa0;">${total}</td></tr>
        </table>

        <div style="background:#f5faff;border-left:4px solid #00b4c8;padding:14px 16px;margin:16px 0;">
          <div style="font-weight:700;margin-bottom:6px;">💳 Payment: ${escapeHtml(d.payment)}</div>
          <div style="font-size:0.9rem;line-height:1.6;">${payInstructions}</div>
        </div>

        <p style="font-size:0.9rem;">Once payment clears, your clean (unwatermarked) digital photos will be delivered ${DELIVERY_ETA}.</p>
        <p style="font-size:0.85rem;color:#666;">Questions? Reply to this email or write to <a href="mailto:info@sharkcityhoops.com">info@sharkcityhoops.com</a>.</p>
      </div>
      <div style="text-align:center;padding:16px;color:#888;font-size:0.75rem;">
        © 2026 Shark City Hoops · sharkcityhoops.com
      </div>
    </div>
  `;

  MailApp.sendEmail({
    to,
    subject: `Order Received: ${d.playerName} — ${orderId}`,
    htmlBody: html,
    replyTo: REPLY_TO,
    name: 'Shark City Hoops',
  });
}

function sendCoachNotification(d, orderId) {
  const total = '$' + Number(d.orderTotal || 0).toFixed(2);
  const subject = `[SCH ORDER] ${d.playerName} (${d.team}) — ${total}`;
  const body = [
    `New Media Day order received.`,
    ``,
    `Order ID: ${orderId}`,
    `Player: ${d.playerName} — ${d.team} #${d.jerseyNumber}`,
    `Parent: ${d.parentName} <${d.email}> ${d.phone || ''}`,
    ``,
    `Package: ${d.package}`,
    `Player Poses: ${d.selectedPlayerPoses || '—'}`,
    `Group Photos: ${d.selectedGroupPhotos || '—'}`,
    `Buddy Photos: ${d.buddy_photo || 0}${d.buddyNames ? ' (' + d.buddyNames + ')' : ''}`,
    ``,
    `Payment: ${d.payment}`,
    `Total: ${total}`,
    ``,
    `Notes: ${d.notes || '—'}`,
    ``,
    `Full row in Sheet: https://docs.google.com/spreadsheets/d/${SHEET_ID}`,
  ].join('\n');
  MailApp.sendEmail(NOTIFY_EMAIL, subject, body, { replyTo: d.email || REPLY_TO });
}

function buildPaymentInstructions(method, totalStr) {
  if (method === 'Zelle') {
    return `Please send <strong>${totalStr}</strong> via Zelle to <strong>${ZELLE_ADDRESS}</strong>. Include the player's name in the memo so we can match it to your order.`;
  }
  if (method === 'Venmo') {
    return `Send <strong>${totalStr}</strong> via Venmo. We'll reply with our handle within 24 hours.`;
  }
  if (method === 'PayPal') {
    return `We'll send PayPal instructions and an invoice for <strong>${totalStr}</strong> within 24 hours.`;
  }
  return `We'll follow up with cash/check drop-off details for <strong>${totalStr}</strong> within 24 hours.`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ══════════════════════════════════════════════════════════════════════
//   MAKER ORDERS (physical keepsake fulfillment)
// ══════════════════════════════════════════════════════════════════════

function getMakerSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(MAKER_SHEET_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(MAKER_SHEET_TAB);
    sheet.getRange(1, 1, 1, MAKER_HEADERS.length).setValues([MAKER_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  // Ensure headers exist (recover if row 1 got corrupted)
  const firstRow = sheet.getRange(1, 1, 1, MAKER_HEADERS.length).getValues()[0];
  if (firstRow[0] !== MAKER_HEADERS[0]) {
    sheet.getRange(1, 1, 1, MAKER_HEADERS.length).setValues([MAKER_HEADERS]).setFontWeight('bold');
  }
  return sheet;
}

/** Called from doPost when a new customer order lands: adds one Maker Orders
 *  row per physical item type with qty > 0. */
function appendMakerRows(d, orderId) {
  const sheet = getMakerSheet();
  const rows = [];
  const notes = String(d.notes || '');
  for (const [_colName, key, price, label] of KEEPSAKE_META) {
    const qty = Number(d[key] || 0);
    if (qty > 0) {
      rows.push([
        new Date(), orderId, d.playerName || '', d.team || '',
        d.parentName || '', d.email || '',
        label, qty, price, qty * price,
        '',       // Photo Filename — filled by delivery script
        notes,    // Photo Notes (copied from parent note)
        'New', '', '', '', ''    // Status + date fields
      ]);
    }
  }
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
}

/** Backfill Maker Orders rows for existing orders that were placed before
 *  this feature existed. RUN ONCE from the editor after deploying. Safe to
 *  re-run — skips orders that already have maker rows. */
function backfillMakerOrders() {
  const ordersSheet = getSheet();
  const values = ordersSheet.getDataRange().getValues();
  const headers = values[0];
  const idxOf = name => headers.indexOf(name);

  const makerSheet = getMakerSheet();
  const existingOrderIds = new Set(
    makerSheet.getDataRange().getValues().slice(1).map(r => String(r[1]))
  );

  let addedRows = 0;
  const newRows = [];
  for (const row of values.slice(1)) {
    const orderId = String(row[idxOf('Order ID')] || '');
    if (!orderId || existingOrderIds.has(orderId)) continue;
    const notes = String(row[idxOf('Notes')] || '');
    for (const [colName, _key, price, label] of KEEPSAKE_META) {
      const idx = idxOf(colName);
      if (idx < 0) continue;
      const qty = Number(row[idx] || 0);
      if (qty > 0) {
        newRows.push([
          row[idxOf('Timestamp')] || new Date(), orderId,
          row[idxOf('Player Name')] || '', row[idxOf('Team')] || '',
          row[idxOf('Parent Name')] || '', row[idxOf('Parent Email')] || '',
          label, qty, price, qty * price,
          '', notes, 'New', '', '', '', ''
        ]);
        addedRows++;
      }
    }
  }
  if (newRows.length) {
    makerSheet.getRange(makerSheet.getLastRow() + 1, 1, newRows.length, newRows[0].length)
              .setValues(newRows);
  }
  Logger.log(`Backfilled ${addedRows} maker rows.`);
  return addedRows;
}

// ══════════════════════════════════════════════════════════════════════
//   DELIVERY (called by deliver_order.py after files are copied)
// ══════════════════════════════════════════════════════════════════════

/** Handle action=deliver POST. Sends emails, updates statuses. */
function handleDeliver(data) {
  const orderId       = String(data.orderId || '').trim();
  const deliveryUrl   = String(data.deliveryUrl || '').trim();
  const makerUrl      = String(data.makerUrl || '').trim();
  const photoFilename = String(data.photoFilename || '').trim();

  if (!orderId)     return json({ ok: false, error: 'orderId required' });
  if (!deliveryUrl) return json({ ok: false, error: 'deliveryUrl required' });

  const order = findOrderById(orderId);
  if (!order) return json({ ok: false, error: `order ${orderId} not found` });

  // Send parent email + mark order Delivered
  sendParentDelivery(order, deliveryUrl);
  updateOrderDelivered(orderId, deliveryUrl);

  // If order has keepsake rows and maker URL was provided → email Krisha
  let makerItemCount = 0;
  if (makerUrl) {
    const makerRows = findMakerRowsByOrderId(orderId);
    if (makerRows.length) {
      sendMakerEmail(order, makerRows, makerUrl, photoFilename);
      updateMakerRowsSent(orderId, photoFilename);
      makerItemCount = makerRows.length;
    }
  }
  return json({ ok: true, orderId, delivered: true, makerItems: makerItemCount });
}

function findOrderById(orderId) {
  const values = getSheet().getDataRange().getValues();
  const headers = values[0];
  for (const row of values.slice(1)) {
    if (String(row[headers.indexOf('Order ID')]) === orderId) {
      return Object.fromEntries(headers.map((h, i) => [h, row[i]]));
    }
  }
  return null;
}

function findMakerRowsByOrderId(orderId) {
  const sheet = getMakerSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  return values.slice(1)
    .filter(r => String(r[1]) === orderId)  // col B = Order ID
    .map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}

function updateOrderDelivered(orderId, deliveryUrl) {
  const sheet = getSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const statusCol  = headers.indexOf('Status') + 1;
  const folderCol  = headers.indexOf('Delivery Folder') + 1;
  const deliveredCol = headers.indexOf('Delivered At') + 1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][headers.indexOf('Order ID')]) === orderId) {
      if (statusCol)    sheet.getRange(i+1, statusCol).setValue('Delivered');
      if (folderCol)    sheet.getRange(i+1, folderCol).setValue(deliveryUrl);
      if (deliveredCol) sheet.getRange(i+1, deliveredCol).setValue(new Date());
      return;
    }
  }
}

function updateMakerRowsSent(orderId, photoFilename) {
  const sheet = getMakerSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idxOf = name => headers.indexOf(name);
  const now = new Date();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1]) === orderId) {  // col B = Order ID
      if (photoFilename && idxOf('Photo Filename') >= 0) {
        sheet.getRange(i+1, idxOf('Photo Filename')+1).setValue(photoFilename);
      }
      sheet.getRange(i+1, idxOf('Status')+1).setValue('Sent to Maker');
      sheet.getRange(i+1, idxOf('Sent to Maker')+1).setValue(now);
    }
  }
}

function sendParentDelivery(order, url) {
  const to = String(order['Parent Email'] || '').trim();
  if (!to.includes('@')) return;
  const firstName = String(order['Parent Name'] || 'there').split(' ')[0];
  const player    = order['Player Name'] || '';
  const pkg       = order['Package'] || '';
  const html = `
    <div style="font-family:Segoe UI,system-ui,sans-serif;max-width:600px;margin:0 auto;color:#222;">
      <div style="background:#0d2a30;padding:24px;text-align:center;border-radius:12px 12px 0 0;">
        <div style="color:#fff;font-size:1.6rem;font-weight:900;letter-spacing:2px;">
          SHARK CITY <span style="color:#00b4c8">HOOPS</span>
        </div>
        <div style="color:#00d4ea;letter-spacing:4px;text-transform:uppercase;font-size:0.75rem;margin-top:4px;">
          Media Day Photos — Ready!
        </div>
      </div>
      <div style="padding:24px;background:#fff;border:1px solid #eee;border-top:none;">
        <p>Hi ${escapeHtml(firstName)},</p>
        <p>Your <strong>${escapeHtml(pkg)}</strong> package photos for <strong>${escapeHtml(player)}</strong> are ready to download.</p>
        <p style="text-align:center;margin:24px 0;">
          <a href="${escapeHtml(url)}" style="display:inline-block;background:#00b4c8;color:#ffffff;text-decoration:none;font-weight:800;padding:14px 28px;border-radius:8px;">
            📁 Download Your Photos
          </a>
        </p>
        <p style="font-size:0.85rem;color:#666;">
          Direct link: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a>
        </p>
        <p>Photos are yours to print, share, and enjoy. Reply if anything's missing or the link doesn't work.</p>
        <p style="margin-top:24px;">Thanks for supporting Shark City Hoops! 🦈<br><strong>— Coach Ron &amp; the SCH Staff</strong></p>
      </div>
    </div>`;
  MailApp.sendEmail({
    to,
    subject: `Your Media Day Photos are Ready — ${player}`,
    htmlBody: html,
    replyTo: REPLY_TO,
    name: 'Shark City Hoops',
  });
}

function sendMakerEmail(order, makerRows, url, photoFilename) {
  const player = order['Player Name'] || '';
  const jersey = order['Jersey #'] || '';
  const team   = order['Team'] || '';
  const orderId = order['Order ID'] || '';
  const notes  = order['Notes'] || '';

  const itemsHtml = makerRows.map(r =>
    `<tr>
       <td style="padding:6px 10px 6px 0;">${r.Qty}×</td>
       <td style="padding:6px 0;">${escapeHtml(r.Item)}</td>
     </tr>`
  ).join('');
  const totalItems = makerRows.reduce((s, r) => s + Number(r.Qty || 0), 0);

  const html = `
    <div style="font-family:Segoe UI,system-ui,sans-serif;max-width:600px;margin:0 auto;color:#222;">
      <h2 style="color:#0d2a30;">🛠️ New SCH Keepsake Order</h2>
      <p><strong>Order ID:</strong> ${escapeHtml(orderId)}</p>
      <p><strong>Player:</strong> ${escapeHtml(player)} #${escapeHtml(String(jersey))} (${escapeHtml(team)})</p>
      ${photoFilename ? `<p><strong>Photo to use:</strong> ${escapeHtml(photoFilename)}</p>` : ''}
      ${notes ? `<p style="background:#fff8ec;border-left:4px solid #f0a500;padding:12px 16px;"><strong>Parent note:</strong> ${escapeHtml(notes)}</p>` : ''}
      <p><strong>Photo + spec folder:</strong> <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
      <h3>Items (${totalItems} total):</h3>
      <table>${itemsHtml}</table>
      <p style="font-size:0.85rem;color:#666;margin-top:20px;">
        Ping me when they're ready and I'll pass them to the family. Thanks Krisha!<br>
        — Coach Ron
      </p>
    </div>`;
  MailApp.sendEmail({
    to: MAKER_EMAIL,
    subject: `SCH keepsake order — ${player} (${orderId})`,
    htmlBody: html,
    replyTo: NOTIFY_EMAIL,
    name: 'Shark City Hoops',
  });
}

// ──────────────────── UTILITY (run once from editor if needed) ────────────────────
function testSubmit() {
  const fake = {
    postData: { contents: JSON.stringify({
      timestamp: new Date().toString(),
      parentName: 'Test Parent', email: 'coachron@sharkcityhoops.com', phone: '408-555-0100',
      playerName: 'Test Player', team: 'Boys 8th Grade', jerseyNumber: '99',
      package: 'All-Star', packagePrice: 95,
      selectedPlayerPoses: 'pose1, pose2', selectedGroupPhotos: 'g_8th_boys_team_pose_1',
      buddy_photo: 1, buddyNames: 'Sibling A', buddySubtotal: 7,
      mug_11oz: 1, magnet: 2,
      keepsakeSubtotal: 28, discountPct: 0.10, discountAmt: 2.80,
      orderTotal: 127.20, payment: 'Zelle', notes: 'Test order — please ignore',
    })}
  };
  const out = doPost(fake);
  console.log(out.getContent());
}
