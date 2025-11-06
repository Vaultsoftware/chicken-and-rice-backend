// backend/lib/firebaseAdmin.js
import admin from "firebase-admin";
import fs from "fs";
import path from "path";

let initialized = false;
let bucketName = (process.env.FIREBASE_STORAGE_BUCKET || "").trim();
let projectIdFromCreds = "";

function stripWrappingQuotes(s) {
  if (!s) return s;
  const t = s.trim();
  // Handles strings like: "-----BEGIN ...\nABC\n-----END-----\n"
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return s;
}

function normalizePrivateKey(key) {
  if (!key) return key;
  let k = stripWrappingQuotes(key);
  if (k.includes("\\n")) k = k.replace(/\\n/g, "\n"); // env-escaped newlines
  return k;
}

function readCredsFromEnv() {
  const projectId = (process.env.FIREBASE_PROJECT_ID || "").trim();
  const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY || "");
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

function readCredsFromFile() {
  const guess = path.resolve(process.cwd(), "serviceAccountKey.json");
  if (!fs.existsSync(guess)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(guess, "utf8"));
    if (!raw?.project_id || !raw?.client_email || !raw?.private_key) return null;
    return {
      projectId: raw.project_id,
      clientEmail: raw.client_email,
      privateKey: raw.private_key,
    };
  } catch {
    return null;
  }
}

export async function initFirebase() {
  if (initialized && admin.apps.length) return;

  const fromEnv = readCredsFromEnv();
  const creds = fromEnv || readCredsFromFile();
  if (!creds) {
    throw new Error("Firebase creds not found. Set FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY or add serviceAccountKey.json.");
  }

  projectIdFromCreds = creds.projectId;
  if (!bucketName) bucketName = `${creds.projectId}.appspot.com`;
  bucketName = bucketName.trim();

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: creds.projectId,
      clientEmail: creds.clientEmail,
      privateKey: creds.privateKey,
    }),
    storageBucket: bucketName,
  });

  // Verify bucket exists & is accessible, fail fast with a helpful message
  try {
    const [exists] = await admin.storage().bucket(bucketName).exists();
    if (!exists) {
      throw new Error(
        `Storage bucket "${bucketName}" does not exist. Create it in Firebase Console (Storage) for project "${creds.projectId}", or set FIREBASE_STORAGE_BUCKET to a valid bucket.`
      );
    }
  } catch (e) {
    // If the SDK throws a permissions-ish error, surface it.
    throw new Error(`Firebase Storage check failed for bucket "${bucketName}": ${e?.message || e}`);
  }

  console.log(`✅ Firebase initialized (project=${creds.projectId}, bucket=${bucketName})`);
  initialized = true;
}

export function getBucket() {
  if (!initialized) throw new Error("Firebase not initialized");
  const name = bucketName || `${projectIdFromCreds}.appspot.com`;
  return admin.storage().bucket(name);
}

function normalizeRelPath(rel = "") {
  const cleaned = String(rel)
    .replace(/^\/+/, "")
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .join("/");
  return cleaned;
}

export async function putFile({ filename, buffer, contentType, cacheControl = "public, max-age=31536000, immutable" }) {
  if (!buffer || !filename) throw new Error("putFile requires { filename, buffer }");
  const bucket = getBucket();
  const rel = normalizeRelPath(filename);
  const file = bucket.file(rel);
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: contentType || "application/octet-stream",
      cacheControl,
    },
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
