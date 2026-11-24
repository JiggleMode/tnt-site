/**
 * TnT Brother Games — server functions.
 * Prices, payments and unlocks are decided here, never in the browser.
 */
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");
const Razorpay = require("razorpay");

admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const REGION = "asia-south1";
const KEY_ID = defineSecret("RAZORPAY_KEY_ID");
const KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");
const WEBHOOK_SECRET = defineSecret("RAZORPAY_WEBHOOK_SECRET");
const opts = { region: REGION, secrets: [KEY_ID, KEY_SECRET] };

const BASE_PRICE_PAISE = 10000; // ₹100 per game
// Launch offer. Live values are read from Firestore config/promo, so you can change
// or switch off the offer from the admin dashboard without redeploying.
const DEFAULT_PROMO = { active: true, percent: 20, firstPurchaseOnly: true, label: "20% off your first game" };

// Game id -> name and fallback link (used only if the game file isn't uploaded to Storage yet).
const GAMES = {
  "wrestling": { name: "Iron Ring Legends", url: "https://claude.ai/artifact/9qCiaboUuL8ygGvvf1SYk2" },
  "katana": { name: "Katana Drop", url: "https://claude.ai/artifact/Tmxdy9WAtjW3gi7BbdAcMy" },
  "mining": { name: "Deep Dig 3D", url: "https://claude.ai/artifact/MvJfdh2axT9e1r8FE1wXse" },
  "marathon": { name: "Summer Games Athletics", url: "https://claude.ai/artifact/2feTbA426dCpFfvsR2iZ7T" },
  "rally": { name: "Open Road Rally", url: "https://claude.ai/artifact/MfPXtAqCt659SCjS15RN32" },
  "golf": { name: "Fairway Twenty Golf", url: "https://claude.ai/artifact/DxhsuFoe3CSH3FZWYDQhUc" },
  "street-tour": { name: "Street Football World Tour", url: "https://claude.ai/artifact/SqFM6e2Y4GrrCJqYZpeoz3" },
  "kick-quest": { name: "Kick Quest", url: "https://claude.ai/artifact/7pkN66b9qzzrs3PWzJrfT2" },
  "goal-runner": { name: "Goal Runner", url: "https://claude.ai/artifact/1fDFRZqzF3H34RjEoQ9hDR" },
  "kingdoms": { name: "Football Kingdoms", url: "https://claude.ai/artifact/6fC5bx8V24yNqCfWoUUeCK" },
  "trick-shot": { name: "Trick Shot Island", url: "https://claude.ai/artifact/RKmFW2DVamFqeeC3yiYkPq" },
};

const needUser = (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Please sign in first.");
  return req.auth.uid;
};
const needGame = (id) => {
  if (typeof id !== "string" || !GAMES[id]) throw new HttpsError("invalid-argument", "Unknown game.");
  return id;
};
const razorpay = () => new Razorpay({ key_id: KEY_ID.value(), key_secret: KEY_SECRET.value() });

async function getPromo() {
  const snap = await db.doc("config/promo").get();
  return { ...DEFAULT_PROMO, ...(snap.exists ? snap.data() : {}) };
}

/** Price for this user right now, in paise. */
async function priceFor(uid) {
  const [promo, user] = await Promise.all([getPromo(), db.doc(`users/${uid}`).get()]);
  const purchases = (user.exists && user.get("purchases")) || 0;
  const pct = Math.max(0, Math.min(90, Number(promo.percent) || 0));
  const eligible = promo.active && pct > 0 && (!promo.firstPurchaseOnly || purchases === 0);
  const amount = eligible ? Math.round(BASE_PRICE_PAISE * (100 - pct) / 100) : BASE_PRICE_PAISE;
  return { amount, base: BASE_PRICE_PAISE, discountPercent: eligible ? pct : 0, promoLabel: eligible ? promo.label : null };
}

/** Unlock a game for good. Safe to call twice for the same payment (checkout + webhook). */
async function grantGame({ uid, gameId, orderId, paymentId, amount, discountPercent, source, email, name }) {
  const payRef = db.collection("payments").doc(paymentId);
  const userRef = db.doc(`users/${uid}`);
  return db.runTransaction(async (tx) => {
    const [pay, user] = await Promise.all([tx.get(payRef), tx.get(userRef)]);
    if (pay.exists) return false; // already recorded
    const now = FieldValue.serverTimestamp();
    tx.set(payRef, { uid, gameId, orderId, paymentId, amount, discountPercent, source, email: email || null, at: now });
    const profile = { unlocked: FieldValue.arrayUnion(gameId), purchases: FieldValue.increment(1), spentPaise: FieldValue.increment(amount), updatedAt: now };
    if (email) profile.email = email;
    if (name) profile.name = name;
    if (!user.exists || !user.get("firstPurchaseAt")) profile.firstPurchaseAt = now;
    tx.set(userRef, profile, { merge: true });
    tx.set(db.doc(`gameStats/${gameId}`), { purchases: FieldValue.increment(1), revenuePaise: FieldValue.increment(amount) }, { merge: true });
    return true;
  });
}

