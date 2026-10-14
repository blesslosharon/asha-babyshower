/* =====================================================
   Baby Shower Server  (Node.js, zero dependencies)
   -----------------------------------------------------
   Run:  node server.js
   Open: http://localhost:3000

   Stores votes & baby announcement in SQLite.
   ===================================================== */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const PORT = process.env.PORT || 80;

/* ---------- database ---------- */

const db = new DatabaseSync(path.join(ROOT, "babyshower.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS votes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    vote       TEXT NOT NULL,
    device_id  TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS baby (
    id     INTEGER PRIMARY KEY CHECK (id = 1),
    name   TEXT NOT NULL,
    date   TEXT NOT NULL,
    time   TEXT NOT NULL,
    photo  TEXT DEFAULT '',
    gender TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

/* Reset generation — bumped on every admin reset so
   phones know to drop their cached votes (and NOT
   re-upload votes the admin deleted). */

function getGen() {
  const row = db
    .prepare("SELECT value FROM meta WHERE key = 'gen'")
    .get();
  return row ? Number(row.value) : 0;
}

function bumpGen() {
  const next = getGen() + 1;
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('gen', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(next));
  return next;
}

/* ---------- helpers ---------- */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2":"font/woff2"
};

function sendJSON(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(data));
}

function readBody(req, cb) {
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    try {
      cb(JSON.parse(raw || "{}"));
    } catch (err) {
      cb(null);
    }
  });
}

function staticFile(req, res) {
  let urlPath = decodeURIComponent(
    req.url.split("?")[0]
  );

  if (urlPath === "/") urlPath = "/index.html";

  const full = path.normalize(
    path.join(ROOT, urlPath)
  );

  if (!full.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(full)] ||
        "application/octet-stream",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(data);
  });
}

/* ---------- API handlers ---------- */

function getVotes() {
  return db
    .prepare("SELECT name, vote, device_id FROM votes ORDER BY id")
    .all();
}

function getBaby() {
  return db
    .prepare("SELECT name, date, time, photo, gender FROM baby WHERE id = 1")
    .get() || null;
}

function apiGetVotes(res) {
  const votes = getVotes();
  sendJSON(res, 200, {
    votes: votes,
    tally: tallyOf(votes),
    gen: getGen()
  });
}

function tallyOf(votes) {
  let boys = 0;
  let girls = 0;
  votes.forEach(function (v) {
    if (v.vote === "Boy") boys++;
    else if (v.vote === "Girl") girls++;
  });
  return { boys: boys, girls: girls };
}

function apiResetVotes(res) {
  db.prepare("DELETE FROM votes").run();
  const gen = bumpGen();
  sendJSON(res, 200, {
    ok: true,
    votes: [],
    tally: { boys: 0, girls: 0 },
    gen: gen
  });
}

const MAX_VOTES_PER_DEVICE = 10;

/* Insert a vote unless this device already cast the
   exact same name+vote (so re-syncing never duplicates). */
function addVote(device, name, vote) {
  const exists = db
    .prepare(
      "SELECT id FROM votes WHERE device_id = ? AND name = ? AND vote = ?"
    )
    .get(device, name, vote);

  if (exists) return { added: false };

  const count = db
    .prepare("SELECT COUNT(*) AS c FROM votes WHERE device_id = ?")
    .get(device).c;

  if (count >= MAX_VOTES_PER_DEVICE) {
    return { added: false, full: true };
  }

  db.prepare(
    "INSERT INTO votes (name, vote, device_id) VALUES (?, ?, ?)"
  ).run(name, vote, device);

  return { added: true };
}

function deviceCount(device) {
  return db
    .prepare("SELECT COUNT(*) AS c FROM votes WHERE device_id = ?")
    .get(device).c;
}

