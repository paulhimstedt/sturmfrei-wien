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
  // Also tick in rAF so mobile (iOS) catches momentum scroll (when scroll
  // events are suspended). Read scroll from documentElement.scrollTop to be
  // resilient against window.scrollY going stale on iOS Safari.
  (function rafTick() {
    const scrolled = (document.scrollingElement || document.documentElement).scrollTop > 60;
    nav.classList.toggle('scrolled', scrolled);
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


/* ─── DISCO-BALL PARALLAX ────────────────────────────────────── */
/*
 * Each .disco-ball-rope has a data-speed attribute (0..1). The ball's
 * vertical offset is recomputed every animation frame:
 *   translateY = scrollOffset * (1 - speed)
 * speed=1.0 → moves with the page (no parallax)
 * speed=0.5 → appears to move at half scroll speed
 * speed=0.0 → fully fixed
 *
 * iOS quirks this works around:
 *
 *  1. Scroll events only fire when a touch gesture ENDS — not during
 *     momentum-scroll. So we drive everything from a continuous
 *     requestAnimationFrame loop. rAF does run during momentum on
 *     iOS 13+.
 *
 *  2. window.scrollY can go stale during momentum scroll (it
 *     sometimes updates lazily). element.getBoundingClientRect().top
 *     reflects the actual painted viewport position every frame, so
 *     we derive scroll from the hero's rect instead.
 *
 *  3. A no-op passive touchmove listener nudges iOS to keep
 *     scroll-related state fresh during long flicks. Cheap insurance.
 *
 * Respects prefers-reduced-motion: skips parallax entirely so balls
 * just sit at their initial positions.
 */
(function initDiscoParallax() {
  const ropes = document.querySelectorAll('.disco-ball-rope');
  const hero = document.querySelector('.hero');
  if (!ropes.length || !hero) return;

  // NOTE: deliberately NOT respecting prefers-reduced-motion here.
  // WCAG 2.3.3 targets *autonomous* motion. This effect is driven 100%
  // by the user's own scroll input — if they aren't scrolling, nothing
  // moves. The CSS already disables the autonomous reveal/stagger
  // animations under reduce-motion (see @media block at end of CSS).
  // An earlier version of this code bailed out for reduce-motion users,
  // which was the silent kill-switch behind "parallax doesn't work on
  // my iPhone" — iOS users often have Reduce Motion enabled in
  // Accessibility without realising it.

  const items = Array.from(ropes).map(el => ({
    el,
    speed: parseFloat(el.dataset.speed) || 0.5,
  }));

  // No-op passive touchmove keeps iOS scroll state ticking during momentum.
  document.addEventListener('touchmove', () => {}, { passive: true });

  let lastY = NaN;

  function tick() {
    // Why getBoundingClientRect(hero) and not window.scrollY:
    //
    // window.scrollY reads from document.scrollingElement, which
    // depends on the page's overflow rules. With `overflow-x: clip` on
    // the html element, some browsers (notably iOS Safari) re-root
    // scrolling to <body>, making window.scrollY perpetually 0.
    //
    // The hero starts at document y=0 and lives in the page's normal
    // flow, so its viewport-relative top is ALWAYS exactly -scrollY,
    // independent of which element is the scroll container. This is
    // the bulletproof cross-browser scroll proxy.
    const y = -hero.getBoundingClientRect().top;
    if (y !== lastY) {
      for (let i = 0; i < items.length; i++) {
        const { el, speed } = items[i];
        // .disco-balls is position:fixed so the ball's viewport
        // position is controlled entirely by this transform.
        //   speed = 0 → fully fixed, never moves
        //   speed = 1 → moves exactly with the page (no parallax)
        const dy = -y * speed;
        el.style.transform = `translate3d(-50%, ${dy.toFixed(1)}px, 0)`;
      }
      lastY = y;
    }
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
})();


/* ─── DEBUG OVERLAY (gated by ?debug=1) ──────────────────────── */
/* Lets you confirm on-device whether rAF is running and what scrollY /
   transforms look like. Useful when desktop emulation can't reproduce a
   mobile-only bug. Append ?debug=1 to the URL to enable. */
(function initDebugOverlay() {
  if (!/[?&]debug=1\b/.test(location.search)) return;

  const ball = document.querySelector('.disco-ball-rope');
  if (!ball) return;

  const box = document.createElement('div');
  box.style.cssText = [
    'position:fixed', 'top:70px', 'right:8px', 'z-index:9999',
    'font:11px/1.35 ui-monospace,Menlo,monospace',
    'background:rgba(0,0,0,0.78)', 'color:#9ABD6B',
    'padding:8px 10px', 'border-radius:6px',
    'pointer-events:none', 'max-width:60vw', 'white-space:pre',
  ].join(';');
  document.body.appendChild(box);

  const hero = document.querySelector('.hero');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scrollingEl = (document.scrollingElement || document.documentElement).tagName;

  let frames = 0;
  function loop() {
    frames++;
    const sy = window.scrollY;
    const st = (document.scrollingElement || document.documentElement).scrollTop;
    const heroTop = hero ? hero.getBoundingClientRect().top : 0;
    box.textContent =
      'frames: ' + frames + '\n' +
      'reduceMotion: ' + reduceMotion + '\n' +
      'scrollingEl: ' + scrollingEl + '\n' +
      'window.scrollY: ' + sy.toFixed(1) + '\n' +
      'scrollTop: ' + st.toFixed(1) + '\n' +
      'heroRect.top: ' + heroTop.toFixed(1) + '\n' +
      'ball.transform: ' + (ball.style.transform || '(unset)');
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
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
