/* ============================================================
   fixa — waitlist

   Sign-in is closed while we're at capacity, so every identity
   provider on this page is deliberately disabled. The waitlist is
   the one live control: it validates, assigns a queue position and
   persists locally, so returning to the page shows your place again.

   There is no server here. Submissions are kept in localStorage
   under 'fixa-waitlist' — swap saveEntry() for a fetch() when a
   backend exists.
   ============================================================ */

(function () {
  'use strict';

  const form = document.getElementById('waitlist');
  if (!form) return;

  const done = document.getElementById('waitlistDone');
  const msg = document.getElementById('waitlistMsg');
  const rec = document.getElementById('waitlistRec');
  const editBtn = document.getElementById('waitlistEdit');

  const KEY = 'fixa-waitlist';
  const QUEUE_BASE = 213;   // teams already ahead in the current cohort

  const email = document.getElementById('wl-email');
  const company = document.getElementById('wl-company');
  const services = document.getElementById('wl-svc');

  /* ---------- validation --------------------------------- */

  /* deliberately permissive: something@something.tld with no spaces.
     Anything stricter rejects addresses that are actually valid. */
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const FREE_MAIL = [
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
    'icloud.com', 'proton.me', 'naver.com', 'daum.net'
  ];

  function setError(input, text) {
    const box = document.getElementById(input.id + '-err');
    if (text) {
      input.setAttribute('aria-invalid', 'true');
      if (box) { box.textContent = text; box.hidden = false; }
    } else {
      input.removeAttribute('aria-invalid');
      if (box) { box.textContent = ''; box.hidden = true; }
    }
    return !text;
  }

  function checkEmail() {
    const v = email.value.trim();
    if (!v) return setError(email, 'Enter an email address.');
    if (!EMAIL.test(v)) return setError(email, "That doesn't look like an email address.");
    const domain = v.split('@')[1].toLowerCase();
    if (FREE_MAIL.indexOf(domain) !== -1) {
      return setError(email, 'Please use your work address — we match it to your company.');
    }
    return setError(email, '');
  }

  function checkCompany() {
    const v = company.value.trim();
    if (v.length < 2) return setError(company, 'Enter your company name.');
    return setError(company, '');
  }

  // validate on the way out of a field, then live once it has been flagged
  email.addEventListener('blur', checkEmail);
  company.addEventListener('blur', checkCompany);
  email.addEventListener('input', () => {
    if (email.getAttribute('aria-invalid') === 'true') checkEmail();
  });
  company.addEventListener('input', () => {
    if (company.getAttribute('aria-invalid') === 'true') checkCompany();
  });

  /* ---------- storage ------------------------------------ */

  function loadEntry() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveEntry(entry) {
    try { localStorage.setItem(KEY, JSON.stringify(entry)); } catch (e) { /* private mode */ }
  }

  /* A stable position from the address, so the same email always sees
     the same place rather than a number that moves on every reload. */
  function positionFor(addr) {
    let h = 0;
    for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0;
    return QUEUE_BASE + (h % 74);
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  /* ---------- rendering ---------------------------------- */

  function row(dt, dd) {
    const div = document.createElement('div');
    const k = document.createElement('dt');
    const v = document.createElement('dd');
    k.textContent = dt;
    v.textContent = dd;
    div.append(k, v);
    return div;
  }

  function showDone(entry) {
    if (msg) {
      msg.textContent =
        'You are number ' + entry.position + ' in the queue. We work through the list ' +
        'weekly and will email ' + entry.email + ' when a place opens. No other mail.';
    }
    if (rec) {
      rec.replaceChildren(
        row('Email', entry.email),
        row('Company', entry.company),
        row('Services', entry.services),
        row('Position', '#' + entry.position),
        row('Joined', fmtDate(entry.joined))
      );
    }
    form.hidden = true;
    if (done) {
      done.hidden = false;
      // move focus so the change is announced rather than silently swapped
      done.setAttribute('tabindex', '-1');
      done.focus({ preventScroll: true });
    }
  }

  function showForm() {
    if (done) done.hidden = true;
    form.hidden = false;
    email.focus();
  }

  /* ---------- wire up ------------------------------------ */

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const okEmail = checkEmail();
    const okCompany = checkCompany();
    if (!okEmail || !okCompany) {
      (okEmail ? company : email).focus();
      return;
    }

    const addr = email.value.trim().toLowerCase();
    const entry = {
      email: addr,
      company: company.value.trim(),
      services: services.options[services.selectedIndex].text,
      position: positionFor(addr),
      joined: new Date().toISOString()
    };
    saveEntry(entry);
    showDone(entry);
  });

  if (editBtn) {
    editBtn.addEventListener('click', () => {
      try { localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
      email.value = '';
      company.value = '';
      setError(email, '');
      setError(company, '');
      showForm();
    });
  }

  const existing = loadEntry();
  if (existing && existing.email) showDone(existing);
})();
