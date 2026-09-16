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
const crypto = require("node:crypto");
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
`);

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
  sendJSON(res, 200, {
    votes: getVotes()
  });
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
      String(body.deviceId || "").trim();

    if (!name || (vote !== "Boy" && vote !== "Girl")) {
      sendJSON(res, 400, {
        error: "Please enter name and a valid vote",
        exists: false
      });
      return;
    }

    const deviceVotes = db
      .prepare("SELECT COUNT(*) AS c FROM votes WHERE device_id = ?")
      .get(deviceId || "anon");

    if (deviceVotes.c >= 10) {
      sendJSON(res, 429, {
        error: "Max 10 votes from this phone, thanks 💗",
        exists: true,
        left: 0
      });
      return;
    }

    const insert = db.prepare(
      "INSERT INTO votes (name, vote, device_id) VALUES (?, ?, ?)"
    );

    insert.run(
      name,
      vote,
      deviceId || ("dev-" + crypto.randomUUID())
    );

    sendJSON(res, 200, {
      ok: true,
      vote: { name: name, vote: vote },
      voteCount: getVotes().length
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