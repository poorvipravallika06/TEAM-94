# GVP Local Server (Persistence)

This lightweight server provides simple REST endpoints for persistence used by the GVP frontend. It stores:
- `faces`: labeled face descriptors
- `events`: per-frame emotion events
- `students`: student history object

Run server (dev):

```bash
cd server
npm install
npm run dev
```

Default server URL: `http://localhost:4000`

Available endpoints:
- `GET /health` — server status
- `GET /faces` — list enrolled faces
- `POST /faces` — enroll new face (body: `{ label, descriptor }`)
- `GET /events` — recent events
- `POST /events` — append emotion event (body: `{ face_label, emotion, confidence, timestamp }`)
- `GET /students/:email/history` — get student history JSON
- `POST /students/:email/history` — update student history
- `POST /_admin/clear` — (dev) clear all data
Frontend News API (optional):
- To enable live headlines in the Trends page, set a `VITE_NEWS_API_KEY` environment variable in the frontend (e.g., in `.env` file) with a NewsAPI.org API key or another news provider key. If not set, the app will fall back to mock headlines.

DB File: `server/data/gvp.sqlite3` — this is created automatically on first run.

Notes:
- This is intended for local development. For production, use a managed DB and secure the endpoints with authentication.
- The server creates the DB schema on first launch.
 
Firestore Integration (optional):
- The server supports using Firestore as a backend if you provide a Firebase service account JSON via environment variables.
- To enable Firestore, set `FIREBASE_SERVICE_ACCOUNT_JSON` to the service account JSON content, or `FIREBASE_SERVICE_ACCOUNT_FILE` to a path of the service account JSON on disk.
	- Example (Unix):
		```bash
		export FIREBASE_SERVICE_ACCOUNT_FILE=/path/to/serviceAccountKey.json
		cd server
		npm install
		npm run dev
		```
	- Example (Windows PowerShell):
		```powershell
		$env:FIREBASE_SERVICE_ACCOUNT_FILE = 'C:\path\to\serviceAccountKey.json'
		cd server
		npm install
		npm run dev
		```

Notes:
- When Firestore is configured, the server will store documents in `faces`, `events`, `students`, and `sessions` collections in your Firestore project.
- The JSON file or env var is used only locally; for production use a secure secret management workflow.
 
Local JSON fallback:
- If Firestore isn't provided the server falls back to a JSON file under `server/data/gvp.json` for local persistence.
