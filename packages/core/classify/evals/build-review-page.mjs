/**
 * Generates the golden-set review page from golden.json.
 *
 * The labels in the golden set are the product's judgment, and they are
 * currently one person's. This page exists so the founder can disagree with
 * them efficiently: 72 cases, keyboard-driven, with each verdict saved to the
 * artifact's own store so the corrections can be read straight back and folded
 * into `build-golden.mjs`.
 *
 *   node classify/evals/build-review-page.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const golden = JSON.parse(readFileSync(here("./golden.json"), "utf8"));

const cases = golden.cases.map((c, i) => ({
  n: i + 1,
  id: c.id,
  url: c.url,
  title: c.title,
  // Enough to judge without turning the page into a wall of text.
  body: c.body === null ? null : c.body.slice(0, 420),
  relevant: c.expect.relevant,
  intent: c.expect.intent,
  min: c.expect.minScore,
  max: c.expect.maxScore,
  note: c.note,
}));

const INTENTS = [
  "buying_intent",
  "competitor_complaint",
  "pain_point",
  "question",
  "none",
];

const DATA = JSON.stringify({ cases, profile: golden.profile, intents: INTENTS });

const html = `<title>Golden Set Review</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
  :root {
    --ground:#F4F6F7; --surface:#FFFFFF; --surface-2:#EDF1F3;
    --ink:#131A20; --ink-soft:#3D4A55; --muted:#5F6E7A; --faint:#8695A1;
    --line:#D9E0E5; --line-strong:#BFCAD2;
    --accent:#0E6E78; --accent-soft:#DCEEF0; --accent-ink:#0A545C;
    --ok:#2E7D53; --ok-soft:#E3F2E9; --warn:#9A6510; --crit:#B3352F; --crit-soft:#FBE9E8;
    --shadow:0 1px 2px rgba(19,26,32,.05), 0 8px 24px -12px rgba(19,26,32,.18);
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --ground:#0E1418; --surface:#151D23; --surface-2:#1B252C;
    --ink:#E4ECF1; --ink-soft:#C0CED8; --muted:#93A5B1; --faint:#71838F;
    --line:#26323A; --line-strong:#38474F;
    --accent:#45B5C0; --accent-soft:#13343A; --accent-ink:#7FD3DB;
    --ok:#5CBF88; --ok-soft:#12291D; --warn:#D9A441; --crit:#E8776F; --crit-soft:#2A1614;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 24px -12px rgba(0,0,0,.7);
  } }
  :root[data-theme="dark"] {
    --ground:#0E1418; --surface:#151D23; --surface-2:#1B252C;
    --ink:#E4ECF1; --ink-soft:#C0CED8; --muted:#93A5B1; --faint:#71838F;
    --line:#26323A; --line-strong:#38474F;
    --accent:#45B5C0; --accent-soft:#13343A; --accent-ink:#7FD3DB;
    --ok:#5CBF88; --ok-soft:#12291D; --warn:#D9A441; --crit:#E8776F; --crit-soft:#2A1614;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 24px -12px rgba(0,0,0,.7);
  }
  * { box-sizing:border-box; }
  body {
    background:var(--ground); color:var(--ink); line-height:1.55;
    font-family:"IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size:15px; -webkit-font-smoothing:antialiased;
  }
  h1,h2,h3 { font-family:"IBM Plex Sans Condensed","IBM Plex Sans",system-ui,sans-serif; font-weight:600; margin:0; text-wrap:balance; line-height:1.15; }
  code,.mono { font-family:"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace; }
  a { color:var(--accent); text-underline-offset:3px; }
  :focus-visible { outline:2px solid var(--accent); outline-offset:2px; border-radius:3px; }

  /* --- sticky command bar ------------------------------------------- */
  .bar { position:sticky; top:0; z-index:10; background:var(--surface); border-bottom:1px solid var(--line); }
  .bar-in { max-width:940px; margin:0 auto; padding:14px 20px 12px; }
  .bar-top { display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; }
  .bar h1 { font-size:19px; }
  .kicker { font-family:"IBM Plex Mono",monospace; font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); }
  .spacer { flex:1; }
  .counts { font-family:"IBM Plex Mono",monospace; font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; }
  .counts b { color:var(--ink); font-weight:600; }
  .track { height:4px; background:var(--surface-2); border-radius:2px; margin-top:10px; overflow:hidden; }
  .fill { height:100%; background:var(--accent); width:0%; transition:width .2s ease; }
  .tabs { display:flex; gap:6px; margin-top:11px; flex-wrap:wrap; }
  .tab {
    font-size:12.5px; padding:4px 11px; border-radius:20px; cursor:pointer;
    border:1px solid var(--line-strong); background:transparent; color:var(--muted);
    font-family:inherit;
  }
  .tab[aria-pressed="true"] { background:var(--accent); border-color:var(--accent); color:#fff; }
  .save-state { font-family:"IBM Plex Mono",monospace; font-size:11px; color:var(--faint); }

  /* --- list ---------------------------------------------------------- */
  main { max-width:940px; margin:0 auto; padding:22px 20px 120px; }
  .intro { color:var(--ink-soft); max-width:66ch; margin:0 0 22px; font-size:15px; }
  .intro b { color:var(--ink); }

  .card {
    background:var(--surface); border:1px solid var(--line); border-radius:8px;
    padding:16px 18px; margin-bottom:12px; scroll-margin-top:150px;
  }
  .card.cur { border-color:var(--accent); box-shadow:var(--shadow); }
  .card.done-agree { border-left:3px solid var(--ok); }
  .card.done-disagree { border-left:3px solid var(--crit); }

  .c-head { display:flex; align-items:baseline; gap:10px; margin-bottom:6px; flex-wrap:wrap; }
  .c-n { font-family:"IBM Plex Mono",monospace; font-size:11px; color:var(--faint); font-variant-numeric:tabular-nums; }
  .c-title { font-size:15.5px; font-weight:600; flex:1; min-width:220px; }
  .c-body { color:var(--ink-soft); font-size:14px; margin:6px 0 12px; max-width:72ch; }
  .c-body.empty { color:var(--faint); font-style:italic; }

  .verdict { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:9px; }
  .chip {
    font-family:"IBM Plex Mono",monospace; font-size:11px; padding:2px 8px;
    border-radius:4px; border:1px solid; white-space:nowrap;
  }
  .chip.lead { color:var(--ok); border-color:color-mix(in srgb,var(--ok) 45%,transparent); background:var(--ok-soft); }
  .chip.notlead { color:var(--muted); border-color:var(--line-strong); background:var(--surface-2); }
  .chip.plain { color:var(--accent-ink); border-color:color-mix(in srgb,var(--accent) 35%,transparent); background:var(--accent-soft); }

  .note { font-size:13.5px; color:var(--muted); border-left:2px solid var(--line-strong); padding-left:11px; margin-bottom:12px; max-width:70ch; }
  .note-label { font-family:"IBM Plex Mono",monospace; font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--faint); display:block; margin-bottom:2px; }

  .actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .btn {
    font-family:inherit; font-size:13.5px; font-weight:500; padding:6px 15px;
    border-radius:6px; border:1px solid var(--line-strong); background:var(--surface);
    color:var(--ink); cursor:pointer;
  }
  .btn:hover { border-color:var(--accent); color:var(--accent); }
  .btn.agree[aria-pressed="true"] { background:var(--ok); border-color:var(--ok); color:#fff; }
  .btn.disagree[aria-pressed="true"] { background:var(--crit); border-color:var(--crit); color:#fff; }
  .btn .k { font-family:"IBM Plex Mono",monospace; font-size:10.5px; opacity:.65; margin-left:6px; }

  .fix { margin-top:12px; padding:12px 14px; border-radius:6px; background:var(--crit-soft); border:1px solid color-mix(in srgb,var(--crit) 25%,transparent); }
  .fix-row { display:flex; gap:14px; align-items:center; flex-wrap:wrap; margin-bottom:9px; }
  .fix label { font-size:13px; color:var(--ink-soft); display:flex; gap:6px; align-items:center; }
  .fix select, .fix input[type=text] {
    font-family:inherit; font-size:13px; padding:4px 8px; border-radius:5px;
    border:1px solid var(--line-strong); background:var(--surface); color:var(--ink);
  }
  .fix input[type=text] { width:100%; }
  .fix .hint { font-size:12px; color:var(--muted); margin:0 0 8px; }

  .empty-state { text-align:center; color:var(--muted); padding:60px 20px; }

  /* --- footer summary ------------------------------------------------ */
  .done-panel { margin-top:28px; padding:20px 22px; border:1px solid var(--line); border-radius:8px; background:var(--surface); }
  .done-panel h2 { font-size:18px; margin-bottom:8px; }
  .done-panel p { color:var(--ink-soft); font-size:14.5px; max-width:66ch; }
  pre.summary {
    background:var(--surface-2); border:1px solid var(--line); border-radius:6px;
    padding:12px 14px; overflow-x:auto; font-size:12.5px; margin-top:12px; color:var(--ink-soft);
  }
  @media (prefers-reduced-motion:reduce) { * { transition:none !important; } }
</style>

<div class="bar">
  <div class="bar-in">
    <div class="bar-top">
      <span class="kicker">IntentOwl</span>
      <h1>Golden Set Review</h1>
      <span class="spacer"></span>
      <span class="counts" id="counts">—</span>
      <span class="save-state" id="save">local only</span>
    </div>
    <div class="track"><div class="fill" id="fill"></div></div>
    <div class="tabs" id="tabs">
      <button class="tab" data-f="todo" aria-pressed="true">Unreviewed</button>
      <button class="tab" data-f="all" aria-pressed="false">All</button>
      <button class="tab" data-f="lead" aria-pressed="false">Marked lead</button>
      <button class="tab" data-f="notlead" aria-pressed="false">Marked not</button>
      <button class="tab" data-f="disagree" aria-pressed="false">Your corrections</button>
    </div>
  </div>
</div>

<main>
  <p class="intro">
    I labelled these 72 real posts against the IntentOwl profile. <b>The labels are
    the product, and they are currently one opinion.</b> The classifier gets tuned
    until it agrees with them, so if a label is wrong we will tune toward a wrong
    target and the eval number will mean nothing.
    <br><br>
    Go fast. Most will be obvious. Press <code>a</code> to agree, <code>d</code> to
    disagree, <code>j</code>/<code>k</code> to move. Only the disagreements matter —
    everything is saved as you go.
  </p>
  <div id="list"></div>
  <div class="done-panel" id="donePanel" hidden>
    <h2>Review complete</h2>
    <p id="doneText"></p>
    <pre class="summary" id="doneSummary"></pre>
  </div>
</main>

<script>
const DATA = ${DATA};
const CASES = DATA.cases;
const INTENTS = DATA.intents;

let store = null;            // db namespace, once it resolves
let filter = "todo";
let cursor = 0;
const state = new Map();     // id -> {decision, relevant, intent, comment}

const $ = (s) => document.querySelector(s);
const listEl = $("#list");

// --- persistence -----------------------------------------------------------
// localStorage is the always-available floor; the artifact store is what lets
// the corrections be read back and folded into the golden set.
function loadLocal() {
  try {
    const raw = localStorage.getItem("golden-review");
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw))) state.set(k, v);
  } catch { /* private window, cleared data — render empty */ }
}
function saveLocal() {
  try {
    localStorage.setItem("golden-review", JSON.stringify(Object.fromEntries(state)));
  } catch { /* not fatal; the store below is the real record */ }
}

