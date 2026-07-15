// Shared scroll-fade observer for sub-pages
(function () {
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.tk-fade-up').forEach((el) => el.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -10% 0px' });
  document.querySelectorAll('.tk-fade-up').forEach((el) => io.observe(el));
})();

// === Lead nudge toast ===
// Fires 3s after page load on conversion-relevant pages.
// Respects: 7-day dismissal cooldown, deep-scroll, excluded paths, reduced motion.
(function () {
  const SKIP_PATHS = [/^\/onboarding(\/|$)/, /^\/thank-you(\/|$)/, /^\/legal\//];
  const path = window.location.pathname;
  if (SKIP_PATHS.some((rx) => rx.test(path))) return;

  const isFR = /^\/fr(\/|$)/.test(path);
  const STORAGE_KEY = 'tk-toast-dismissed';
  const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
  try {
    const stored = parseInt(localStorage.getItem(STORAGE_KEY), 10);
    if (stored && Date.now() - stored < COOLDOWN_MS) return;
  } catch (e) { /* localStorage unavailable; continue */ }

  function scrolledDeep() {
    const total = document.documentElement.scrollHeight;
    const seen = window.scrollY + window.innerHeight;
    return total > 0 && seen / total > 0.5;
  }

  if (scrolledDeep()) return;

  function setDismissed() {
    try { localStorage.setItem(STORAGE_KEY, Date.now().toString()); } catch (e) {}
  }

  const toast = document.createElement('div');
  toast.className = 'tk-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = [
    '<span class="tk-toast-dot" aria-hidden="true"></span>',
    '<span class="tk-toast-text">',
      '<strong>TurnkeyAI</strong>',
      '<span class="tk-toast-msg">' + (isFR
        ? 'Une question sur l\'IA ? De vraies personnes, réponse sous 2 h'
        : 'Question about AI? Real humans, answer in 2 hours')
        + ' <span class="tk-toast-arrow" aria-hidden="true">&rarr;</span></span>',
    '</span>',
    '<button class="tk-toast-close" type="button" aria-label="' + (isFR ? 'Fermer la notification' : 'Dismiss notification') + '">&times;</button>'
  ].join('');

  let autoTimer;

  function hideToast() {
    clearTimeout(autoTimer);
    toast.classList.remove('is-visible');
    toast.classList.add('is-leaving');
    document.removeEventListener('keydown', escHandler);
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 700);
  }

  function escHandler(e) {
    if (e.key === 'Escape' && toast.classList.contains('is-visible')) {
      setDismissed();
      hideToast();
    }
  }

  toast.addEventListener('click', function (e) {
    if (e.target.closest('.tk-toast-close')) return;
    setDismissed();
    const targetEl = document.getElementById('booking');
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      hideToast();
    } else {
      window.location.href = (isFR ? '/fr/' : '/') + '#booking';
    }
  });

  toast.querySelector('.tk-toast-close').addEventListener('click', function (e) {
    e.stopPropagation();
    setDismissed();
    hideToast();
  });

  toast.addEventListener('mouseenter', () => clearTimeout(autoTimer));
  toast.addEventListener('mouseleave', () => {
    autoTimer = setTimeout(hideToast, 4000);
  });

  document.body.appendChild(toast);

  setTimeout(() => {
    if (scrolledDeep()) {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
      return;
    }
    toast.classList.add('is-visible');
    document.addEventListener('keydown', escHandler);
    autoTimer = setTimeout(hideToast, 12000);
  }, 3000);
})();

