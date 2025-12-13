import fs from 'fs';
import path from 'path';
import firestore from './firestoreClient.js';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const filePath = path.join(dataDir, 'gvp.json');

const initial = {
  _counters: { faces: 0, events: 0, sessions: 0 },
  faces: [],
  events: [],
  students: [],
  sessions: []
};

const read = () => {
  try {
    const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    if (!raw) return { ...initial };
    return JSON.parse(raw);
  } catch (err) {
    console.warn('Failed to read db file, recreating', err);
    return { ...initial };
  }
};

const write = (data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.warn('Failed to write db file', err);
  }
};

const ensure = () => {
  const d = read();
  if (!d._counters) d._counters = { faces: 0, events: 0, sessions: 0 };
  if (!d.faces) d.faces = [];
  if (!d.events) d.events = [];
  if (!d.students) d.students = [];
  if (!d.sessions) d.sessions = [];
  write(d);
};

ensure();

const exportObj = {
  getFaces: () => {
    if (firestore) {
      return firestore.collection('faces').orderBy('created_at', 'desc').get().then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() }))).catch(e => []);
    }
    const d = read();
    return d.faces.slice().reverse();
  },
  addFace: (label, descriptor) => {
    if (firestore) {
      return firestore.collection('faces').add({ label, descriptor, created_at: new Date().toISOString() }).then(ref => ref.id);
    }
    const d = read();
    d._counters.faces = (d._counters.faces || 0) + 1;
    const id = d._counters.faces;
    d.faces.push({ id, label, descriptor, created_at: new Date().toISOString() });
    write(d);
    return id;
  },
  insertEvent: ({ face_label, emotion, confidence, delta, session_id, timestamp }) => {
    if (firestore) {
      const payload = { face_label, emotion, confidence, delta, session_id, timestamp: timestamp || new Date().toISOString() };
      return firestore.collection('events').add(payload).then(ref => ref.id);
    }
    const d = read();
    d._counters.events = (d._counters.events || 0) + 1;
    const id = d._counters.events;
    d.events.push({ id, face_label, emotion, confidence, delta, session_id, timestamp: timestamp || new Date().toISOString() });
    write(d);
    return id;
  },
  getEvents: ({ face_label, session_id, limit = 500 } = {}) => {
    if (firestore) {
      let q = firestore.collection('events').orderBy('timestamp', 'desc');
      if (face_label) q = q.where('face_label', '==', face_label);
      if (session_id) q = q.where('session_id', '==', session_id);
      return q.limit(limit).get().then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() }))).catch(e => []);
    }
    const d = read();
    let arr = d.events.slice().reverse();
    if (face_label) arr = arr.filter(e => e.face_label === face_label);
    if (session_id) arr = arr.filter(e => String(e.session_id) === String(session_id));
    return arr.slice(0, limit);
  },
  getStudents: () => read().students.slice().reverse(),
  getStudentHistory: (email) => {
    if (firestore) {
      return firestore.collection('students').doc(email).get().then(doc => doc.exists ? doc.data() : null).catch(e => null);
    }
    const d = read();
    const st = d.students.find(s => s.email === email);
    return st || null;
  },
  setStudentHistory: (email, name, history) => {
    if (firestore) {
      return firestore.collection('students').doc(email).set({ email, name, history });
    }
    const d = read();
    const idx = d.students.findIndex(s => s.email === email);
    if (idx >= 0) d.students[idx] = { email, name, history };
    else d.students.push({ email, name, history });
    write(d);
  },
  clearAll: () => {
    if (firestore) {
      // Best-effort delete (dev only) - may not scale
      const collections = ['faces', 'events', 'students', 'sessions'];
      return Promise.all(collections.map(async (c) => {
        const snap = await firestore.collection(c).get();
        const batch = firestore.batch();
        snap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      })).then(() => true).catch(e => { console.warn('Failed to clear firestore', e); return false; });
    }
    write(initial);
  },
  addSession: (name, meta) => {
    if (firestore) {
      return firestore.collection('sessions').add({ name, meta: meta || null, created_at: new Date().toISOString() }).then(ref => ref.id);
    }
    const d = read();
    d._counters.sessions = (d._counters.sessions || 0) + 1;
    const id = d._counters.sessions;
    d.sessions.push({ id, name, meta: meta || null, created_at: new Date().toISOString() });
    write(d);
    return id;
  },
  getSessions: () => {
    if (firestore) {
      return firestore.collection('sessions').orderBy('created_at', 'desc').get().then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() }))).catch(e => []);
    }
    return read().sessions.slice().reverse();
  }
};

export default exportObj;