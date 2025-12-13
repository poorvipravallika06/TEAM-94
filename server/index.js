import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import db from './db.js';

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));

app.get('/health', (req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

// Faces: enrollments
app.get('/faces', async (req, res) => {
  const rows = await db.getFaces();
  res.json(rows);
});

app.post('/faces', async (req, res) => {
  const { label, descriptor } = req.body;
  if (!label || !descriptor) return res.status(400).json({ error: 'Missing label or descriptor' });
  const id = await db.addFace(label, descriptor);
  res.json({ ok: true });
});

// Events: per-detection emotion events
app.post('/events', async (req, res) => {
  const { face_label, emotion, confidence, timestamp, session_id, delta } = req.body;
  const id = await db.insertEvent({ face_label: face_label || null, emotion: emotion || null, confidence: confidence || 0, delta: delta || 0, session_id: session_id || null, timestamp: timestamp || new Date().toISOString() });
  res.json({ ok: true });
});

app.get('/events', async (req, res) => {
  const { face_label, session_id } = req.query;
  const rows = await db.getEvents({ face_label, session_id, limit: 1000 });
  res.json(rows);
});

// Sessions: create & list
app.post('/sessions', async (req, res) => {
  const { name, meta } = req.body;
  const id = await db.addSession(name || null, meta || null);
  res.json({ ok: true, id });
});

app.get('/sessions', async (req, res) => {
  const rows = await db.getSessions();
  res.json(rows);
});

// Students history
app.get('/students/:email/history', async (req, res) => {
  const { email } = req.params;
  const row = await db.getStudentHistory(email);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ email: row.email, name: row.name, history: row.history });
});

app.post('/students/:email/history', async (req, res) => {
  const { email } = req.params;
  const { name, history } = req.body;
  await db.setStudentHistory(email, name || null, history || {});
  res.json({ ok: true });
});

// Clear db (dev only)
app.post('/_admin/clear', async (req, res) => {
  await db.clearAll();
  res.json({ ok: true });
});

app.listen(port, () => console.log(`GVP server running on http://localhost:${port}`));
