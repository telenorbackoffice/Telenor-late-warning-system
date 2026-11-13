import { getStore } from "@netlify/blobs";
import nodemailer from "nodemailer";

const db = () => getStore("late-portal");
const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });
const DAY = 864e5, ANCHOR = Date.UTC(2026, 9, 26); // pay periods: 14 days from 26 Oct 2026
const ts = d => { const [y, m, x] = d.split("-").map(Number); return Date.UTC(y, m - 1, x); };
const iso = t => new Date(t).toISOString().slice(0, 10);
const period = d => { const s = ANCHOR + Math.floor((ts(d) - ANCHOR) / (14 * DAY)) * 14 * DAY; return { start: iso(s), end: iso(s + 13 * DAY) }; };
// Late: 9:43 AM+ Mon-Sat (583 min), 10:43 AM+ Sunday (643 min)
const autoLate = (d, t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m >= (new Date(ts(d)).getUTCDay() === 0 ? 643 : 583); };
const isLate = (d, r) => (r.override === null || r.override === undefined) ? autoLate(d, r.time) : r.override;
const t12 = t => { let [h, m] = t.split(":").map(Number); const p = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${String(m).padStart(2, "0")} ${p}`; };
const dlabel = d => new Date(ts(d)).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const getJ = async (k, def) => (await db().get(k, { type: "json" })) ?? def;
const setJ = (k, v) => db().setJSON(k, v);
const authed = req => !!process.env.ADMIN_PASS && req.headers.get("x-user") === process.env.ADMIN_USER && req.headers.get("x-pass") === process.env.ADMIN_PASS;

async function periodLates(p) {
  const days = []; for (let t = ts(p.start); t <= ts(p.end); t += DAY) days.push(iso(t));
  const data = await Promise.all(days.map(d => getJ("att/" + d, [])));
  const out = {};
  days.forEach((d, i) => data[i].forEach(r => {
    if (!isLate(d, r)) return;
    (out[r.globalId] ??= { globalId: r.globalId, name: r.name, items: [] }).items.push({ date: d, location: r.location, storeId: r.storeId, time: r.time });
  }));
  return out;
}

const DEFAULT_TPL = {
  subject: "Late login warning: {periodStart} to {periodEnd}",
  body: "Hi {name},\n\nYou have {count} late login(s) in the current pay period ({periodStart} to {periodEnd}):\n\n{lateList}\n\n{consequence}\n\nRegards,\nBackoffice"
};

function build(tpl, e, p) {
  const n = e.items.length;
  const consequence = n >= 3
    ? "Because you now have 3 or more late logins in this pay period, half of this month's commission is forfeited under the late login policy."
    : "Please note: one more late login in this pay period will result in the loss of half of this month's commission.";
  const v = { name: e.name, count: n, periodStart: dlabel(p.start), periodEnd: dlabel(p.end), consequence };
  const textList = e.items.map(i => `- ${dlabel(i.date)} | ${i.location} (Store ${i.storeId}) | ${t12(i.time)}`).join("\n");
  const th = "style='border:1px solid #ccc;padding:6px 10px;text-align:left;background:#f0f0f0'", td = "style='border:1px solid #ccc;padding:6px 10px'";
  const htmlList = `<table style='border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px'><tr><th ${th}>Date</th><th ${th}>Location</th><th ${th}>Login time</th></tr>` +
    e.items.map(i => `<tr><td ${td}>${esc(dlabel(i.date))}</td><td ${td}>${esc(i.location)} (Store ${esc(i.storeId)})</td><td ${td}>${t12(i.time)}</td></tr>`).join("") + "</table>";
  const fill = (s, html) => s.replace(/\{(\w+)\}/g, (_, k) => k === "lateList" ? (html ? htmlList : textList) : (html ? esc(v[k]) : String(v[k] ?? "")));
  return { subject: fill(tpl.subject, false), text: fill(tpl.body, false), html: `<div style='font-family:Arial,sans-serif;font-size:14px'>${fill(tpl.body, true).replace(/\n/g, "<br>")}</div>` };
}

export default async (req) => {
  const path = new URL(req.url).pathname.replace(/^\/api\//, "");
  const q = new URL(req.url).searchParams;
  const admin = authed(req);
  const need = () => { if (!admin) throw Object.assign(new Error("Backoffice login required"), { status: 401 }); };
  try {
    const body = req.method === "POST" ? await req.json() : {};
    switch (path) {
      case "login":
        if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS) return J({ error: "ADMIN_USER / ADMIN_PASS are not set on the server. Add them in Netlify and redeploy." }, 500);
        if (!admin) return J({ error: "Username or password does not match ADMIN_USER / ADMIN_PASS in Netlify" }, 401);
        return J({ ok: true });

      case "dates": {
        const { blobs } = await db().list({ prefix: "att/" });
        return J(blobs.map(b => b.key.slice(4)).sort().reverse());
      }
      case "attendance": {
        const d = q.get("date");
        const rows = (await getJ("att/" + d, [])).map(r => ({ ...r, auto: autoLate(d, r.time), late: isLate(d, r) }));
        return J({ date: d, rows });
      }
      case "summary": {
        const p = period(q.get("date"));
        const lates = await periodLates(p);
        const emails = await getJ("emails", {});
        const warned = await getJ("warnings", {});
        const rows = Object.values(lates).map(e => ({
          ...e, count: e.items.length, hasEmail: !!emails[e.globalId]?.email, warned: warned[p.start + "|" + e.globalId] || null
        })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        return J({ ...p, rows });
      }

      case "upload": {
        need();
        const { date, rows } = body;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(rows)) return J({ error: "Bad upload" }, 400);
        const old = Object.fromEntries((await getJ("att/" + date, [])).map(r => [r.globalId, r.override ?? null]));
        const best = {};
        rows.forEach(r => {
          const g = String(r.globalId || "").trim(); if (!g || !r.time) return;
          if (!best[g] || r.time < best[g].time) best[g] = { storeId: String(r.storeId ?? ""), location: String(r.location ?? ""), name: String(r.name ?? "").trim(), globalId: g, time: r.time, override: old[g] ?? null };
        });
        const list = Object.values(best);
        await setJ("att/" + date, list);
        const emails = await getJ("emails", {});
        list.forEach(r => { emails[r.globalId] = { name: r.name || emails[r.globalId]?.name || "", email: emails[r.globalId]?.email || "" }; });
        await setJ("emails", emails);
        return J({ saved: list.length });
      }
      case "toggle": {
        need();
        const { date, globalId, late } = body;
        const list = await getJ("att/" + date, []);
        const r = list.find(x => x.globalId === globalId);
        if (!r) return J({ error: "Not found" }, 404);
        r.override = late === autoLate(date, r.time) ? null : late;
        await setJ("att/" + date, list);
        return J({ ok: true });
      }

      case "employees": {
        need();
        if (req.method === "POST") {
          const out = {};
          (body.list || []).forEach(e => {
            const g = String(e.globalId || "").trim(); if (!g) return;
            const email = String(e.email || "").trim();
            if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error("Invalid email for " + (e.name || g)), { status: 400 });
            out[g] = { name: String(e.name || "").trim(), email };
          });
          await setJ("emails", out);
          return J({ saved: Object.keys(out).length });
        }
        const emails = await getJ("emails", {});
        return J(Object.entries(emails).map(([globalId, v]) => ({ globalId, ...v })).sort((a, b) => a.name.localeCompare(b.name)));
      }
      case "settings": {
        need();
        if (req.method === "POST") { await setJ("settings", { subject: body.subject, body: body.body }); return J({ ok: true }); }
        return J({ ...(await getJ("settings", DEFAULT_TPL)), cc: process.env.CC_LIST || "jayp@paktelusa.com", from: process.env.GMAIL_USER || "(GMAIL_USER not set)" });
      }

      case "send-warning": {
        need();
        const p = period(body.date);
        const e = (await periodLates(p))[body.globalId];
        if (!e || e.items.length < 2) return J({ error: "Employee has fewer than 2 lates in this pay period" }, 400);
        const emails = await getJ("emails", {});
        const to = emails[body.globalId]?.email;
        if (!to) return J({ error: "No email on file for " + e.name }, 400);
        if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return J({ error: "GMAIL_USER / GMAIL_APP_PASSWORD not set in Netlify" }, 500);
        const m = build(await getJ("settings", DEFAULT_TPL), e, p);
        const tx = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
        await tx.sendMail({ from: `Telenor Backoffice <${process.env.GMAIL_USER}>`, to, cc: process.env.CC_LIST || "jayp@paktelusa.com", ...m });
        const warned = await getJ("warnings", {});
        warned[p.start + "|" + e.globalId] = { at: new Date().toISOString(), count: e.items.length, to };
        await setJ("warnings", warned);
        return J({ sent: true, to, count: e.items.length });
      }
    }
    return J({ error: "Not found" }, 404);
  } catch (err) {
    return J({ error: err.message }, err.status || 500);
  }
};
export const config = { path: "/api/*" };