// --- Language suggestion banner (geo + browser language) --------------------
// Offers the French version (/fr/) to French-preferring visitors and to visitors
// in French territories (New Caledonia, France, French Pacific, etc.). It never
// hard-redirects — Google recommends a banner, not IP redirection, so both the
// English and French URLs stay crawlable and indexable. Home page only (the only
// page with a /fr/ twin for now). One click settles the choice for good.
(function () {
  try {
    var LS = window.localStorage;
    function setPref(v) { try { LS.setItem('tk_lang_pref', v); } catch (e) {} }

    // Any explicit language switch settles the preference for good — the EN/FR
    // nav links carry an hreflang attribute on both versions of the page.
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[hreflang]');
      if (!a) return;
      setPref(/^fr/i.test(a.getAttribute('hreflang') || '') ? 'fr' : 'en');
    });

    var path = location.pathname.replace(/\/index\.html$/, '/');
    if (path !== '/') return;                          // English home only
    if (LS.getItem('tk_lang_pref')) return;            // already chose EN or FR

    // France + all French overseas territories (incl. New Caledonia = NC)
    var FR_COUNTRIES = ['FR','NC','PF','WF','MC','GP','MQ','GF','RE','YT','BL','MF','PM','TF'];

    function browserPrefersFrench() {
      var ls = navigator.languages || [navigator.language || ''];
      return ls.some(function (l) { return /^fr\b/i.test(l); });
    }

    // Distance from the viewport bottom that keeps the banner clear of the
    // sticky mobile CTA — never cover the primary conversion button
    // (~80% of paid traffic is mobile). Recomputed on resize/rotation.
    function bottomOffset() {
      var sticky = document.querySelector('.tk-sticky-cta');
      if (sticky) {
        var sr = sticky.getBoundingClientRect();
        if (sr.height > 0 && getComputedStyle(sticky).display !== 'none') {
          return Math.max(22, Math.round(window.innerHeight - sr.top) + 12);
        }
      }
      return 22;
    }

    function show() {
      if (document.getElementById('tk-lang-banner')) return;
      var offset = bottomOffset();
      var bar = document.createElement('div');
      bar.id = 'tk-lang-banner';
      bar.setAttribute('role', 'region');
      bar.setAttribute('aria-label', 'Language / langue');
      bar.style.cssText = 'position:fixed;left:50%;bottom:' + offset + 'px;z-index:1200;display:flex;gap:14px;align-items:center;flex-wrap:wrap;justify-content:center;max-width:calc(100vw - 32px);padding:12px 14px 12px 18px;background:#1d1d1f;color:#f5f5f7;border-radius:16px;font:500 14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.32);transform:translate(-50%,140%);transition:transform .55s cubic-bezier(.2,.75,.2,1);';
      bar.innerHTML =
        '<span style="white-space:nowrap;">🇫🇷 Ce site est disponible en français.</span>' +
        '<a href="/fr/" id="tk-lang-go" style="display:inline-flex;align-items:center;gap:6px;background:#0071e3;color:#fff;text-decoration:none;padding:8px 16px;border-radius:100px;font-weight:600;white-space:nowrap;">Voir en français →</a>' +
        '<button id="tk-lang-x" type="button" aria-label="Rester en anglais" style="background:none;border:none;color:rgba(245,245,247,.55);font-size:22px;line-height:1;cursor:pointer;padding:2px 8px;">×</button>';
      document.body.appendChild(bar);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { bar.style.transform = 'translate(-50%,0)'; });
      });
      document.getElementById('tk-lang-go').addEventListener('click', function () { setPref('fr'); });
      document.getElementById('tk-lang-x').addEventListener('click', function () {
        setPref('en');                                 // respect the choice; never nag again
        bar.style.transform = 'translate(-50%,140%)';
        setTimeout(function () { if (bar.parentNode) bar.parentNode.removeChild(bar); }, 550);
      });
      window.addEventListener('resize', function () {
        if (bar.parentNode) bar.style.bottom = bottomOffset() + 'px';
      });
    }

    if (browserPrefersFrench()) { show(); return; }    // no network needed
    // Browser isn't French: ask the edge for the country (catches e.g. an English
    // device physically in New Caledonia). Best-effort; failure just shows nothing.
    fetch('/tk-geo', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.country && FR_COUNTRIES.indexOf(d.country) !== -1) show(); })
      .catch(function () {});
  } catch (e) { /* a language banner must never break the page */ }
})();

