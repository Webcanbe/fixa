/* ============================================================
   fixa — page behaviour
   Deliberately few effects. One orchestrated load moment (the
   headline repairing itself), quiet scroll reveals, and readouts
   that actually move because the product claims to be live.
   ============================================================ */

(function () {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;

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

  const themebtn = document.getElementById('themebtn');
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

  const canvas = document.getElementById('gl');
  if (canvas && window.FixaHero) {
    hero = window.FixaHero.init(canvas);
    if (hero) hero.start();     // stays on the CSS fallback if init returned null
  }

  /* ---------- headline: scrambled, then repaired ---------- */

  /* the scramble draws on fixa's own vocabulary rather than noise */
  const HANGUL = '복구감지재현검증배포장애신호패치롤백지연원인';
  const LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  function isHangul(ch) {
    const c = ch.charCodeAt(0);
    return c >= 0xac00 && c <= 0xd7a3;
  }

  function pick(pool) {
    return pool[(Math.random() * pool.length) | 0];
  }

  function buildHeadline() {
    const lines = document.querySelectorAll('[data-scramble]');
    if (!lines.length) return;

    const cells = [];

    lines.forEach((line) => {
      const text = line.textContent.trim();
      const lineDelay = parseFloat(line.dataset.delay || '0');
      line.textContent = '';

      /* Per-character spans make every character its own break opportunity,
         which lets Korean words split mid-word. So each word gets a nowrap
         wrapper, and a real space text node between words becomes the only
         place the line is allowed to break. */
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
              pool: isHangul(ch) ? HANGUL : LATIN,
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

    const headline = document.getElementById('headline');
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
        if (beat && t > c.until - 300) c.el.textContent = pick(c.pool);
      }
      if (pending) requestAnimationFrame(tick);
    })(t0);
  }

  buildHeadline();

  /* ---------- scroll reveals ----------------------------- */

  const revealables = document.querySelectorAll('.reveal');
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

  /* ---------- nav ---------------------------------------- */

  const nav = document.getElementById('nav');
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

  /* ---------- live readouts ------------------------------ */
  /* small, plausible drift — an instrument that has stopped moving
     reads as a screenshot, and one that races reads as a fake. */

  if (!reduced.matches) {
    const el = (k) => document.querySelector('[data-tick="' + k + '"]');
    const mttr = el('mttr'), fixedEl = el('fixed'), acc = el('acc');
    let fixedN = 1284;

    setInterval(() => {
      if (document.hidden) return;
      if (mttr) {
        const s = 240 + Math.round((Math.random() - 0.5) * 18);
        mttr.textContent =
          String((s / 60) | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
      }
      if (acc) acc.textContent = (99.1 + Math.random() * 0.25).toFixed(1) + '%';
    }, 3200);

    setInterval(() => {
      if (document.hidden || !fixedEl) return;
      if (Math.random() > 0.55) {
        fixedN += 1;
        fixedEl.textContent = fixedN.toLocaleString('ko-KR');
      }
    }, 5400);
  }

  /* ---------- incident log: lines land in sequence -------- */

  const log = document.querySelector('[data-type]');
  if (log) {
    const html = log.innerHTML.replace(/^\n/, '').replace(/\n$/, '');
    const rows = html.split('\n');
    /* joined with no separator: .logln is display:block, so stray
       newline text nodes inside <pre> would double the leading */
    log.innerHTML = rows
      .map((r) => '<span class="logln">' + (r || '&nbsp;') + '</span>')
      .join('');

    const lines = log.querySelectorAll('.logln');
    if (reduced.matches || !('IntersectionObserver' in window)) {
      lines.forEach((l) => { l.style.opacity = '1'; });
    } else {
      lines.forEach((l) => {
        l.style.opacity = '0';
        l.style.transform = 'translateX(-6px)';
        l.style.transition = 'opacity .4s ease, transform .4s ease';
      });
      const io2 = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          lines.forEach((l, i) => {
            setTimeout(() => {
              l.style.opacity = '1';
              l.style.transform = 'none';
            }, 90 + i * 140);
          });
          io2.disconnect();
        });
      }, { threshold: 0.25 });
      io2.observe(log);
    }
  }
})();
