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
const NOTIFY_EMAIL   = 'coachron@sharkcityhoops.com';
const REPLY_TO       = 'info@sharkcityhoops.com';
const ADMIN_KEY      = 'CHANGE_ME_TO_A_LONG_RANDOM_STRING';
const ZELLE_ADDRESS  = 'sharkcityhoops@gmail.com';
const DELIVERY_ETA   = 'within 1 week of payment confirmation';
// ────────────────────────────────────────────────

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
    const orderId = 'SCH-' + Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyMMdd-HHmmss');
    const row = buildRow(data, orderId);
    appendRow(row);
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
