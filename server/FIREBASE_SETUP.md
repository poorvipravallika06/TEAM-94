# Firestore setup

This project supports using Google Firestore as a persistence backend for the GVP server.

1. Create a Firebase project at https://console.firebase.google.com/
2. Enable Firestore (in Native mode) in that project.
3. Create a service account (IAM & Admin -> Service accounts -> Create service account). Add the role Firebase Admin SDK Administrator. Create a new private key (JSON) and download it.

Local usage options:
- Set `FIREBASE_SERVICE_ACCOUNT_FILE` to the full local path of the JSON key file.
- Or set `FIREBASE_SERVICE_ACCOUNT_JSON` to the JSON string content (not recommended for long keys; use secret manager).

Example (Unix):

```bash
export FIREBASE_SERVICE_ACCOUNT_FILE=/path/to/serviceAccountKey.json
cd server
npm install
npm run dev
```

Example (PowerShell):

```powershell
$env:FIREBASE_SERVICE_ACCOUNT_FILE = 'C:\Users\you\Downloads\serviceAccountKey.json'
cd server
npm install
npm run dev
```

- When running the server with the env var, it will initialize Firestore client and use Firestore collections for: `faces`, `events`, `students`, and `sessions`.
- If Firestore is not enabled, the server falls back to a JSON file at `server/data/gvp.json` for persistence.

Migration notes:
- If you want to migrate existing local JSON DB to Firestore, you can write a small script that reads `server/data/gvp.json` and writes documents into Firestore collections. This is left as an exercise for your environment and security needs.

Security:
- Do not commit your service account JSON to the repository. Use environment variables or secret managers in CI/CD.