async function saveRemote(id, value) {
  if (store === null) return;
  try {
    $("#save").textContent = "saving…";
    await store.doc("reviews/" + id).set({ ...value, caseId: id, at: new Date().toISOString() });
    $("#save").textContent = "saved";
  } catch {
    $("#save").textContent = "save failed — kept locally";
  }
}

// --- rendering -------------------------------------------------------------
function visible() {
  return CASES.filter((c) => {
    const s = state.get(c.id);
    if (filter === "todo") return s === undefined;
    if (filter === "lead") return c.relevant;
    if (filter === "notlead") return !c.relevant;
    if (filter === "disagree") return s?.decision === "disagree";
    return true;
  });
}

function render() {
  const rows = visible();
  const reviewed = state.size;
  const disagreed = [...state.values()].filter((v) => v.decision === "disagree").length;

  $("#counts").innerHTML =
    "<b>" + reviewed + "</b>/" + CASES.length + " reviewed · <b>" + disagreed + "</b> corrections";
  $("#fill").style.width = (reviewed / CASES.length) * 100 + "%";

  $("#donePanel").hidden = reviewed < CASES.length;
  if (reviewed >= CASES.length) {
    const list = CASES.filter((c) => state.get(c.id)?.decision === "disagree");
    $("#doneText").textContent = list.length === 0
      ? "You agreed with every label. The golden set stands as it is."
      : "You corrected " + list.length + " of " + CASES.length + " labels. Tell Claude you are done and it will read them back and rebuild the golden set.";
    $("#doneSummary").textContent = list.length === 0 ? "(no corrections)" :
      list.map((c) => {
        const s = state.get(c.id);
        return "#" + c.n + "  " + (s.relevant ? "LEAD " : "not  ") + (s.intent || c.intent).padEnd(21) +
          "  " + c.title.slice(0, 48) + (s.comment ? "\\n     " + s.comment : "");
      }).join("\\n");
  }

  if (rows.length === 0) {
    listEl.innerHTML = '<div class="empty-state">Nothing here. Try another filter.</div>';
    return;
  }
  if (cursor >= rows.length) cursor = rows.length - 1;
  if (cursor < 0) cursor = 0;

  listEl.innerHTML = rows.map((c, i) => card(c, i === cursor)).join("");
  bind();
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

function card(c, isCur) {
  const s = state.get(c.id);
  const cls = ["card"];
  if (isCur) cls.push("cur");
  if (s?.decision === "agree") cls.push("done-agree");
  if (s?.decision === "disagree") cls.push("done-disagree");

  return '<article class="' + cls.join(" ") + '" id="c-' + c.id + '" data-id="' + c.id + '">' +
    '<div class="c-head">' +
      '<span class="c-n">#' + c.n + '</span>' +
      '<span class="c-title">' + esc(c.title) + '</span>' +
      '<a class="c-n" href="' + esc(c.url) + '" target="_blank" rel="noopener">open ↗</a>' +
    '</div>' +
    '<p class="c-body' + (c.body ? "" : " empty") + '">' + (c.body ? esc(c.body) : "(no body text)") + '</p>' +
    '<div class="verdict">' +
      '<span class="chip ' + (c.relevant ? "lead" : "notlead") + '">' + (c.relevant ? "LEAD" : "not a lead") + '</span>' +
      '<span class="chip plain">' + c.intent + '</span>' +
      '<span class="chip plain">score ' + c.min + "–" + c.max + '</span>' +
    '</div>' +
    '<div class="note"><span class="note-label">My reasoning</span>' + esc(c.note) + '</div>' +
    '<div class="actions">' +
      '<button class="btn agree" data-act="agree" aria-pressed="' + (s?.decision === "agree") + '">Agree<span class="k">a</span></button>' +
      '<button class="btn disagree" data-act="disagree" aria-pressed="' + (s?.decision === "disagree") + '">Disagree<span class="k">d</span></button>' +
    '</div>' +
    (s?.decision === "disagree" ? fixPanel(c, s) : "") +
  '</article>';
}

function fixPanel(c, s) {
  return '<div class="fix">' +
    '<p class="hint">What should it be? Leave anything you are unsure about as-is.</p>' +
    '<div class="fix-row">' +
      '<label><input type="checkbox" data-fix="relevant"' + (s.relevant ? " checked" : "") + '> Is a lead</label>' +
      '<label>Intent <select data-fix="intent">' +
        INTENTS.map((i) => '<option value="' + i + '"' + (i === (s.intent || c.intent) ? " selected" : "") + '>' + i + '</option>').join("") +
      '</select></label>' +
    '</div>' +
    '<input type="text" data-fix="comment" placeholder="Why? (optional, but the most useful part)" value="' + esc(s.comment || "") + '">' +
  '</div>';
}

// --- interaction -----------------------------------------------------------
function decide(id, decision) {
  const c = CASES.find((x) => x.id === id);
  const prev = state.get(id) || {};
  const value = {
    decision,
    // Seed the correction form with my label, so the reviewer only changes
    // what they actually disagree with.
    relevant: decision === "disagree" ? (prev.relevant ?? !c.relevant) : c.relevant,
    intent: prev.intent ?? c.intent,
    comment: prev.comment ?? "",
  };
  state.set(id, value);
  saveLocal();
  void saveRemote(id, value);
  if (decision === "agree" && filter !== "todo") cursor += 1;
  render();
}

function bind() {
  for (const btn of listEl.querySelectorAll("[data-act]")) {
    btn.addEventListener("click", (e) => {
      const id = e.target.closest("[data-id]").dataset.id;
      decide(id, e.target.closest("[data-act]").dataset.act);
    });
  }
  for (const el of listEl.querySelectorAll("[data-fix]")) {
    el.addEventListener("change", (e) => {
      const card = e.target.closest("[data-id]");
      const id = card.dataset.id;
      const value = { ...state.get(id) };
      const field = e.target.dataset.fix;
      value[field] = field === "relevant" ? e.target.checked : e.target.value;
      state.set(id, value);
      saveLocal();
      void saveRemote(id, value);
      $("#counts").dispatchEvent(new Event("x"));
    });
  }
}

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input,select,textarea")) return;
  const rows = visible();
  const c = rows[cursor];
  if (e.key === "j") { cursor += 1; render(); scrollToCur(); }
  else if (e.key === "k") { cursor -= 1; render(); scrollToCur(); }
  else if (e.key === "a" && c) { decide(c.id, "agree"); scrollToCur(); }
  else if (e.key === "d" && c) { decide(c.id, "disagree"); scrollToCur(); }
});

function scrollToCur() {
  const el = listEl.querySelector(".cur");
  if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
}

for (const tab of $("#tabs").querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    filter = tab.dataset.f;
    cursor = 0;
    for (const t of $("#tabs").querySelectorAll(".tab")) {
      t.setAttribute("aria-pressed", String(t === tab));
    }
    render();
  });
}

// --- boot ------------------------------------------------------------------
loadLocal();
render();

// The store arrives later, never during this first run. Render without it and
// light it up when it resolves.
claude.use("db").then(async (db) => {
  if (!db) return;
  store = db;
  $("#save").textContent = "synced";
  try {
    const snap = await db.collection("reviews").get();
    let merged = false;
    for (const doc of snap.docs) {
      const d = doc.data();
      if (d && !state.has(doc.id)) { state.set(doc.id, d); merged = true; }
    }
    if (merged) { saveLocal(); render(); }
  } catch {
    $("#save").textContent = "read failed — working locally";
  }
});
</script>
`;

writeFileSync(here("../../../../docs/label-review.html"), html);
console.log(`label-review.html written: ${cases.length} cases`);
