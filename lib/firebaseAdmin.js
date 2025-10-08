// backend/lib/firebaseAdmin.js
/**
 * Firebase Admin bootstrap that works on Fly:
 * - Supports multiple credential sources (env triplet / base64 / json / file).
 * - Converts \n in PRIVATE_KEY for correct PEM parsing.
 * - Exposes small helpers for storage put/stat.
 */
import admin from "firebase-admin";
import fs from "fs";
import path from "path";

function loadFromEnvTriplet() {
  const project_id = process.env.FIREBASE_PROJECT_ID;
  const client_email = process.env.FIREBASE_CLIENT_EMAIL;
  let private_key = process.env.FIREBASE_PRIVATE_KEY;
  if (!project_id || !client_email || !private_key) return null;
  private_key = private_key.replace(/\\n/g, "\n"); // Fly secrets keep \n literal
  return { project_id, client_email, private_key };
}

function loadFromBase64() {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!b64) return null;
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function loadFromJsonString() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function loadFromFile() {
  const guess = process.env.FIREBASE_CREDENTIALS_FILE || "./serviceAccountKey.json";
  try {
    const p = path.resolve(guess);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function getServiceAccount() {
  return (
    loadFromEnvTriplet() ||
    loadFromBase64() ||
    loadFromJsonString() ||
    loadFromFile()
  );
}

export function initFirebase() {
  if (admin.apps.length) return admin.app();
  const sa = getServiceAccount();
  if (!sa) {
    throw new Error(
      "Firebase credentials not found. Provide FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY (or one of FIREBASE_SERVICE_ACCOUNT_* / FIREBASE_CREDENTIALS_FILE)."
    );
  }
  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET || `${sa.project_id}.appspot.com`;

  return admin.initializeApp({
    credential: admin.credential.cert(sa),
    storageBucket,
  });
}

export function getBucket() {
  const app = initFirebase();
  return admin.storage().bucket();
}

export async function putFile({ filename, buffer, contentType, cacheControl }) {
  const bucket = getBucket();
  const file = bucket.file(filename);
  await file.save(buffer, {
    resumable: false,
    contentType: contentType || "application/octet-stream",
    metadata: {
      cacheControl: cacheControl || "public, max-age=31536000, immutable",
    },
  });
  return { bucket: bucket.name, object: file.name };
}

export async function statObject(objectPath) {
  const bucket = getBucket();
  const file = bucket.file(objectPath);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [meta] = await file.getMetadata();
  return { file, meta };
}
