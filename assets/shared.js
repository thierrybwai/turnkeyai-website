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
