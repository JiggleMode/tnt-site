/**
 * Uploads every games/<id>.html file to Firebase Storage at games/<id>.html.
 * Only buyers can download them (see storage.rules).
 *
 * Run from the project folder:
 *   cd functions && npm install && cd ..
 *   gcloud auth application-default login      (or set GOOGLE_APPLICATION_CREDENTIALS to a service-account key)
 *   node scripts/upload-games.js YOUR-PROJECT-ID
 */
const path = require("path");
const fs = require("fs");
const admin = require(path.join(__dirname, "../functions/node_modules/firebase-admin"));

const projectId = process.argv[2];
if (!projectId) { console.error("Usage: node scripts/upload-games.js YOUR-PROJECT-ID"); process.exit(1); }
admin.initializeApp({ projectId, storageBucket: process.argv[3] || `${projectId}.firebasestorage.app` });
const bucket = admin.storage().bucket();

(async () => {
  const dir = path.join(__dirname, "../games");
  const files = fs.readdirSync(dir).filter((f) => /^[a-z0-9-]+\.html$/.test(f));
  if (!files.length) { console.log("No game files found in games/."); return; }
  for (const f of files) {
    await bucket.upload(path.join(dir, f), { destination: `games/${f}`, metadata: { contentType: "text/html; charset=utf-8", cacheControl: "private, max-age=300" } });
    console.log("Uploaded", f);
  }
  console.log(`Done: ${files.length} game(s). If your bucket has a different name (older projects use <project>.appspot.com), pass it as the 2nd argument.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
