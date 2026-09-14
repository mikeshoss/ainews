/* AI Edge Briefing — site script. No dependencies.
   1. One audio element for the whole site: inline players hand off to it, and a bottom bar keeps playing while you
      move between pages (internal navigation swaps the page content in place instead of reloading).
   2. Durations come from the build (data-seconds), so a player never shows 0:00 before it has been touched.
   3. If audio is playing when the tab is closed, the browser asks before leaving; the bar offers Spotify at the
      current timestamp for people who want to keep listening elsewhere. */
(function () {
  'use strict';
  var audio = new Audio();
  audio.preload = 'none';
  var state = { src: null, title: '', date: '', cover: '', href: '', spotify: '', seconds: 0 };
  var bar, ticking = false;

  function fmt(s) { s = Math.max(0, Math.floor(s || 0)); var m = Math.floor(s / 60), r = s % 60; return m + ':' + (r < 10 ? '0' : '') + r; }
  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function duration() { return isFinite(audio.duration) && audio.duration > 0 ? audio.duration : state.seconds; }
  function spotifyAt() { if (!state.spotify) return ''; var t = Math.floor(audio.currentTime || 0); return state.spotify + (t > 10 ? '?t=' + t : ''); }

  // ---------- bottom bar ----------
  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'now-playing';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Now playing');
    bar.innerHTML = '<div class="np-wrap">' +
      '<a class="np-cover" href="#"><img alt="" width="44" height="44"></a>' +
      '<div class="np-main"><a class="np-title" href="#"></a><div class="np-controls">' +
      '<button class="np-back" type="button" aria-label="Back 15 seconds">−15</button>' +
      '<button class="np-pp" type="button" aria-label="Pause"></button>' +
      '<button class="np-fwd" type="button" aria-label="Forward 30 seconds">+30</button>' +
      '<div class="np-bar" role="slider" aria-label="Position" tabindex="0"><div class="np-fill"></div></div>' +
      '<span class="np-time">0:00 / 0:00</span></div></div>' +
      '<div class="np-actions"><a class="np-spotify" href="#" rel="noopener" target="_blank" hidden><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm5.5 17.3a.75.75 0 0 1-1.03.25c-2.82-1.72-6.37-2.11-10.55-1.16a.75.75 0 1 1-.33-1.46c4.57-1.05 8.5-.6 11.66 1.34.35.22.46.68.25 1.03zm1.47-3.27a.94.94 0 0 1-1.29.31c-3.23-1.98-8.15-2.56-11.97-1.4a.94.94 0 1 1-.55-1.8c4.36-1.32 9.78-.68 13.5 1.6.44.27.58.85.31 1.29zm.13-3.4C15.24 8.33 8.9 8.12 5.2 9.24a1.13 1.13 0 1 1-.65-2.16c4.25-1.29 11.31-1.04 15.77 1.61a1.13 1.13 0 0 1-1.15 1.94z"/></svg><span>Continue in Spotify</span></a>' +
      '<button class="np-close" type="button" aria-label="Stop and hide player">×</button></div></div>';
    document.body.appendChild(bar);
    document.body.classList.add('has-player');
    q('.np-pp', bar).addEventListener('click', toggle);
    q('.np-back', bar).addEventListener('click', function () { audio.currentTime = Math.max(0, audio.currentTime - 15); });
    q('.np-fwd', bar).addEventListener('click', function () { audio.currentTime = Math.min(duration(), audio.currentTime + 30); });
    q('.np-close', bar).addEventListener('click', stop);
    q('.np-spotify', bar).addEventListener('click', function () { this.href = spotifyAt(); });
    seekable(q('.np-bar', bar));
    return bar;
  }
  function seekable(el) {
    var seek = function (e) { var r = el.getBoundingClientRect(); var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; audio.currentTime = Math.max(0, Math.min(1, x / r.width)) * duration(); render(); };
    el.addEventListener('click', seek);
    el.addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft') audio.currentTime -= 5; if (e.key === 'ArrowRight') audio.currentTime += 5; });
  }

  // ---------- state ----------
  function load(p) {
    var src = p.getAttribute('data-src');
    if (state.src === src) return;
    state = { src: src, title: p.getAttribute('data-title') || '', date: p.getAttribute('data-date') || '', cover: p.getAttribute('data-cover') || '', href: p.getAttribute('data-href') || '', spotify: p.getAttribute('data-spotify') || '', seconds: Number(p.getAttribute('data-seconds')) || 0 };
    audio.src = src;
    ensureBar();
    var c = q('.np-cover', bar), img = q('img', c);
    c.href = state.href; q('.np-title', bar).href = state.href; q('.np-title', bar).textContent = state.title;
    if (state.cover) { img.src = state.cover; c.hidden = false; } else c.hidden = true;
    var sp = q('.np-spotify', bar); sp.hidden = !state.spotify; sp.href = state.spotify;
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: state.title, artist: 'The AI Edge', album: 'AI Edge Briefing', artwork: state.cover ? [{ src: state.cover, sizes: '3000x3000', type: 'image/png' }] : [] });
        navigator.mediaSession.setActionHandler('play', function () { audio.play(); });
        navigator.mediaSession.setActionHandler('pause', function () { audio.pause(); });
        navigator.mediaSession.setActionHandler('seekbackward', function () { audio.currentTime -= 15; });
        navigator.mediaSession.setActionHandler('seekforward', function () { audio.currentTime += 30; });
      } catch (e) { /* optional */ }
    }
    render();
  }
  function toggle() { if (!state.src) return; if (audio.paused) audio.play(); else audio.pause(); }
  function stop() { audio.pause(); audio.removeAttribute('src'); audio.load(); state = { src: null, title: '', date: '', cover: '', href: '', spotify: '', seconds: 0 }; try { sessionStorage.removeItem('np'); } catch (e) { /* private mode */ } if (bar) { bar.remove(); bar = null; } document.body.classList.remove('has-player'); render(); }
  function save() { if (!state.src) return; try { sessionStorage.setItem('np', JSON.stringify({ s: state, t: audio.currentTime, p: !audio.paused })); } catch (e) { /* private mode */ } }
  function restore() {
    var raw; try { raw = sessionStorage.getItem('np'); } catch (e) { return; }
    if (!raw) return;
    try {
      var d = JSON.parse(raw); if (!d.s || !d.s.src) return;
      var p = document.createElement('div');
      p.setAttribute('data-src', d.s.src); p.setAttribute('data-title', d.s.title); p.setAttribute('data-date', d.s.date); p.setAttribute('data-cover', d.s.cover); p.setAttribute('data-href', d.s.href); p.setAttribute('data-spotify', d.s.spotify); p.setAttribute('data-seconds', d.s.seconds);
      load(p);
      audio.currentTime = d.t || 0;
      if (d.p) audio.play().catch(function () { /* autoplay blocked: bar shows paused at the saved position */ });
      render();
    } catch (e) { /* ignore */ }
  }

  // ---------- rendering (bar + every inline player on the page) ----------
  function render() {
    var playing = state.src && !audio.paused, cur = audio.currentTime || 0, dur = duration();
    if (bar) {
      q('.np-pp', bar).setAttribute('aria-label', playing ? 'Pause' : 'Play');
      bar.classList.toggle('playing', !!playing);
      q('.np-fill', bar).style.width = (dur ? (cur / dur) * 100 : 0) + '%';
      q('.np-time', bar).textContent = fmt(cur) + ' / ' + fmt(dur);
    }
    qa('.player[data-src]').forEach(function (p) {
      var mine = p.getAttribute('data-src') === state.src;
      p.classList.toggle('playing', mine && !!playing);
      p.classList.toggle('active', mine);
      var pp = q('.pp', p); if (pp) pp.setAttribute('aria-label', mine && playing ? 'Pause' : 'Play');
      var f = q('.p-fill', p); if (f) f.style.width = mine && dur ? (cur / dur) * 100 + '%' : '0%';
      var t = q('.p-time', p); if (t) t.textContent = (mine ? fmt(cur) : '0:00') + ' / ' + fmt(Number(p.getAttribute('data-seconds')) || 0);
    });
    if (!ticking) { ticking = true; setTimeout(function () { ticking = false; save(); }, 1000); }
  }
  ['play', 'pause', 'timeupdate', 'ended', 'durationchange', 'seeked'].forEach(function (ev) { audio.addEventListener(ev, render); });
  audio.addEventListener('ended', function () { save(); });

  // ---------- inline players ----------
  function bindPlayers(root) {
    qa('.player[data-src]', root).forEach(function (p) {
      if (p.getAttribute('data-bound')) return;
      p.setAttribute('data-bound', '1');
      var pp = q('.pp', p);
      if (pp) pp.addEventListener('click', function () { if (p.getAttribute('data-src') !== state.src) { load(p); audio.play(); } else toggle(); });
      var bar = q('.p-bar', p);
      if (bar) bar.addEventListener('click', function (e) { if (p.getAttribute('data-src') !== state.src) { load(p); } var r = bar.getBoundingClientRect(); audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration(); if (audio.paused) audio.play(); });
    });
    render();
  }

  // ---------- small page behaviours ----------
  function bindPage(root) {
    qa('.notes-more', root).forEach(function (b) { if (b.getAttribute('data-bound')) return; b.setAttribute('data-bound', '1'); b.addEventListener('click', function () { var n = b.parentNode, o = n.classList.toggle('open'); b.textContent = o ? 'Less' : 'More'; b.setAttribute('aria-expanded', o); }); });
    var m = q('.menu'), c = m && q('.caret', m);
    if (c && !c.getAttribute('data-bound')) {
      c.setAttribute('data-bound', '1');
      c.addEventListener('click', function (e) { e.preventDefault(); var o = m.classList.toggle('open'); c.setAttribute('aria-expanded', o); });
    }
    bindPlayers(root);
  }
  document.addEventListener('click', function (e) { var m = q('.menu'); if (m && !m.contains(e.target)) { m.classList.remove('open'); var c = q('.caret', m); if (c) c.setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var m = q('.menu'); if (m) m.classList.remove('open'); } });

  // ---------- in-place navigation so the audio keeps playing ----------
  var main = q('main');
  function internal(a) {
    if (!a || !a.href || a.target || a.hasAttribute('download') || a.getAttribute('rel') === 'external') return false;
    var u; try { u = new URL(a.href, location.href); } catch (e) { return false; }
    if (u.origin !== location.origin) return false;
    if (!/\/$|\.html$/.test(u.pathname)) return false; // only pages, not files (feeds, json, mp3)
    return u;
  }
  function swap(html, url, push) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var nm = doc.querySelector('main'); if (!nm) return false;
    document.title = doc.title;
    main.innerHTML = nm.innerHTML;
    var nn = doc.querySelector('.site-header nav'), on = q('.site-header nav'); if (nn && on) on.innerHTML = nn.innerHTML;
    var canon = doc.querySelector('link[rel=canonical]'), oc = q('link[rel=canonical]'); if (canon && oc) oc.href = canon.href;
    if (push) history.pushState({ np: 1 }, '', url);
    if (url.hash) { var t = document.getElementById(url.hash.slice(1)); if (t) t.scrollIntoView(); else window.scrollTo(0, 0); } else window.scrollTo(0, 0);
    bindPage(main);
    if (window.gtag) { try { gtag('event', 'page_view', { page_location: location.href, page_title: document.title }); } catch (e) { /* optional */ } }
    return true;
  }
  function go(url, push) {
    return fetch(url.href, { headers: { accept: 'text/html' } }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (html) { if (!swap(html, url, push)) location.href = url.href; })
      .catch(function () { location.href = url.href; });
  }
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a'); var u = internal(a); if (!u) return;
    if (u.pathname === location.pathname && u.hash) return; // same-page anchor
    if (!state.src) return; // nothing playing: let the browser navigate normally
    e.preventDefault(); go(u, true);
  });
  window.addEventListener('popstate', function () { if (state.src) go(new URL(location.href), false); });

  // Leaving with audio playing: the browser shows its own "leave site?" prompt (custom dialogs are not allowed here).
  window.addEventListener('beforeunload', function (e) { if (state.src && !audio.paused) { save(); e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('pagehide', save);

  bindPage(document);
  restore();
  window.aiedgePlayer = { audio: audio, state: function () { return state; } };
})();
