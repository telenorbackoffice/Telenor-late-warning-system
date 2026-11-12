import { getStore } from "@netlify/blobs";

const COLS = ["attendance", "emails", "warnings"];
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req) => {
  const store = getStore("late-login-portal");
  const load = async (k) => (await store.get(k, { type: "json" })) || {};

  // Anyone can read attendance
  if (req.method === "GET") {
    const [attendance, emails, warnings] = await Promise.all(COLS.map(load));
    return json({ attendance, emails, warnings });
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let b;
  try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  // Only Backoffice can write (checked on the server)
  const U = process.env.ADMIN_USER || "Backoffice";
  const P = process.env.ADMIN_PASS || "Backoffice";
  if (b.u !== U || b.p !== P) return json({ error: "auth" }, 401);

  if (b.op === "login") return json({ ok: true });

  if (b.op === "set") {
    if (!COLS.includes(b.col) || typeof b.items !== "object" || !b.items) return json({ error: "bad request" }, 400);
    const data = await load(b.col);
    Object.assign(data, b.items);
    await store.setJSON(b.col, data);
    return json({ ok: true });
  }
  return json({ error: "unknown op" }, 400);
};

export const config = { path: "/api" };
