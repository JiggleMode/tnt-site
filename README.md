# The TnT Brother Games: shop, payments, player and analytics

## What's in this folder

| File | What it does |
|---|---|
| `public/index.html` | The shop. It has the Google, Apple and Microsoft sign-in, the launch offer, and Razorpay checkout. |
| `public/play.html` | The player. It loads a game the person owns and records each play session. |
| `public/admin.html` | Your dashboard for revenue, play time, player preferences, the session audit trail, CSV exports and the offer settings. |
| `public/config.js` | **Paste your Firebase config here.** All three pages use it. |
| `public/catalog.js` | The game list: names, descriptions and colours. |
| `functions/index.js` | The server. It sets prices, creates Razorpay orders, checks payments, handles the webhook, unlocks games and adds up play time. |
| `firestore.rules`, `storage.rules` | Security rules. Players can't unlock games, change prices or read other people's data. |
| `games/` | Put each game's HTML file here, then run `scripts/upload-games.js`. |

## How it works

**Buying**
1. A player signs in and taps a game.
2. The server works out the price. The first game is ₹80 while the launch offer is on, and later games are ₹100.
3. Razorpay checkout opens with UPI, card and netbanking.
4. The server checks Razorpay's signature and the order, then adds the game to the player's account **for good**. There is no expiry and no time limit.
5. A Razorpay webhook acts as a backup. If the player closes the page right after paying, the game still unlocks.

**Playing**
- `play.html?g=<id>` checks the player owns the game, then downloads the game file. Only owners can download it.
- It saves a **session** with the start time, the last time the player was seen, the end time, the active seconds, an input count, the device and the time zone.
- Active time pauses when the tab is hidden or after a minute with no input. Progress is saved every 20 seconds.
- A server trigger adds each session to the player's totals and the game's totals.

**Analytics** (`/admin.html`)
- **Summary numbers:** revenue, games sold, how many people used the offer and how much discount was given, play time, sessions and average time per player.
- **Charts:**
  - Play time and revenue by game
  - Play by hour of day and by day of week
  - Session lengths and devices
  - Purchase funnel: saw a game → opened pay screen → started payment → paid
  - Games often bought together
- **Tables:** every game, every player (games owned, amount spent, play time, favourite game, last played), every **play session** (the audit trail) and every payment. Each table can be downloaded as a CSV.
- **Launch offer controls:** switch it on or off, change the %, keep it first-purchase-only or not, and edit the label. Changes apply straight away.

## Payments: UPI QR with manual approval (current mode)

The shop currently takes payment by UPI QR code, with no payment gateway and no Cloud Functions:
1. The player scans the QR (generated with the right amount), pays, and types the 12-digit UTR.
2. An order `orders/<UTR>` is saved as **pending**, and you get an email (via Web3Forms) with an **Approve** link.
3. The link opens `admin.html?approve=<UTR>`. Check the UTR and amount in your bank or UPI app, then click **Approve and unlock**. The game appears on the player's account straight away.

Pending orders are also listed at the top of the dashboard, in case an email goes missing.

**Setup:** in `public/config.js`, fill `PAYMENT.upiId` and `PAYMENT.notifyKey` (free key from web3forms.com, sent to the email you want notifications at). Publish `firestore.rules` (Firestore > Rules in the console, or `firebase deploy --only firestore`). Make yourself an admin (step 7 below). Open the dashboard once so it saves the game links.

The Razorpay setup below is only needed if you switch back to automatic payments.

## Setup

### 1. Firebase
1. Create a project at console.firebase.google.com and switch it to the **Blaze** plan. Cloud Functions need it.
2. Create a **Firestore** database and **Storage**, both in the `asia-south1` (Mumbai) region.
3. Add a **Web app** under Project settings. Copy its config into `public/config.js`, including `storageBucket`.
4. Put your project id in `.firebaserc`, and replace `YOUR-PROJECT-ID` in `cors.json`.

### 2. Sign-in (Authentication > Sign-in method)
- **Google:** turn it on.
- **Microsoft:** register an app in the Azure portal, add Firebase's redirect URL, then paste the client ID and secret into Firebase.
- **Apple:** needs an Apple Developer account ($99 a year). Create a Services ID and key, add the redirect URL, then paste the details into Firebase.

### 3. Razorpay
1. Complete KYC on razorpay.com. Use **test mode** first.
2. Save your keys as secrets:
   ```
   firebase functions:secrets:set RAZORPAY_KEY_ID
   firebase functions:secrets:set RAZORPAY_KEY_SECRET
   firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
   ```
   For the webhook secret, make up a long random string. You'll paste the same string into Razorpay in step 5.

### 4. Deploy
```
npm install -g firebase-tools
firebase login
cd functions && npm install && cd ..
firebase deploy
gsutil cors set cors.json gs://YOUR-BUCKET-NAME
```
On the first deploy, Firebase asks whether Storage rules may read Firestore. Say **yes**, because it's how game files are limited to owners.

### 5. Razorpay webhook (backup for unlocks)
1. In the Razorpay Dashboard, go to Settings > Webhooks > Add.
2. Set the URL to the `razorpayWebhook` function link shown after deploy, for example `https://asia-south1-YOUR-PROJECT-ID.cloudfunctions.net/razorpayWebhook`.
3. Use the same secret as `RAZORPAY_WEBHOOK_SECRET`.
4. Tick the event **payment.captured**.

### 6. Upload the games
1. Save each game's HTML as `games/<id>.html`. `games/README.txt` lists the names.
2. Run:
   ```
   gcloud auth application-default login
   node scripts/upload-games.js YOUR-PROJECT-ID
   ```

If a game has no file uploaded yet, buyers are sent to its claude.ai link. That works, but play time can't be tracked there.

### 7. Make yourself an admin
1. Sign in on the shop once.
2. Open `/admin.html`. It shows your user id.
3. In the Firestore console, create a document `admins/<that id>`. Any field will do.
4. Refresh the dashboard.

### 8. Test, then go live
- **Test purchase:** with Razorpay test keys, buy a game and check the first one shows ₹80.
- **Second purchase:** buy another game and check it shows ₹100.
- **Tracking:** play for a few minutes, then check the session appears in the dashboard.
- **Go live:** switch the secrets to your live keys, then run `firebase deploy --only functions`.

## Notes
- **Prices:** change `BASE_PRICE_PAISE` in `functions/index.js` and `BASE` in `public/index.html`.
- **Accuracy:** play time is measured in the player's browser, so it's for understanding behaviour, not billing. The rules stop anyone adding more than 60 seconds per save.
- **Privacy:** you're storing names, emails and play activity. Add a short privacy policy page that says what you collect and why. If players may be under 18, check what consent you need.
- **Deeper analysis:** install the "Stream Firestore to BigQuery" Firebase extension to query sessions and payments with SQL or Looker Studio.
- **Adding a game:** add it to `public/catalog.js` and `GAMES` in `functions/index.js` with the same id, upload `games/<id>.html`, then deploy.
