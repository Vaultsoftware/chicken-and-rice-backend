// ============================================================================
// backend/lib/firebaseAdmin.js
// ============================================================================
import admin from "firebase-admin";
import fs from "fs";
import path from "path";

let initialized = false;
let bucketName = process.env.FIREBASE_STORAGE_BUCKET || "";
let projectIdFromCreds = "";

function readCredsFromEnv() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) return null;
  if (privateKey.includes("\\n")) privateKey = privateKey.replace(/\\n/g, "\n");
  return { projectId, clientEmail, privateKey };
}
function readCredsFromFile() {
  const guess = path.resolve(process.cwd(), "serviceAccountKey.json");
  if (!fs.existsSync(guess)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(guess, "utf8"));
    if (!raw?.project_id || !raw?.client_email || !raw?.private_key) return null;
    return { projectId: raw.project_id, clientEmail: raw.client_email, privateKey: raw.private_key };
  } catch {
    return null;
  }
}
function normalizeRelPath(rel = "") {
  return String(rel)
    .replace(/^\/+/, "")
    .replace(/^uploads\//i, "")
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .join("/");
}

export async function initFirebase() {
  if (initialized && admin.apps.length) return;
  const fromEnv = readCredsFromEnv();
  const creds = fromEnv || readCredsFromFile();
  if (!creds) {
    throw new Error("Firebase creds missing. Set FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY or add serviceAccountKey.json.");
  }
  projectIdFromCreds = creds.projectId;
  if (!bucketName) bucketName = `${creds.projectId}.appspot.com`;

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: creds.projectId,
      clientEmail: creds.clientEmail,
      privateKey: creds.privateKey,
    }),
    storageBucket: bucketName,
  });

  // Verify bucket exists & readable
  try {
    const b = admin.storage().bucket(bucketName);
    await b.getFiles({ maxResults: 1 }).catch((e) => {
      throw new Error(`Storage bucket "${bucketName}" access failed: ${e?.message || e}`);
    });
    initialized = true;
    console.log(`✅ Firebase initialized (project=${creds.projectId}, bucket=${bucketName})`);
  } catch (e) {
    throw new Error(`Firebase Storage check failed for bucket "${bucketName}": ${e?.message || e}`);
  }
}

export function getBucket() {
  if (!initialized) throw new Error("Firebase not initialized");
  const name = bucketName || `${projectIdFromCreds}.appspot.com`;
  return admin.storage().bucket(name);
}

export async function putFile({ filename, buffer, contentType, cacheControl = "public, max-age=31536000, immutable" }) {
  if (!buffer || !filename) throw new Error("putFile requires { filename, buffer }");
  const bucket = getBucket();
  const rel = normalizeRelPath(filename);
  const file = bucket.file(rel);
  await file.save(buffer, {
    resumable: false,
    metadata: { contentType: contentType || "application/octet-stream", cacheControl },
    validation: "crc32c",
  });
  return { ok: true, path: rel };
}

export async function statObject(relPath) {
  const bucket = getBucket();
  const rel = normalizeRelPath(relPath);
  const file = bucket.file(rel);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [metadata] = await file.getMetadata();
  const meta = {
    contentType: metadata.contentType || "application/octet-stream",
    cacheControl: metadata.cacheControl || "public, max-age=31536000, immutable",
    size: Number(metadata.size || 0),
    updated: metadata.updated || null,
    etag: metadata.etag || null,
  };
  return { file, meta };
}

export async function deleteObject(relPath) {
  const bucket = getBucket();
  const rel = normalizeRelPath(relPath);
  try { await bucket.file(rel).delete({ ignoreNotFound: true }); }
  catch (e) { console.warn("⚠️ deleteObject failed:", rel, e?.message || e); }
}