// Price shown on the pay screen.
exports.getPrice = onCall({ region: REGION }, async (req) => priceFor(needUser(req)));

// 1. Start a Razorpay order at the right price.
exports.createOrder = onCall(opts, async (req) => {
  const uid = needUser(req);
  const gameId = needGame(req.data && req.data.gameId);
  const owned = (await db.doc(`users/${uid}`).get()).get("unlocked") || [];
  if (owned.includes(gameId)) throw new HttpsError("already-exists", "You already own this game.");
  const price = await priceFor(uid);
  const order = await razorpay().orders.create({
    amount: price.amount,
    currency: "INR",
    receipt: `${gameId}-${Date.now()}`.slice(0, 40),
    notes: { uid, gameId, discountPercent: String(price.discountPercent) },
  });
  return { orderId: order.id, amount: order.amount, keyId: KEY_ID.value(), ...price };
});

// 2. Checkout finished: check Razorpay's signature and the order, then unlock.
exports.verifyPayment = onCall(opts, async (req) => {
  const uid = needUser(req);
  const gameId = needGame(req.data && req.data.gameId);
  const { orderId, paymentId, signature } = req.data || {};
  if (![orderId, paymentId, signature].every((v) => typeof v === "string" && v)) {
    throw new HttpsError("invalid-argument", "Missing payment details.");
  }
  const expected = crypto.createHmac("sha256", KEY_SECRET.value()).update(`${orderId}|${paymentId}`).digest("hex");
  if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    throw new HttpsError("permission-denied", "Payment could not be verified.");
  }
  const order = await razorpay().orders.fetch(orderId);
  if (!order.notes || order.notes.uid !== uid || order.notes.gameId !== gameId) {
    throw new HttpsError("permission-denied", "This payment does not match this game.");
  }
  await grantGame({
    uid, gameId, orderId, paymentId, amount: order.amount, discountPercent: Number(order.notes.discountPercent) || 0,
    source: "checkout", email: req.auth.token.email, name: req.auth.token.name,
  });
  return { ok: true };
});

// 3. Backup: Razorpay calls this when a payment is captured, in case the buyer closed the page too early.
//    Set it up in Razorpay Dashboard > Webhooks with the event "payment.captured".
exports.razorpayWebhook = onRequest({ region: REGION, secrets: [KEY_ID, KEY_SECRET, WEBHOOK_SECRET] }, async (req, res) => {
  const sig = req.get("x-razorpay-signature") || "";
  const expected = crypto.createHmac("sha256", WEBHOOK_SECRET.value()).update(req.rawBody).digest("hex");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    res.status(400).send("bad signature");
    return;
  }
  try {
    if (req.body.event === "payment.captured") {
      const p = req.body.payload.payment.entity;
      const order = await razorpay().orders.fetch(p.order_id);
      const { uid, gameId, discountPercent } = order.notes || {};
      if (uid && GAMES[gameId]) {
        let email = p.email || null;
        try { email = (await admin.auth().getUser(uid)).email || email; } catch (e) { /* keep payment email */ }
        await grantGame({ uid, gameId, orderId: p.order_id, paymentId: p.id, amount: p.amount, discountPercent: Number(discountPercent) || 0, source: "webhook", email });
      }
    }
    res.status(200).send("ok");
  } catch (e) {
    console.error(e);
    res.status(500).send("error");
  }
});

// 4. Fallback link for a game whose file isn't uploaded to Storage yet (owners only).
exports.getGameUrl = onCall({ region: REGION }, async (req) => {
  const uid = needUser(req);
  const gameId = needGame(req.data && req.data.gameId);
  const owned = (await db.doc(`users/${uid}`).get()).get("unlocked") || [];
  if (!owned.includes(gameId)) throw new HttpsError("permission-denied", "Unlock this game first.");
  return { url: GAMES[gameId].url };
});

// 5. Play-time totals: every time a play session is saved, add the new seconds to
//    the player's totals and the game's totals, so the dashboard reads small summaries.
exports.onSessionWrite = onDocumentWritten({ region: REGION, document: "sessions/{sid}" }, async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  if (!after) return;
  const { uid, gameId } = after;
  if (!uid || !GAMES[gameId]) return;
  const delta = Math.max(0, (after.activeSeconds || 0) - ((before && before.activeSeconds) || 0));
  const isNew = !before;
  if (!delta && !isNew) return;
  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(db.doc(`users/${uid}`), {
    stats: { [gameId]: { seconds: FieldValue.increment(delta), sessions: FieldValue.increment(isNew ? 1 : 0), lastPlayedAt: now } },
    totalSeconds: FieldValue.increment(delta),
    lastPlayedAt: now,
  }, { merge: true });
  batch.set(db.doc(`gameStats/${gameId}`), {
    seconds: FieldValue.increment(delta), sessions: FieldValue.increment(isNew ? 1 : 0), lastPlayedAt: now,
  }, { merge: true });
  await batch.commit();
});
