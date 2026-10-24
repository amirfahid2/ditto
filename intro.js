// "What is this site? Click here" on dittotap.com: a square box in the middle of the screen that
// shows, step by step, what Ditto does — tap a square to copy, paste anywhere, make your own, and
// the iPhone app (and linking it). Loaded only when someone asks.
//   openIntro({ linked, onPhone, onLink })   linked: showing the iPhone's squares already;
//   onPhone: this is a phone (no linking a browser to itself); onLink(): "Use my iPhone's squares here"

const APP_STORE = "https://apps.apple.com/app/id6810430522";
const MOVE_MS = 700;

const CSS = `
.ix-back { position: fixed; inset: 0; z-index: 300; background: var(--scrim, rgba(22, 38, 46, .45));
  display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity .18s ease; }
.ix-back.on { opacity: 1; }
.ix-box { width: min(500px, calc(100vw - 32px), calc(100dvh - 32px)); aspect-ratio: 1; background: var(--sheet, #fff);
  color: var(--ink, #16262E); border-radius: 24px; box-shadow: 0 18px 60px rgba(0, 0, 0, .3); display: flex; flex-direction: column;
  padding: 14px 16px 14px; font-family: "IBM Plex Sans", system-ui, sans-serif; transform: scale(.97); transition: transform .18s ease; overflow: hidden; }
.ix-back.on .ix-box { transform: none; }
.ix-top { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--muted, #64808B); }
.ix-top b { font-family: "Archivo", sans-serif; font-size: 15px; color: var(--ink, #16262E); }
.ix-x { border: none; background: none; font-size: 22px; line-height: 1; color: var(--muted, #64808B); cursor: pointer; width: 32px; height: 32px; border-radius: 50%; }
.ix-stage { position: relative; flex: 1; min-height: 0; margin: 8px 0 10px; border-radius: 16px; background: var(--bg, #F2F5F6); overflow: hidden;
  display: flex; flex-direction: column; gap: 4%; padding: 4% 6%; }
.ix-board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; transition: opacity .3s ease; flex-shrink: 0; }
.ix-sq { aspect-ratio: 2; border-radius: 12px; background: var(--card, #fff); box-shadow: var(--shadow); display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 1px; font-family: "Archivo", sans-serif; font-weight: 600; font-size: clamp(9px, 2.6vw, 13px);
  text-align: center; transition: background .25s ease, transform .15s ease; position: relative; }
.ix-sq i { font-style: normal; font-size: 1.3em; line-height: 1; }
.ix-sq small { font-family: "IBM Plex Sans", sans-serif; font-weight: 500; font-size: .75em; opacity: .75; }
.ix-sq.amber { background: var(--c-amber, #C78A1C); color: #fff; }
.ix-sq.folder { background: var(--folder, #D6EAF6); }
.ix-sq.blank b { color: var(--muted, #64808B); letter-spacing: .1em; }
.ix-sq.plus { background: transparent; box-shadow: none; border: 1.5px dashed var(--line, #D5DFE3); color: var(--accent, #0E7C86); }
.ix-sq.flash { background: var(--flash, #B9DFF5); }
.ix-sq.press { transform: scale(.94); }
.ix-copied { position: absolute; left: 50%; top: 2%; transform: translate(-50%, -6px); background: var(--ink, #16262E); color: var(--bg, #fff);
  font-size: 11.5px; font-weight: 600; padding: 4px 10px; border-radius: 999px; opacity: 0; transition: opacity .2s ease, transform .2s ease; }
.ix-copied.on { opacity: 1; transform: translate(-50%, 0); }
.ix-msg { flex: 1; min-height: 3.4em; background: var(--card, #fff); border-radius: 12px; box-shadow: var(--shadow);
  padding: 8px 10px; font-size: clamp(10px, 2.7vw, 13px); transition: opacity .3s ease, outline-color .2s ease; outline: 2px solid transparent; }
.ix-msg.focus { outline-color: var(--accent, #0E7C86); }
.ix-msg-to { color: var(--muted, #64808B); border-bottom: 1px solid var(--line, #D5DFE3); padding-bottom: 4px; margin-bottom: 5px; }
.ix-msg-text { white-space: pre-wrap; line-height: 1.4; }
.ix-caret { display: inline-block; width: 1.5px; height: 1.1em; background: var(--accent, #0E7C86); vertical-align: text-bottom; animation: ix-blink 1s steps(1) infinite; }
@keyframes ix-blink { 50% { opacity: 0; } }
.ix-edit { position: absolute; left: 14%; right: 14%; top: 14%; background: var(--sheet, #fff); border-radius: 14px; box-shadow: 0 10px 30px rgba(0, 0, 0, .25);
  padding: 9px 11px 10px; font-size: clamp(9.5px, 2.5vw, 12px); opacity: 0; transform: scale(.94); transition: opacity .2s ease, transform .2s ease; pointer-events: none; }
.ix-edit.on { opacity: 1; transform: none; }
.ix-edit-head { display: flex; justify-content: space-between; align-items: center; font-family: "Archivo", sans-serif; font-weight: 700; margin-bottom: 6px; }
.ix-done { background: var(--accent, #0E7C86); color: var(--accent-ink, #fff); border-radius: 999px; padding: 2px 9px; font-family: "IBM Plex Sans", sans-serif; font-weight: 600; }
.ix-done.press { transform: scale(.92); display: inline-block; }
.ix-field { color: var(--muted, #64808B); font-size: .85em; text-transform: uppercase; letter-spacing: .05em; margin-top: 4px; }
.ix-input { background: var(--field, #F2F5F6); border: 1px solid var(--line, #D5DFE3); border-radius: 7px; padding: 3px 6px; min-height: 1.4em; color: var(--ink, #16262E); }
.ix-phone { position: absolute; left: 50%; top: 6%; height: 88%; aspect-ratio: .5; box-sizing: border-box; transform: translateX(-50%);
  border: 2.5px solid var(--ink, #16262E); border-radius: 22px; background: var(--bg, #F2F5F6); opacity: 0; transition: opacity .3s ease;
  padding: 16px 8px 0; display: flex; flex-direction: column; overflow: hidden; }
.ix-phone.on { opacity: 1; }
.ix-phone-board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5%; }
.ix-phone-board span { aspect-ratio: 1; border-radius: 6px; background: var(--card, #fff); box-shadow: var(--shadow); font: 600 7px "Archivo", sans-serif;
  display: flex; align-items: center; justify-content: center; text-align: center; }
.ix-phone-board span.c { background: var(--c-teal, #0D7D87); color: #fff; }
.ix-phone-board span.a { background: var(--c-amber, #C78A1C); color: #fff; }
.ix-kb { margin: auto -8px 0; background: var(--card, #fff); border-top: 1px solid var(--line, #D5DFE3); border-radius: 0 0 19px 19px; padding: 7% 6% 9%;
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 4%; }
.ix-kb span { height: 16px; border-radius: 5px; background: var(--folder, #D6EAF6); font: 600 6px "Archivo", sans-serif; display: flex; align-items: center; justify-content: center; }
.ix-kb-label { grid-column: 1 / -1; font: 500 7px "IBM Plex Sans", sans-serif; color: var(--muted, #64808B); text-align: center; }
.ix-finger { position: absolute; left: 0; top: 0; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; background: rgba(14, 124, 134, .35);
  border: 2px solid var(--accent, #0E7C86); transition: transform ${MOVE_MS}ms cubic-bezier(.45, .05, .3, 1), opacity .2s ease; pointer-events: none; z-index: 5; }
.ix-finger::after { content: ""; position: absolute; inset: -2px; border-radius: 50%; border: 2px solid var(--accent, #0E7C86); opacity: 0; }
.ix-finger.tap::after { animation: ix-ripple .45s ease-out; }
.ix-finger.hold::after { animation: ix-ripple .9s ease-out; }
@keyframes ix-ripple { from { opacity: .9; transform: scale(1); } to { opacity: 0; transform: scale(2.4); } }
.ix-title { font-family: "Archivo", sans-serif; font-weight: 700; font-size: clamp(15px, 4vw, 18px); margin: 0 0 3px; }
.ix-text { font-size: clamp(12px, 3.3vw, 14px); line-height: 1.45; color: var(--muted, #64808B); margin: 0; min-height: 3.2em; }
.ix-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.ix-actions a, .ix-actions button { font: 600 13px "IBM Plex Sans", system-ui, sans-serif; border-radius: 999px; padding: 7px 13px; cursor: pointer; text-decoration: none;
  border: 1.5px solid var(--accent, #0E7C86); color: var(--accent, #0E7C86); background: transparent; }
.ix-actions .primary { background: var(--accent, #0E7C86); color: var(--accent-ink, #fff); }
.ix-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
.ix-dots { display: flex; gap: 6px; }
.ix-dots button { width: 8px; height: 8px; border-radius: 50%; border: none; padding: 0; background: var(--line, #D5DFE3); cursor: pointer; }
.ix-dots button.on { background: var(--accent, #0E7C86); }
.ix-nav { display: flex; gap: 8px; }
.ix-nav button { font: 600 14px "IBM Plex Sans", system-ui, sans-serif; border-radius: 999px; padding: 7px 15px; cursor: pointer; border: none; }
.ix-prev { background: var(--field, #F2F5F6); color: var(--ink, #16262E); }
.ix-next { background: var(--accent, #0E7C86); color: var(--accent-ink, #fff); }
.ix-box button:focus-visible, .ix-box a:focus-visible { outline: 2px solid var(--accent, #0E7C86); outline-offset: 2px; }
@media (max-width: 480px) { .ix-box { aspect-ratio: 4 / 5; width: min(calc(100vw - 24px), calc((100dvh - 24px) * .8)); } }
@media (prefers-reduced-motion: reduce) { .ix-finger { display: none; } .ix-back, .ix-box, .ix-edit, .ix-copied { transition: none; } }
`;

