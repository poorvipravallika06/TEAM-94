import admin from 'firebase-admin';
import fs from 'fs';

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_FILE || null;

let db = null;
if (serviceAccountJson) {
  try {
    let serviceAccount = null;
    if (serviceAccountJson.trim().startsWith('{')) {
      serviceAccount = JSON.parse(serviceAccountJson);
    } else if (fs.existsSync(serviceAccountJson)) {
      serviceAccount = JSON.parse(fs.readFileSync(serviceAccountJson, 'utf8'));
    }

    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      db = admin.firestore();
      console.log('Firestore initialized via FIREBASE_SERVICE_ACCOUNT JSON');
    }
  } catch (err) {
    console.warn('Failed to init firestore', err);
  }
} else {
  console.log('FIREBASE_SERVICE_ACCOUNT not set; Firestore disabled');
}

export default db;
