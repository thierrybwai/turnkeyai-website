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