function apiPostVote(req, res) {
  readBody(req, (body) => {
    if (!body) {
      sendJSON(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const name =
      String(body.name || "").trim();
    const vote =
      String(body.vote || "").trim();
    const deviceId =
      String(body.deviceId || "").trim() || "anon";

    if (!name || (vote !== "Boy" && vote !== "Girl")) {
      sendJSON(res, 400, {
        error: "Please enter name and a valid vote",
        exists: false
      });
      return;
    }

    const result = addVote(deviceId, name, vote);

    if (!result.added && result.full) {
      sendJSON(res, 429, {
        error: "Max 10 votes from this phone, thanks 💗",
        exists: true,
        left: 0
      });
      return;
    }

    const votes = getVotes();

    sendJSON(res, 200, {
      ok: true,
      duplicate: !result.added,
      vote: { name: name, vote: vote },
      voteCount: votes.length,
      deviceCount: deviceCount(deviceId),
      tally: tallyOf(votes),
      gen: getGen()
    });
  });
}

/* Offline phones keep their own votes. When they come
   back online (or the server was wiped on a free host),
   they send their local votes here to restore them. */
function apiSyncVotes(req, res) {
  readBody(req, (body) => {
    if (!body || !Array.isArray(body.votes)) {
      sendJSON(res, 400, { error: "Invalid sync body" });
      return;
    }

    const device =
      String(body.deviceId || "").trim() || "anon";

    body.votes.forEach(function (v) {
      const name = String(v.name || "").trim();
      const vote = String(v.vote || "").trim();
      if (!name || (vote !== "Boy" && vote !== "Girl")) {
        return;
      }
      addVote(device, name, vote);
    });

    const votes = getVotes();

    sendJSON(res, 200, {
      ok: true,
      votes: votes,
      tally: tallyOf(votes),
      deviceCount: deviceCount(device),
      gen: getGen()
    });
  });
}

function apiGetBaby(res) {
  sendJSON(res, 200, {
    baby: getBaby()
  });
}

function apiPostBaby(req, res) {
  readBody(req, (body) => {
    if (!body) {
      sendJSON(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const name   = String(body.name || "").trim();
    const date   = String(body.date || "").trim();
    const time   = String(body.time || "").trim();
    const photo  = String(body.photo || "").trim();
    const gender = String(body.gender || "").trim();

    if (!name || !date || !time ||
        (gender !== "Boy" && gender !== "Girl")) {
      sendJSON(res, 400, { error: "Missing baby details" });
      return;
    }

    db.prepare(`
      INSERT INTO baby (id, name, date, time, photo, gender)
      VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        date = excluded.date,
        time = excluded.time,
        photo = excluded.photo,
        gender = excluded.gender
    `).run(name, date, time, photo, gender);

    sendJSON(res, 200, {
      ok: true,
      baby: getBaby()
    });
  });
}

function apiClearBaby(res) {
  db.prepare("DELETE FROM baby WHERE id = 1").run();
  sendJSON(res, 200, { ok: true, baby: null });
}

/* ---------- server ---------- */

const server = http.createServer((req, res) => {
  const method = req.method;
  const url = req.url || "/";

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  /* votes */
  if (url === "/api/votes" && method === "GET") {
    apiGetVotes(res);
    return;
  }

  if (url === "/api/vote" && method === "POST") {
    apiPostVote(req, res);
    return;
  }

  if (url === "/api/votes" && method === "DELETE") {
    apiResetVotes(res);
    return;
  }

  if (url === "/api/votes/sync" && method === "POST") {
    apiSyncVotes(req, res);
    return;
  }

  /* baby */
  if (url === "/api/baby" && method === "GET") {
    apiGetBaby(res);
    return;
  }

  if (url === "/api/baby" && method === "POST") {
    apiPostBaby(req, res);
    return;
  }

  if (url === "/api/baby" && method === "DELETE") {
    apiClearBaby(res);
    return;
  }

  /* everything else = static files */
  staticFile(req, res);
});

server.listen(PORT, () => {
  console.log("Baby Shower site running at:");
  console.log("  http://localhost:" + PORT);
});