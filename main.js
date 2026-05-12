/* ================================================================
   SARAH GRAF — PARTY ROOM BOOKING WEBSITE
   main.js: navigation scroll state + section reveal animations
   ================================================================ */

/* ─── NAVIGATION: add .scrolled on scroll ─────────────────────── */
(function initNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;

  function onScroll() {
    nav.classList.toggle('scrolled', window.scrollY > 60);
    // Sticky CTA pill disabled — nav CTA is enough. Leaving this toggle commented
    // out so the body class isn't set; the .sticky-cta element is also commented
    // out in index.html.
    // document.body.classList.toggle('past-hero', window.scrollY > window.innerHeight * 0.8);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  // Also tick in rAF so mobile (iOS) catches momentum scroll
  (function rafTick() {
    onScroll();
    requestAnimationFrame(rafTick);
  })();
})();


/* ─── SCROLL REVEAL: IntersectionObserver ────────────────────── */
(function initScrollReveal() {
  const elements = document.querySelectorAll('.section-reveal');
  if (!elements.length) return;

  // Check if user prefers reduced motion — if so, reveal everything immediately
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) {
    elements.forEach(el => el.classList.add('visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target); // fire once, then stop watching
        }
      });
    },
    {
      threshold: 0.1,        // trigger when 10% is in view
      rootMargin: '0px 0px -40px 0px' // slight bottom offset for cleaner timing
    }
  );

  elements.forEach(el => observer.observe(el));
})();


/* ─── LANGUAGE TOGGLE (DE / EN) ──────────────────────────────── */
(function initLangToggle() {
  const STORAGE_KEY = 'sturmfrei-wien-lang';
  const DEFAULT_LANG = 'de';
  const toggle = document.getElementById('langToggle');
  if (!toggle) return;

  function getLang() {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG;
  }

  function setLang(lang) {
    localStorage.setItem(STORAGE_KEY, lang);
    apply(lang);
  }

  function apply(lang) {
    document.documentElement.lang = lang;

    // 1. Text content swap: elements with data-de / data-en.
    //    The pipe character "|" in a value is rendered as <br> (used by hero-tagline).
    document.querySelectorAll('[data-de][data-en]').forEach(el => {
      const value = el.getAttribute('data-' + lang);
      if (value == null) return;
      if (value.includes('|')) {
        el.innerHTML = value.split('|').map(escapeHtml).join('<br>');
      } else {
        el.textContent = value;
      }
    });

    // 2. Image alt swap: elements with data-de-alt / data-en-alt.
    document.querySelectorAll('[data-de-alt][data-en-alt]').forEach(img => {
      const value = img.getAttribute('data-' + lang + '-alt');
      if (value != null) img.alt = value;
    });

    // 3. Toggle button visual state.
    toggle.querySelectorAll('.lang-opt').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.lang === lang);
    });
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  toggle.addEventListener('click', () => {
    setLang(getLang() === 'de' ? 'en' : 'de');
  });

  apply(getLang());
})();


/* ─── SMOOTH ANCHOR SCROLL (for same-page links) ─────────────── */
(function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]:not([href="#setmore-placeholder"])').forEach(link => {
    link.addEventListener('click', (e) => {
      const target = document.querySelector(link.getAttribute('href'));
      if (target) {
        e.preventDefault();
        const navHeight = parseInt(
          getComputedStyle(document.documentElement).getPropertyValue('--nav-height'),
          10
        ) || 64;
        const top = target.getBoundingClientRect().top + window.scrollY - navHeight;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });
})();