let styled = false;

export function openIntro(opts = {}) {
  if (document.querySelector(".ix-back")) return;
  if (!styled) {
    const st = document.createElement("style");
    st.textContent = CSS;
    document.head.append(st);
    styled = true;
  }
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const opener = document.activeElement;
  const back = el("div", "ix-back");
  back.innerHTML = `
    <div class="ix-box" role="dialog" aria-modal="true" aria-labelledby="ixTitle">
      <div class="ix-top"><span><b>What is Ditto?</b> · <span class="ix-count"></span></span>
        <button type="button" class="ix-x" aria-label="Close">&times;</button></div>
      <div class="ix-stage" aria-hidden="true">
        <div class="ix-board">
          <div class="ix-sq" data-k="address"><b>Address</b></div>
          <div class="ix-sq amber"><i>⏰</i><b>Running late</b></div>
          <div class="ix-sq"><b>Thanks!</b></div>
          <div class="ix-sq folder"><b>Clinic</b><small>3 texts ▾</small></div>
          <div class="ix-sq blank" data-k="blank"><b>…</b></div>
          <div class="ix-sq plus"><b>+</b></div>
        </div>
        <div class="ix-copied">Copied</div>
        <div class="ix-msg"><div class="ix-msg-to">To: Sam</div><div class="ix-msg-text"></div></div>
        <div class="ix-edit">
          <div class="ix-edit-head"><span>Set up square</span><span class="ix-done">Done</span></div>
          <div class="ix-field">Name on the square</div><div class="ix-input" data-k="name"></div>
          <div class="ix-field">Text to copy</div><div class="ix-input" data-k="text"></div>
        </div>
        <div class="ix-phone">
          <div class="ix-phone-board"><span class="c">Address</span><span class="a">Late</span><span>Thanks!</span><span>Clinic</span><span>Zoom</span><span>…</span></div>
          <div class="ix-kb"><div class="ix-kb-label">Ditto keyboard, in any app</div><span>Address</span><span>Late</span><span>Thanks!</span><span>Zoom</span></div>
        </div>
        <div class="ix-finger"></div>
      </div>
      <h2 class="ix-title" id="ixTitle"></h2>
      <p class="ix-text"></p>
      <div class="ix-actions" hidden></div>
      <div class="ix-foot"><div class="ix-dots"></div>
        <div class="ix-nav"><button type="button" class="ix-prev">Back</button><button type="button" class="ix-next">Next</button></div></div>
    </div>`;
  document.body.append(back);
  const $ = (sel) => back.querySelector(sel);
  const stage = $(".ix-stage"), finger = $(".ix-finger"), board = $(".ix-board"), msg = $(".ix-msg");
  const msgText = $(".ix-msg-text"), copied = $(".ix-copied"), edit = $(".ix-edit"), phone = $(".ix-phone");
  const address = $('[data-k="address"]'), blank = $('[data-k="blank"]');
  const nameIn = $('[data-k="name"]'), textIn = $('[data-k="text"]'), done = $(".ix-done");
  const ADDRESS = "742 Evergreen Terrace, Springfield";

  let step = 0, timers = [], auto = !calm;
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  const stop = () => { timers.forEach(clearTimeout); timers = []; };

  function at(target, dx = 0.5, dy = 0.5) {
    const s = stage.getBoundingClientRect(), r = target.getBoundingClientRect();
    finger.style.transform = `translate(${r.left - s.left + r.width * dx}px, ${r.top - s.top + r.height * dy}px)`;
  }
  function rest() { const s = stage.getBoundingClientRect(); finger.style.transform = `translate(${s.width * 0.88}px, ${s.height * 0.62}px)`; }
  function tap(target, cls = "tap") {
    finger.classList.remove("tap", "hold"); void finger.offsetWidth; finger.classList.add(cls);
    if (target) { target.classList.add("press"); later(160, () => target.classList.remove("press")); }
  }
  function type(into, text, ms, then) {
    let i = 0;
    const caret = el("span", "ix-caret");
    into.textContent = ""; into.append(caret);
    const tick = () => {
      if (i >= text.length) { if (then) then(); return; }
      caret.before(text[i++]);
      later(ms, tick);
    };
    tick();
  }
  function scene(name) {
    // what each step starts from (and, with reduced motion, simply shows)
    board.style.opacity = name === "phone" ? 0 : 1;
    msg.style.opacity = name === "phone" ? 0 : 1;
    phone.classList.toggle("on", name === "phone");
    finger.style.opacity = name === "phone" || calm ? 0 : 1;
    copied.classList.remove("on");
    edit.classList.remove("on");
    msg.classList.remove("focus");
    address.classList.remove("flash");
    if (name !== "make" && name !== "phone") { blank.innerHTML = "<b>…</b>"; blank.classList.add("blank"); }
    if (name === "copy") msgText.textContent = "";
  }

  const STEPS = [
    {
      title: "A board of squares that copy text",
      text: "Each square holds something you type a lot: an address, a reply, a link. Tap a square and its text is copied.",
      play() {
        scene("copy");
        if (calm) { address.classList.add("flash"); copied.classList.add("on"); return; }
        rest();
        later(300, () => at(address));
        later(300 + MOVE_MS, () => { tap(address); address.classList.add("flash"); copied.classList.add("on"); });
        later(300 + MOVE_MS + 700, () => address.classList.remove("flash"));
        return 300 + MOVE_MS + 1600;
      },
    },
    {
      title: "Paste it anywhere",
      text: "Paste into an email, a chat or a form, on any website or app. No retyping.",
      play() {
        scene("paste");
        if (calm) { msg.classList.add("focus"); msgText.textContent = ADDRESS; return; }
        msgText.textContent = "";
        at(address);
        later(200, () => at(msg, 0.3, 0.62));
        later(200 + MOVE_MS, () => { tap(null); msg.classList.add("focus"); type(msgText, ADDRESS, 28); });
        return 200 + MOVE_MS + ADDRESS.length * 28 + 1500;
      },
    },
    {
      title: "Make your own",
      text: "Tap an empty “…” square, or press and hold any square, to give it a name and the text it copies. Then tap Done. Folders keep related texts together.",
      play() {
        scene("make");
        blank.innerHTML = "<b>…</b>"; blank.classList.add("blank");
        if (calm) { nameIn.textContent = "Zoom"; textIn.textContent = "https://zoom.us/j/5551234"; edit.classList.add("on"); return; }
        nameIn.textContent = ""; textIn.textContent = "";
        rest();
        later(200, () => at(blank));
        later(200 + MOVE_MS, () => tap(blank));
        later(200 + MOVE_MS + 350, () => edit.classList.add("on"));
        later(200 + MOVE_MS + 650, () => { at(nameIn, 0.25); type(nameIn, "Zoom", 90, () => {
          at(textIn, 0.25);
          later(MOVE_MS, () => type(textIn, "https://zoom.us/j/5551234", 35, () => {
            at(done);
            later(MOVE_MS, () => {
              tap(done); done.classList.add("press");
              later(200, () => { done.classList.remove("press"); edit.classList.remove("on");
                blank.classList.remove("blank"); blank.innerHTML = "<b>Zoom</b>"; blank.classList.add("flash");
                later(500, () => blank.classList.remove("flash")); });
            });
          }));
        }); });
        return 200 + MOVE_MS + 650 + 4 * 90 + MOVE_MS + 25 * 35 + MOVE_MS + 2200;
      },
    },
    {
      title: "Your squares on your iPhone, too",
      text: opts.linked
        ? "You're using your iPhone's squares here. Ditto for iPhone adds a keyboard, so every square is one tap away in any app."
        : "Ditto for iPhone has the same board plus a keyboard, so every square is one tap away in any app. Link this browser and your iPhone's squares show up here. No account needed: your squares stay on your devices.",
      play() { scene("phone"); return 0; },
      actions() {
        const out = [];
        if (!opts.linked && !opts.onPhone && opts.onLink) {
          const b = el("button", "primary"); b.type = "button"; b.textContent = "Use my iPhone's squares here";
          b.addEventListener("click", () => { close(); opts.onLink(); });
          out.push(b);
        }
        const a = el("a", out.length ? "" : "primary"); a.href = APP_STORE; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Get Ditto for iPhone";
        out.push(a);
        return out;
      },
    },
  ];

  const dots = STEPS.map((s, i) => {
    const d = el("button"); d.type = "button"; d.setAttribute("aria-label", `Step ${i + 1}: ${s.title}`);
    d.addEventListener("click", () => { auto = false; go(i); });
    $(".ix-dots").append(d);
    return d;
  });

  function go(i) {
    stop();
    step = Math.max(0, Math.min(STEPS.length - 1, i));
    const S = STEPS[step];
    $(".ix-count").textContent = `${step + 1} of ${STEPS.length}`;
    $(".ix-title").textContent = S.title;
    $(".ix-text").textContent = S.text;
    const acts = $(".ix-actions");
    acts.textContent = "";
    const list = S.actions ? S.actions() : [];
    list.forEach((n) => acts.append(n));
    acts.hidden = !list.length;
    dots.forEach((d, j) => d.classList.toggle("on", j === step));
    $(".ix-prev").style.visibility = step ? "visible" : "hidden";
    $(".ix-next").textContent = step === STEPS.length - 1 ? "Start using Ditto" : "Next";
    const length = S.play();
    // plays through on its own; any click on the controls hands over to the person
    if (auto && length && step < STEPS.length - 1) later(length, () => go(step + 1));
  }

  function close() {
    stop();
    document.removeEventListener("keydown", onKey);
    back.classList.remove("on");
    setTimeout(() => back.remove(), 200);
    if (opener && opener.focus) opener.focus();
  }
  function onKey(e) {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") { auto = false; go(step + 1); }
    else if (e.key === "ArrowLeft") { auto = false; go(step - 1); }
  }

  $(".ix-x").addEventListener("click", close);
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  $(".ix-prev").addEventListener("click", () => { auto = false; go(step - 1); });
  $(".ix-next").addEventListener("click", () => { if (step === STEPS.length - 1) close(); else { auto = false; go(step + 1); } });
  document.addEventListener("keydown", onKey);

  finger.style.transition = "none";             // the finger starts at rest, not sliding in from a corner
  rest();
  void back.offsetWidth;                        // (and the fade-in starts from the hidden state)
  finger.style.transition = "";
  back.classList.add("on");
  $(".ix-next").focus();
  go(0);
}

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}
