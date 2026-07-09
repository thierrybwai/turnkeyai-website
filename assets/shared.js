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

  const STORAGE_KEY = 'tk-toast-dismissed';
  // const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
  // TEMP: cooldown disabled for visual QA — restore the block below before going to steady state
  // try {
  //   const stored = parseInt(localStorage.getItem(STORAGE_KEY), 10);
  //   if (stored && Date.now() - stored < COOLDOWN_MS) return;
  // } catch (e) { /* localStorage unavailable; continue */ }

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
      '<span class="tk-toast-msg">Question about AI? Real humans, answer in 2 hours <span class="tk-toast-arrow" aria-hidden="true">&rarr;</span></span>',
    '</span>',
    '<button class="tk-toast-close" type="button" aria-label="Dismiss notification">&times;</button>'
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
      window.location.href = '/#booking';
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
