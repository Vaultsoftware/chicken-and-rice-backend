// backend/lib/firebaseAdmin.js
import admin from "firebase-admin";
import fs from "fs";
import path from "path";

function loadFromEnvTriplet() {
  const pid = process.env.FIREBASE_PROJECT_ID;
  const email = process.env.FIREBASE_CLIENT_EMAIL;
  let key = process.env.FIREBASE_PRIVATE_KEY;
  if (!pid || !email || !key) return null;
  // Fly secrets often store \n literals; convert to real newlines.
  key = key.replace(/\\n/g, "\n");
  return { project_id: pid, client_email: email, private_key: key };
}

function loadFromBase64() {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!b64) return null;
  try { return JSON.parse(Buffer.from(b64, "base64").toString("utf8")); } catch { return null; }
}

function loadFromJsonString() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

function loadFromFile() {
  const guess = process.env.FIREBASE_CREDENTIALS_FILE || "./serviceAccountKey.json";
  try {
    const p = path.resolve(guess);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { return null; }
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
      "Firebase credentials not found. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY (or provide serviceAccountKey.json / FIREBASE_SERVICE_ACCOUNT_*)."
    );
  }
  const bucketName =
    process.env.FIREBASE_STORAGE_BUCKET || `${sa.project_id}.appspot.com`;

  return admin.initializeApp({
    credential: admin.credential.cert(sa),
    storageBucket: bucketName,
  });
}

export function getBucket() {
  const app = initFirebase();
  return admin.storage().bucket();
}

export async function putFile({ filename, buffer, contentType, cacheControl }) {
  const bucket = getBucket();
  const file = bucket.file(filename); // store flat: "<filename>"
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