// --- Lead attribution (first-touch) -----------------------------------------
// Captures where the visitor ORIGINALLY came from (utm > external referrer >
// direct), persists it for the whole browsing lifetime, and fills the hidden
// attribution fields of any form present on the page. This is what lets every
// lead email / CRM entry say "came from openai / cpc / tkai-leads".
(function () {
  try {
    var KEY = 'tk_attribution';
    if (!localStorage.getItem(KEY)) {
      var p = new URLSearchParams(location.search);
      var ref = document.referrer || '';
      var source = p.get('utm_source') || '';
      var medium = p.get('utm_medium') || '';
      // Ad-platform click IDs (auto-tagging sends no utm params)
      if (!source && (p.get('gclid') || p.get('gbraid') || p.get('wbraid'))) {
        source = 'google'; medium = 'cpc';
      }
      if (!source && p.get('msclkid')) {
        source = 'bing'; medium = 'cpc';
      }
      if (!source && ref) {
        try {
          var h = new URL(ref).hostname;
          if (h && h.indexOf('turnkeyai.com.au') === -1 && h.indexOf('tkai.com.au') === -1) {
            source = h; medium = 'referral';
          }
        } catch (e) {}
      }
      localStorage.setItem(KEY, JSON.stringify({
        source: source || 'direct',
        medium: medium || 'none',
        campaign: p.get('utm_campaign') || '',
        content: p.get('utm_content') || '',
        term: p.get('utm_term') || '',
        placement: p.get('utm_placement') || '',
        referrer: ref,
        landing: location.pathname + location.search
      }));
    }
    var a = JSON.parse(localStorage.getItem(KEY) || '{}');
    var map = { leadSource: a.source, leadMedium: a.medium, leadCampaign: a.campaign, leadContent: a.content, leadTerm: a.term, leadPlacement: a.placement, leadReferrer: a.referrer, leadLandingPage: a.landing };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = map[id] || '';
    });
  } catch (e) { /* attribution must never break the page */ }
})();

// --- Inline ai-audit form handler (sub-pages) -------------------------------
// The home page binds its own form via an inline onsubmit. Sub-pages (local +
// industry landing pages) carry an identical Netlify "ai-audit" form marked
// with data-tk-form="ai-audit"; this binds them so they POST, fire the same
// conversion events, and redirect to /thank-you — same pipeline, same
// co-branded plan. Attribution fields above are already auto-filled.
(function () {
  var forms = document.querySelectorAll('form[data-tk-form="ai-audit"]');
  if (!forms.length) return;
  forms.forEach(function (form) {
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var btn = form.querySelector('[type="submit"]');
      var btnLabel = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      function val(n) { return form[n] ? (form[n].value || '') : ''; }
      try {
        var params = new URLSearchParams({
          'form-name': 'ai-audit',
          firstName: val('firstName'),
          lastName: val('lastName'),
          email: val('email'),
          phone: val('phone'),
          businessName: val('businessName'),
          website: val('website').trim(),
          industry: val('industry'),
          leadSource: val('leadSource'),
          leadMedium: val('leadMedium'),
          leadCampaign: val('leadCampaign'),
          leadContent: val('leadContent'),
          leadTerm: val('leadTerm'),
          leadPlacement: val('leadPlacement'),
          leadReferrer: val('leadReferrer'),
          leadLandingPage: val('leadLandingPage')
        });
        var r = await fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
        if (r.ok) {
          try {
            if (typeof gtag === 'function') {
              gtag('set', 'user_data', {
                email: val('email').trim().toLowerCase(),
                phone_number: val('phone').replace(/[^\d+]/g, '') || undefined
              });
              gtag('event', 'generate_lead', { event_category: 'engagement', event_label: val('industry') || 'unknown', value: 1 });
              gtag('event', 'form_submission', { form_name: 'ai-audit', industry: val('industry') || 'unknown' });
            }
          } catch (e) {}
          try { if (typeof oaiq === 'function') oaiq('measure', 'lead_created', { type: 'customer_action' }); } catch (e) {}
          try { if (typeof clarity === 'function') { clarity('event', 'form_submission'); clarity('set', 'lead_industry', val('industry') || 'unknown'); } } catch (e) {}
          window.location.href = '/thank-you';
        } else {
          alert('Something went wrong. Try again.');
          if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
        }
      } catch (err) {
        alert('Error sending form');
        if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
      }
    });
  });
})();
