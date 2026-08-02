/* ============================================================
   fixa — page behaviour

   Deliberately few decorative effects. One orchestrated load moment
   (the headline repairing itself), quiet scroll reveals, and a set of
   controls that actually do something: the mobile menu, the incident
   replay, the billing toggle, and copy-to-clipboard.

   Shared by index.html and login.html — every block checks for its own
   markup first, so either page can omit any of it.
   ============================================================ */

(function () {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  /* ---------- theme -------------------------------------- */

  let hero = null;

  function applyTheme(mode) {
    if (mode) root.setAttribute('data-theme', mode);
    else root.removeAttribute('data-theme');
    if (hero) {
      hero.refreshTheme();
      if (reduced.matches) hero.redraw();
    }
  }

  function currentTheme() {
    const set = root.getAttribute('data-theme');
    if (set) return set;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  const themebtn = $('#themebtn');
  if (themebtn) {
    themebtn.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem('fixa-theme', next); } catch (e) { /* private mode */ }
    });
  }

  /* the artifact host and the OS can both restamp data-theme — follow along */
  new MutationObserver(() => {
    if (hero) {
      hero.refreshTheme();
      if (reduced.matches) hero.redraw();
    }
  }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (hero) hero.refreshTheme();
  });

  /* ---------- hero canvas -------------------------------- */

  const canvas = $('#gl');
  if (canvas && window.FixaHero) {
    hero = window.FixaHero.init(canvas);
    if (hero) hero.start();     // stays on the CSS fallback if init returned null
  }

  /* ---------- headline: scrambled, then repaired ---------- */

  /* glyphs the headline resolves out of — kept to the monospace
     repertoire so character widths stay put while they settle */
  const POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  function pick() {
    return POOL[(Math.random() * POOL.length) | 0];
  }

  function buildHeadline() {
    const lines = $$('[data-scramble]');
    if (!lines.length) return;

    const cells = [];

    lines.forEach((line) => {
      const text = line.textContent.trim();
      const lineDelay = parseFloat(line.dataset.delay || '0');
      line.textContent = '';

      /* Per-character spans make every character its own break opportunity,
         which lets words split mid-word. So each word gets a nowrap wrapper,
         and a real space text node between words becomes the only place the
         line is allowed to break. */
      const words = text.split(/\s+/);
      let i = 0;

      words.forEach((word, wi) => {
        const wd = document.createElement('span');
        wd.className = 'wd';

        for (const ch of word) {
          const span = document.createElement('span');
          span.className = 'ch';
          span.textContent = ch;
          span.style.animationDelay = (lineDelay + i * 30) + 'ms';
          wd.appendChild(span);

          if (!reduced.matches) {
            cells.push({
              el: span,
              final: ch,
              until: lineDelay + i * 30 + 300 + Math.random() * 220
            });
          }
          i++;
        }

        line.appendChild(wd);
        if (wi < words.length - 1) {
          line.appendChild(document.createTextNode(' '));
          i++;
        }
      });
    });

    const headline = $('#headline');
    if (headline) headline.dataset.anim = 'in';
    if (reduced.matches || !cells.length) return;

    const t0 = performance.now();
    let last = 0;

    (function tick(now) {
      const t = now - t0;
      let pending = false;

      // re-roll glyphs on a slower beat than the frame rate, or it reads as mush
      const beat = now - last > 45;
      if (beat) last = now;

      for (const c of cells) {
        if (t >= c.until) {
          if (c.el.textContent !== c.final) c.el.textContent = c.final;
          continue;
        }
        pending = true;
        if (beat && t > c.until - 300) c.el.textContent = pick();
      }
      if (pending) requestAnimationFrame(tick);
    })(t0);
  }

  buildHeadline();

  /* ---------- scroll reveals ----------------------------- */

  const revealables = $$('.reveal');
  if (!('IntersectionObserver' in window) || reduced.matches) {
    revealables.forEach((el) => { el.dataset.seen = 'true'; });
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.dataset.seen = 'true';
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    revealables.forEach((el) => io.observe(el));
  }

  /* ---------- nav: stuck state + mobile menu ------------- */

  const nav = $('#nav');
  if (nav) {
    let ticking = false;
    const sync = () => {
      nav.dataset.stuck = String(window.scrollY > 24);
      ticking = false;
    };
    sync();
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(sync);
    }, { passive: true });
  }

  const menubtn = $('#menubtn');
  const menu = $('#mobilemenu');
  if (menubtn && menu) {
    const setMenu = (open) => {
      menubtn.setAttribute('aria-expanded', String(open));
      menubtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      menu.hidden = !open;
      if (nav) nav.dataset.open = String(open);
    };

    menubtn.addEventListener('click', () => {
      setMenu(menubtn.getAttribute('aria-expanded') !== 'true');
    });

    // any destination closes it, including the ones that only move the hash
    menu.addEventListener('click', (e) => {
      if (e.target.closest('a')) setMenu(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menubtn.getAttribute('aria-expanded') === 'true') {
        setMenu(false);
        menubtn.focus();
      }
    });

    // leaving the breakpoint must not strand an open menu with no button
    window.matchMedia('(min-width: 901px)').addEventListener('change', (e) => {
      if (e.matches) setMenu(false);
    });
  }

  /* ---------- nav scrollspy ------------------------------ */

  const spyLinks = $$('.nav__links a[href^="#"]');
  if (spyLinks.length && 'IntersectionObserver' in window) {
    const targets = spyLinks
      .map((a) => ({ a, el: document.getElementById(a.getAttribute('href').slice(1)) }))
      .filter((t) => t.el);

    const visible = new Set();
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) visible.add(en.target);
        else visible.delete(en.target);
      });
      // topmost visible section wins, so the mark never flickers between two
      let best = null;
      targets.forEach((t) => {
        if (!visible.has(t.el)) return;
        if (!best || t.el.getBoundingClientRect().top < best.el.getBoundingClientRect().top) best = t;
      });
      targets.forEach((t) => {
        if (best && t === best) t.a.setAttribute('aria-current', 'true');
        else t.a.removeAttribute('aria-current');
      });
    }, { rootMargin: '-20% 0px -55% 0px' });

    targets.forEach((t) => spy.observe(t.el));
  }

  /* ---------- live readouts ------------------------------ */
  /* small, plausible drift — an instrument that has stopped moving
     reads as a screenshot, and one that races reads as a fake. */

  if (!reduced.matches) {
    const el = (k) => $('[data-tick="' + k + '"]');
    const mttr = el('mttr'), fixedEl = el('fixed'), acc = el('acc');
    let fixedN = 1284;

    if (mttr || acc) {
      setInterval(() => {
        if (document.hidden) return;
        if (mttr) {
          const s = 252 + Math.round((Math.random() - 0.5) * 18);
          mttr.textContent = ((s / 60) | 0) + 'm ' + String(s % 60).padStart(2, '0') + 's';
        }
        if (acc) acc.textContent = (99.1 + Math.random() * 0.25).toFixed(1) + '%';
      }, 3200);
    }

    if (fixedEl) {
      setInterval(() => {
        if (document.hidden) return;
        if (Math.random() > 0.55) {
          fixedN += 1;
          fixedEl.textContent = fixedN.toLocaleString('en-US');
        }
      }, 5400);
    }
  }

  /* ---------- incident replay ---------------------------- */
  /* Steps carry the real offsets from the incident (0s to 252s) and
     play back at 28x, so the pacing between stages is the true one. */

  const player = $('#player');
  if (player) {
    const steps = $$('.log__l', player);
    const btn = $('#playBtn');
    const lbl = $('#playLbl');
    const fill = $('#playFill');
    const track = $('#playTrack');
    const clock = $('#playClock');
    const state = $('#playState');
    const diff = $('#playDiff');

    const SPAN = 252;          // seconds of incident time
    const RATE = 28;           // playback speed
    const DIFF_AT = 114;       // the PATCH step

    let raf = 0;
    let startedAt = 0;
    let offset = 0;            // incident seconds already played
    let mode = 'idle';         // idle | playing | paused | done

    const mmss = (sec) => {
      const s = Math.max(0, Math.min(SPAN, Math.round(sec)));
      return String((s / 60) | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    };

    function paint(sec) {
      let lastKey = null;
      steps.forEach((li) => {
        const on = sec >= parseFloat(li.dataset.at);
        li.dataset.on = String(on);
        if (!on) return;
        const k = $('.log__k', li);
        if (k) lastKey = k.textContent.trim();
      });

      if (diff) diff.dataset.open = String(sec >= DIFF_AT);

      const pct = (Math.min(sec, SPAN) / SPAN) * 100;
      if (fill) fill.style.width = pct + '%';
      if (clock) clock.textContent = mmss(sec);
      if (track) track.setAttribute('aria-valuenow', String(Math.round(Math.min(sec, SPAN))));

      if (state) {
        if (!lastKey) { state.dataset.state = 'idle'; state.textContent = 'STANDBY'; }
        else if (lastKey === 'SHIP') { state.dataset.state = 'done'; state.textContent = 'RESOLVED'; }
        else if (lastKey === 'DETECT' || lastKey === 'SCOPE') { state.dataset.state = 'fault'; state.textContent = 'FAULT'; }
        else { state.dataset.state = 'work'; state.textContent = 'REPAIRING'; }
      }
    }

    function setMode(next) {
      mode = next;
      if (btn) btn.dataset.mode = next;
      if (!lbl) return;
      lbl.textContent = next === 'playing' ? 'Pause'
        : next === 'done' ? 'Replay'
        : next === 'paused' ? 'Resume'
        : 'Play repair';
    }

    function frame(now) {
      const sec = offset + ((now - startedAt) / 1000) * RATE;
      if (sec >= SPAN) {
        offset = SPAN;
        paint(SPAN);
        setMode('done');
        raf = 0;
        return;
      }
      paint(sec);
      raf = requestAnimationFrame(frame);
    }

    function play() {
      if (mode === 'done') { offset = 0; paint(0); }
      if (mode === 'idle') offset = 0;
      startedAt = performance.now();
      setMode('playing');
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    }

    function pause() {
      cancelAnimationFrame(raf);
      raf = 0;
      offset = Math.min(SPAN, offset + ((performance.now() - startedAt) / 1000) * RATE);
      setMode(offset >= SPAN ? 'done' : 'paused');
    }

    function showAll() {
      offset = SPAN;
      paint(SPAN);
      setMode('done');
    }

    if (reduced.matches) {
      // no timed reveal to watch; the record is simply present
      showAll();
      if (btn) btn.addEventListener('click', showAll);
    } else {
      paint(-1);      // below the first step, so nothing is lit at rest
      if (btn) {
        btn.addEventListener('click', () => {
          if (mode === 'playing') pause();
          else play();
        });
      }

      // autoplay once when it first scrolls into view, then leave it alone
      if ('IntersectionObserver' in window) {
        const auto = new IntersectionObserver((entries) => {
          entries.forEach((en) => {
            if (!en.isIntersecting) return;
            auto.disconnect();
            if (mode === 'idle') play();
          });
        }, { threshold: 0.35 });
        auto.observe(player);
      }

      document.addEventListener('visibilitychange', () => {
        if (document.hidden && mode === 'playing') pause();
      });

      // "Watch a repair" should actually start it, not just jump the anchor
      $$('[data-play]').forEach((a) => {
        a.addEventListener('click', () => {
          offset = 0;
          setTimeout(play, 420);
        });
      });
    }
  }

  /* ---------- pricing: billing period -------------------- */

  const billingBtns = $$('[data-billing]');
  if (billingBtns.length) {
    const values = $$('.plan__v[data-monthly]');
    const notes = $$('[data-billing-note]');
    const fmt = new Intl.NumberFormat('en-US');

    function setBilling(period) {
      billingBtns.forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.billing === period));
      });
      values.forEach((v) => {
        const n = parseInt(v.dataset[period === 'annual' ? 'annual' : 'monthly'], 10);
        if (!isNaN(n)) v.textContent = fmt.format(n);
      });
      notes.forEach((n) => {
        n.textContent = period === 'annual' ? 'Per month, billed annually' : 'Billed monthly';
      });
    }

    billingBtns.forEach((b) => {
      b.addEventListener('click', () => setBilling(b.dataset.billing));
    });
    setBilling('monthly');
  }

  /* ---------- copy to clipboard -------------------------- */

  $$('[data-copy]').forEach((btn) => {
    const label = $('.copybtn__t', btn) || btn;
    const original = label.textContent;
    let revert = 0;

    btn.addEventListener('click', async () => {
      const text = btn.dataset.copy;
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch (e) {
        // the clipboard API needs a secure context; fall back to a selection
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
        document.body.removeChild(ta);
      }
      label.textContent = ok ? 'Copied' : 'Press ⌘C';
      btn.dataset.done = String(ok);
      clearTimeout(revert);
      revert = setTimeout(() => {
        label.textContent = original;
        btn.dataset.done = 'false';
      }, 1800);
    });
  });
})();
