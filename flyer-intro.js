/* SetHub Flyer-Intro  (Version 2)
   Spielt eine kurze Stein-Animation, wenn jemand über den QR-Code eines Flyers kommt.
   Aufruf:  /hund  /katze  /rakete  /alien  /herz  /dino   (Ordner leiten auf /?f=<name> weiter)
   oder direkt:  /?f=hund
   Ohne Parameter passiert nichts. Tippen überspringt die Animation. */
(function () {
  try {
    var qs = new URLSearchParams(location.search);
    var key = (qs.get('f') || qs.get('flyer') || location.pathname.replace(/^\/+|\/+$/g, '').split('/')[0] || '').toLowerCase();
    if (!{ hund: 1, katze: 1, rakete: 1, alien: 1, herz: 1, dino: 1 }[key]) return;

    // ---------- Bühne: 1000 Einheiten breit, Höhe passt sich dem Bildschirm an
    var vw = Math.max(1, window.innerWidth), vh = Math.max(1, window.innerHeight);
    var VH = Math.max(1000, Math.min(2100, Math.round(1000 * vh / vw)));
    var TALL = VH >= 1500, K = TALL ? 1.25 : 1;
    var GY = VH - Math.max(300, VH * .3);              // Bodenlinie
    var NAVY = '#0B1117';
    var KEY = { B: '#2E8CFF', P: '#FF5EA0', Y: '#FFD300', G: '#00C27A', V: '#7A5CFF', C: '#04D5EB', W: '#FFFFFF', K: '#0B1117', O: '#FF9F1C', R: '#FF4D4D', S: '#CBD5E1', D: '#64748B', N: '#9A6B3F', T: '#F2D0A0', E: '#6B4A2B', Q: '#E8860C', L: '#7CE0A8', H: '#00A862' };

    function rgb(h) { var n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
    function hx(a) { return '#' + a.map(function (v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); }).join(''); }
    function sh(h, k) { return hx(rgb(h).map(function (v) { return v * k; })); }
    function li(h, t) { return hx(rgb(h).map(function (v) { return v + (255 - v) * t; })); }
    function R(n) { return Math.round(n * 10) / 10; }
    function cl(v) { return Math.max(0, Math.min(1, v)); }
    function pr(t, a, b) { return cl((t - a) / (b - a)); }
    function eo(p) { return 1 - Math.pow(1 - p, 3); }
    function ei(p) { return p * p * p; }
    function eio(p) { return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
    function back(p) { var c = 2.2; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); }
    function bounce(p) { var n = 7.5625, d = 2.75; if (p < 1 / d) return n * p * p; if (p < 2 / d) return n * (p -= 1.5 / d) * p + .75; if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + .9375; return n * (p -= 2.625 / d) * p + .984375; }
    function lerp(a, b, p) { return a + (b - a) * p; }
    var seed = 7; function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }

    // ---------- Bausteine
    function fb(x, y, u, w, c, st) {
      var s = '<rect x="' + R(x) + '" y="' + R(y) + '" width="' + R(w * u) + '" height="' + R(u) + '" rx="' + R(u * .12) + '" fill="' + c + '"/><rect x="' + R(x) + '" y="' + R(y + u * .74) + '" width="' + R(w * u) + '" height="' + R(u * .26) + '" rx="' + R(u * .12) + '" fill="' + sh(c, .86) + '"/>';
      if (st !== false) for (var i = 0; i < w; i++) s += '<rect x="' + R(x + i * u + u * .22) + '" y="' + R(y - u * .2) + '" width="' + R(u * .56) + '" height="' + R(u * .26) + '" rx="' + R(u * .07) + '" fill="' + li(c, .15) + '"/>';
      return s;
    }
    function sprite(rows, u, x0, y0) {
      var s = '';
      for (var r = rows.length - 1; r >= 0; r--) {
        var row = rows[r], c = 0;
        while (c < row.length) {
          var ch = row[c]; if (ch === '.') { c++; continue; }
          var e = c; while (e < row.length && row[e] === ch && e - c < 4) e++;
          s += fb(x0 + c * u, y0 + r * u, u, e - c, KEY[ch]); c = e;
        }
      }
      return s;
    }
    function G(s, x, y, sc, a, o) { return '<g transform="translate(' + R(x) + ' ' + R(y) + ') rotate(' + R(a || 0) + ') scale(' + (Math.round((sc == null ? 1 : sc) * 1000) / 1000) + ')"' + (o == null ? '' : ' opacity="' + R(o) + '"') + '>' + s + '</g>'; }
    function rotAt(s, a, px, py) { return '<g transform="rotate(' + R(a) + ' ' + R(px) + ' ' + R(py) + ')">' + s + '</g>'; }
    function scaleAt(s, sx, sy, px, py) { return '<g transform="translate(' + R(px) + ' ' + R(py) + ') scale(' + R(sx * 100) / 100 + ' ' + R(sy * 100) / 100 + ') translate(' + R(-px) + ' ' + R(-py) + ')">' + s + '</g>'; }
    function star(x, y, r, c, o) { return '<path d="M' + x + ' ' + (y - r) + 'Q' + x + ' ' + y + ' ' + (x + r) + ' ' + y + 'Q' + x + ' ' + y + ' ' + x + ' ' + (y + r) + 'Q' + x + ' ' + y + ' ' + (x - r) + ' ' + y + 'Q' + x + ' ' + y + ' ' + x + ' ' + (y - r) + 'Z" fill="' + c + '" opacity="' + R(o == null ? 1 : o) + '"/>'; }
    function cloud(x, y, k) { return '<g opacity=".95"><circle cx="' + R(x) + '" cy="' + y + '" r="' + 46 * k + '" fill="#fff"/><circle cx="' + R(x + 52 * k) + '" cy="' + (y - 22 * k) + '" r="' + 58 * k + '" fill="#fff"/><circle cx="' + R(x + 112 * k) + '" cy="' + y + '" r="' + 46 * k + '" fill="#fff"/><rect x="' + R(x - 10 * k) + '" y="' + y + '" width="' + 130 * k + '" height="' + 44 * k + '" rx="' + 22 * k + '" fill="#fff"/></g>'; }
    var FF = "'Plus Jakarta Sans',system-ui,-apple-system,'Segoe UI',sans-serif";
    function txt(s, x, y, size, fill, o, w) { return '<text x="' + R(x) + '" y="' + R(y) + '" font-size="' + size + '" font-family="' + FF + '" font-weight="' + (w || 800) + '" fill="' + fill + '" text-anchor="middle"' + (o == null ? '' : ' opacity="' + R(o) + '"') + '>' + s + '</text>'; }
    function bubble(s, x, y, t, t0, flip) { var p = pr(t, t0, t0 + .35); if (p <= 0) return ''; var w = s.length * 34 + 80; return G('<rect x="' + (-w / 2) + '" y="-58" width="' + w + '" height="116" rx="58" fill="#fff"/><path d="' + (flip ? 'M30 50l26 46l-60-46z' : 'M-30 50l-26 46l60-46z') + '" fill="#fff"/>' + txt(s, 0, 20, 56, NAVY), x, y, back(p), Math.sin(t * 5) * 2, cl(p * 3)); }
    function dust(x, y, t, t0, n, col, spread) { var p = pr(t, t0, t0 + .6), s = ''; if (p <= 0 || p >= 1) return ''; for (var i = 0; i < n; i++) { var a = (i / (n - 1) - .5) * (spread || 2.4); s += '<circle cx="' + R(x + Math.sin(a) * 90 * eo(p)) + '" cy="' + R(y - Math.cos(a) * 40 * eo(p) - 6) + '" r="' + R(10 + 22 * p) + '" fill="' + (col || '#fff') + '" opacity="' + R(.55 * (1 - p)) + '"/>'; } return s; }
    function confetti(x, y, t, t0, n, sd) { var p = t - t0, s = ''; if (p <= 0 || p > 1.6) return ''; seed = sd || 5; var cols = ['#2E8CFF', '#FF5EA0', '#FFD300', '#00C27A', '#7A5CFF', '#04D5EB']; for (var i = 0; i < n; i++) { var a = -Math.PI * (0.15 + 0.7 * rnd()), v = 420 + rnd() * 520, w = 1 + Math.floor(rnd() * 2), rs = (rnd() - .5) * 900; s += G(fb(-13 * w, -13, 26, w, cols[i % 6]), x + Math.cos(a) * v * p, y + Math.sin(a) * v * p + 900 * p * p, 1, rs * p, cl(1.6 - p) > 1 ? 1 : cl((1.6 - p) * 2)); } return s; }
    var LOGO = "M4.00 65.00Q4 62 6.59 63.52L90.91 112.98Q93.5 114.5 93.50 117.50L93.50 179.00Q93.5 182 90.91 180.49L6.59 131.51Q4 130 4.00 127.00ZM190.41 63.52Q193 62 193.00 65.00L193.00 127.00Q193 130 190.41 131.51L106.09 180.49Q103.5 182 103.50 179.00L103.50 117.50Q103.5 114.5 106.09 112.98ZM74.5 16A24 13 0 0 1 122.5 16V25A24 13 0 0 1 74.5 25ZM76.4 16.3A22.1 11.67 0 1 0 120.6 16.3A22.1 11.67 0 1 0 76.4 16.3ZM26 42A24 13 0 0 1 74 42V51A24 13 0 0 1 26 51ZM27.9 42.3A22.1 11.67 0 1 0 72.1 42.3A22.1 11.67 0 1 0 27.9 42.3ZM123.5 42A24 13 0 0 1 171.5 42V51A24 13 0 0 1 123.5 51ZM125.4 42.3A22.1 11.67 0 1 0 169.6 42.3A22.1 11.67 0 1 0 125.4 42.3ZM74.5 74A24 13 0 0 1 122.5 74V83A24 13 0 0 1 74.5 83ZM76.4 74.3A22.1 11.67 0 1 0 120.6 74.3A22.1 11.67 0 1 0 76.4 74.3Z";
    var DEFS = '<defs><linearGradient id="fiLg" x1="4" y1="90" x2="193" y2="90" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7C5CFF"/><stop offset="1" stop-color="#D152C0"/></linearGradient><radialGradient id="fiGlow"><stop offset="0" stop-color="#FF5EA0" stop-opacity=".6"/><stop offset="1" stop-color="#FF5EA0" stop-opacity="0"/></radialGradient></defs>';
    function logo(cx, cy, w, fill) { var k = w / 197; return '<g transform="translate(' + R(cx - w / 2) + ' ' + R(cy - 93 * k) + ') scale(' + R(k * 1000) / 1000 + ')"><path fill-rule="evenodd" fill="' + (fill || 'url(#fiLg)') + '" d="' + LOGO + '"/></g>'; }
    // Schluss: Logo + Schriftzug + Spruch
    function brand(t, t0, dark, line, y, noLogo) {
      var p = pr(t, t0, t0 + .5); if (p <= 0) return ''; var c = dark ? NAVY : '#fff', s = '';
      if (!noLogo) s += G(logo(0, 0, 170, dark ? null : '#fff'), 500, y - 150, back(p), 0, cl(p * 3));
      var q = eo(pr(t, t0 + .15, t0 + .65)); if (q > 0) s += G(txt('SetHub', 0, 0, 104, c) + txt(line, 0, 66, 38, c, .9, 600), 500, y + 30 * (1 - q), 1, 0, q);
      return s;
    }
    var BIG = '<rect x="-3000" y="-3000" width="7000" height="8000" fill="';
    seed = 99; var STARS = []; for (var i = 0; i < 90; i++) STARS.push([R(-400 + rnd() * 1800), R(rnd() * 2400), R(1.5 + rnd() * 3.5), rnd() * 6, 1 + rnd() * 3]);
    function stars(t, scroll, streak) { var s = ''; for (var i = 0; i < STARS.length; i++) { var a = STARS[i], y = ((a[1] + (scroll || 0) * (.4 + a[2] / 5)) % 2400 + 2400) % 2400 - 150, o = R(.25 + .35 * (1 + Math.sin(t * a[4] + a[3]))); if (streak > 2) s += '<line x1="' + a[0] + '" y1="' + R(y) + '" x2="' + a[0] + '" y2="' + R(y - streak * a[2]) + '" stroke="#fff" stroke-width="' + a[2] + '" stroke-linecap="round" opacity="' + o + '"/>'; else s += '<circle cx="' + a[0] + '" cy="' + R(y) + '" r="' + a[2] + '" fill="#fff" opacity="' + o + '"/>'; } return s; }
    function ground(c1, c2) { return '<rect x="-3000" y="' + R(GY) + '" width="7000" height="4000" fill="' + c1 + '"/><rect x="-3000" y="' + R(GY) + '" width="7000" height="24" fill="' + c2 + '"/>'; }

    var S = {};

    /* ======================= HUND ======================= */
    function dog(u, o) {
      // o: leg (Phase), tail, head (Grad), ear, tongue, brick
      var s = '', la = Math.sin(o.leg) * (o.run ? 30 : 0), lb = -la;
      function leg(x, a) { return rotAt(sprite(['NN', 'NN', 'TT'], u, x, 8 * u), a, x + u, 8 * u); }
      s += leg(4 * u, lb) + leg(11 * u, la);                      // hintere Ebene
      s += rotAt(fb(0, 0, u, 1, KEY.N) + fb(0, u, u, 1, KEY.N) + fb(0, 2 * u, u, 1, KEY.N) + fb(.4 * u, 3 * u, u, 1, KEY.N), o.tail, 1.2 * u, 4.4 * u);
      s += sprite(['NNNNNNNNNNN', 'NNNNNNNNNNN', 'NNNNNNNNNNN', 'NNNNNNNNNNN'], u, u, 4 * u) + fb(9 * u, 5 * u, u, 2, KEY.R);
      s += leg(1 * u, la) + leg(8 * u, lb);                      // vordere Ebene
      var h = rotAt(fb(10 * u, -.1 * u, u, 2, KEY.E), o.ear, 11 * u, 1 * u);
      h += sprite(['NNNN..', 'NKNNTT', 'NNNNTK'], u, 9 * u, 1 * u);
      if (o.blink) h += '<rect x="' + R(10 * u) + '" y="' + R(2 * u) + '" width="' + R(u) + '" height="' + R(u) + '" fill="' + KEY.N + '"/><rect x="' + R(10.1 * u) + '" y="' + R(2.5 * u) + '" width="' + R(u * .8) + '" height="' + R(u * .16) + '" rx="2" fill="' + NAVY + '"/>';
      if (o.tongue) h += fb(12 * u, 4 * u - (1 - o.tongue) * u * .6, u, 1, KEY.P, false);
      if (o.brick) h += fb(13.6 * u, 2.9 * u, u * 1.1, 2, KEY.R);
      s += rotAt(h, o.head, 10 * u, 4.5 * u);
      return s;
    }
    S.hund = {
      d: 6.0, bg: '#CDEBFF', dark: true, draw: function (t) {
        var u = 40 * K, s = BIG + '#CDEBFF"/>';
        var sx = 800, sy = TALL ? 300 : 170; for (var i = 0; i < 12; i++) s += rotAt('<rect x="' + (sx - 7) + '" y="' + (sy - 170) + '" width="14" height="46" rx="7" fill="#FFD300" opacity=".7"/>', i * 30 + t * 14, sx, sy);
        s += '<circle cx="' + sx + '" cy="' + sy + '" r="88" fill="#FFD300"/>' + cloud(90 + t * 10, sy + 40, 1) + cloud(480 - t * 6, sy - 90, .7) + cloud(-260 + t * 16, sy + 260, .85);
        s += ground('#5FD08A', '#49BD77');
        for (var g = 0; g < 9; g++) s += '<path d="M' + (40 + g * 118) + ' ' + R(GY + 60 + (g % 3) * 70) + 'l10 -26l10 26" stroke="#49BD77" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
        var run = pr(t, 0, 1.5), moving = run < 1, x = lerp(-15 * u, 500 - 7.4 * u, eo(run));
        var hop = t > 2.7 && t < 3.7 ? Math.abs(Math.sin((t - 2.7) * Math.PI * 2)) * 46 : 0;
        var bob = moving ? Math.abs(Math.sin(t * 15)) * 14 : 0, y = GY - 11 * u - bob - hop;
        var skid = t > 1.5 ? Math.sin(pr(t, 1.5, 1.95) * Math.PI) * -7 : 0;
        var nod = Math.sin(pr(t, 1.95, 2.5) * Math.PI) * 20;
        var o = { run: moving, leg: t * 15, tail: Math.sin(t * (t > 2.5 ? 26 : 12)) * (t > 2.5 ? 34 : 14), head: nod + (moving ? Math.sin(t * 15) * 4 : 0), ear: moving ? -30 + Math.sin(t * 15) * 16 : Math.sin(t * 3) * 5, tongue: t > 2.55 ? .6 + .4 * Math.abs(Math.sin(t * 9)) : 0, brick: t < 2.2, blink: (t > 3.9 && t < 4.02) };
        s += '<ellipse cx="' + R(x + 6.5 * u) + '" cy="' + R(GY + 8) + '" rx="' + R(6.4 * u * (1 - hop / 300)) + '" ry="16" fill="#000" opacity=".16"/>';
        s += dust(x + 12 * u, GY, t, 1.5, 6, '#fff') + dust(x + 5 * u, GY, t, 1.55, 5, '#fff');
        s += rotAt(G(dog(u, o), x, y), skid, x + 6 * u, GY);
        if (t >= 2.2) { var dp = pr(t, 2.2, 2.95), bx = x + 13.4 * u + 60 * dp, by = lerp(GY - 6.6 * u, GY - 1.1 * u, bounce(dp)); s += rotAt(fb(bx, by, u * 1.1, 2, KEY.R), dp < 1 ? dp * 40 - 40 * dp : 0, bx + u, by + u / 2); }
        s += bubble('Wuff!', 500 + 2.5 * u, y - 1.3 * u, t, 2.75);
        s += confetti(500 + 7 * u, GY - 1.4 * u, t, 3.0, 16, 11);
        return s + brand(t, 3.9, true, 'Bringt dir jedes Set.', GY + (VH - GY) * .5 + 60);
      }
    };

    /* ======================= KATZE ======================= */
    function cat(u, o) {
      // o: leg, legK (Beinlänge 0..1), tailT, head, blink, paw
      var s = '', C = KEY.O, C2 = KEY.Q, ls = Math.max(.25, o.legK), i;
      function leg(x, a) { return rotAt(scaleAt(fb(x, 6 * u, u, 1, C2, false) + fb(x, 7 * u, u, 1, C, false), 1, ls, x + u / 2, 6 * u), a, x + u / 2, 6 * u); }
      var la = o.walk ? Math.sin(o.leg) * 26 : 0;
      s += leg(1.6 * u, -la) + leg(5.2 * u, la);
      // Schwanz: fünf Glieder, wellenförmig
      var px = .4 * u, py = 3.6 * u, ang = -150;
      for (i = 0; i < 5; i++) { ang += Math.sin(o.tailT - i * .9) * 20 + (i ? 8 : 0); var a = ang * Math.PI / 180, nx = px + Math.cos(a) * u * .92, ny = py + Math.sin(a) * u * .92; s += G(fb(-u / 2, -u / 2, u, 1, i % 2 ? C2 : C, false), (px + nx) / 2, (py + ny) / 2, 1, ang + 90); px = nx; py = ny; }
      s += sprite(['OOOOOOO', 'OOOOOOO', 'OOOOOOO'], u, 0, 3 * u) + fb(2 * u, 3 * u, u, 2, C2) + fb(4 * u, 5 * u, u, 1, C2, false);
      s += leg(.4 * u, la) + leg(6.2 * u + (o.paw || 0), -la - (o.paw ? 50 : 0));
      var h = sprite(['O...O', 'OOOOO', 'OKOKO', 'OOPOO'], u, 5 * u, -.6 * u);
      h += '<path d="M' + R(5.2 * u) + ' ' + R(2.9 * u) + 'h' + R(-u * .9) + 'M' + R(9.8 * u) + ' ' + R(2.9 * u) + 'h' + R(u * .9) + '" stroke="#fff" stroke-width="' + R(u * .09) + '" stroke-linecap="round" opacity=".9"/>';
      if (o.blink) h += '<rect x="' + R(6 * u) + '" y="' + R(1.4 * u) + '" width="' + R(3 * u) + '" height="' + R(u) + '" fill="' + C + '"/><rect x="' + R(6.1 * u) + '" y="' + R(1.85 * u) + '" width="' + R(u * .8) + '" height="' + R(u * .16) + '" rx="2" fill="' + NAVY + '"/><rect x="' + R(8.1 * u) + '" y="' + R(1.85 * u) + '" width="' + R(u * .8) + '" height="' + R(u * .16) + '" rx="2" fill="' + NAVY + '"/>';
      s += rotAt(h, o.head || 0, 7 * u, 3.4 * u);
      return s;
    }
    S.katze = {
      d: 6.6, bg: '#FFD9B8', dark: true, draw: function (t) {
        var u = 30 * K, s = BIG + '#FFD9B8"/>' + ground('#F2B37A', '#E3A066');
        s += star(170, GY - 560, 26, '#FF5EA0', .6 + .4 * Math.sin(t * 4)) + star(840, GY - 640, 22, '#7A5CFF', .6 + .4 * Math.sin(t * 5 + 1)) + star(560, GY - 820, 18, '#fff', .6 + .4 * Math.sin(t * 3 + 2));
        // Karton
        var bw = 440 * K, bh = 220 * K, bx = 500 - bw / 2 + 30, by = GY - bh, wob = Math.sin(pr(t, 2.4, 3.0) * Math.PI * 3) * 2.2 * (1 - pr(t, 2.4, 3.0));
        var box = '<rect x="' + R(bx) + '" y="' + R(by) + '" width="' + R(bw) + '" height="' + R(bh) + '" rx="12" fill="#D9A066"/><rect x="' + R(bx - 10) + '" y="' + R(by) + '" width="' + R(bw + 20) + '" height="' + R(40 * K) + '" rx="10" fill="#C48E55"/><rect x="' + R(bx + 50) + '" y="' + R(by + 90 * K) + '" width="' + R(170 * K) + '" height="' + R(62 * K) + '" rx="8" fill="#FFD300"/><rect x="' + R(bx + 66) + '" y="' + R(by + 108 * K) + '" width="' + R(110 * K) + '" height="10" rx="5" fill="#0B1117" opacity=".5"/><rect x="' + R(bx + 66) + '" y="' + R(by + 128 * K) + '" width="' + R(70 * K) + '" height="10" rx="5" fill="#0B1117" opacity=".5"/>';
        s += '<ellipse cx="' + R(bx + bw / 2) + '" cy="' + R(GY + 8) + '" rx="' + R(bw * .56) + '" ry="16" fill="#000" opacity=".14"/>' + rotAt(box, wob, bx + bw / 2, GY);
        s += G(fb(-27, -27, 54, 1, '#FF5EA0'), 110, GY + 90, 1, 20) + G(fb(-27, -27, 54, 1, '#00C27A'), 900, GY + 150, 1, 35);
        // Stein auf der Kartonkante
        var bu = 44 * K, sxb = bx + bw - 2 * bu - 6, slide = pr(t, 3.75, 4.05), fall = pr(t, 4.05, 4.75);
        var kx = sxb + slide * bu * 1.1 + fall * 70, ky = fall > 0 ? lerp(by - bu, GY - bu, bounce(fall)) : by - bu;
        s += rotAt(fb(kx, ky, bu, 2, '#2E8CFF'), fall > 0 ? Math.min(1, fall * 1.6) * 180 : slide * 8, kx + bu, ky + bu / 2);
        if (fall > .36) s += dust(kx + bu, GY, t, 4.05 + .36 * .7, 5, '#fff', 2);
        // Katze
        var cw = 10 * u, ch = 8 * u, x, y, rot = 0, legK = 1, sqx = 1, sqy = 1, walk = false;
        var xStart = bx - cw - 40, xBox = bx + 16;
        if (t < 1.3) { x = lerp(-cw - 60, xStart, pr(t, 0, 1.3)); y = GY - ch - Math.abs(Math.sin(t * 10)) * 5; walk = true; }
        else if (t < 1.8) { var c = pr(t, 1.3, 1.6); x = xStart + (t > 1.5 ? Math.sin(t * 60) * 4 : 0); legK = 1 - .55 * eo(c); y = GY - ch + (1 - legK) * 2 * u; sqy = 1 - .08 * c; sqx = 1 + .06 * c; }
        else if (t < 2.45) { var j = pr(t, 1.8, 2.45), e = eio(j); x = lerp(xStart, xBox, e); y = lerp(GY - ch, by - ch, e) - Math.sin(j * Math.PI) * 230 * K; rot = lerp(-24, 16, j); legK = 1; sqy = 1.08; sqx = .95; }
        else { x = xBox; var l = pr(t, 2.45, 2.75); sqy = 1 - .18 * Math.sin(l * Math.PI); sqx = 1 + .12 * Math.sin(l * Math.PI); legK = 1 - .7 * eo(pr(t, 2.8, 3.3)); y = by - ch + (1 - legK) * 2 * u; }
        var paw = t > 3.45 ? Math.sin(pr(t, 3.45, 4.2) * Math.PI) * 1.9 * u : 0;
        var o = { walk: walk, leg: t * 10, legK: legK, tailT: t * (t > 2.8 ? 3.2 : 6), head: t > 4.2 ? -9 * eo(pr(t, 4.2, 4.5)) : (t > 3.3 && t < 4.2 ? 6 * Math.sin(pr(t, 3.3, 4.2) * Math.PI) : 0), blink: (t > 3.05 && t < 3.2) || (t > 5.1 && t < 5.22), paw: paw };
        if (t < 2.45) s += '<ellipse cx="' + R(x + cw / 2) + '" cy="' + R(GY + 8) + '" rx="' + R(cw * .45 * (1 - (GY - ch - y) / 700)) + '" ry="12" fill="#000" opacity=".13"/>';
        s += dust(xBox + cw / 2, by, t, 2.45, 6, '#fff');
        s += rotAt(scaleAt(G(cat(u, o), x + (o.paw ? paw * .25 : 0), y), sqx, sqy, x + cw / 2, y + ch), rot, x + cw / 2, y + ch / 2);
        s += bubble('Miau.', xBox + 6.6 * u, by - ch - 84, t, 4.45);
        return s + brand(t, 4.7, true, 'Alles hat seinen Platz.', GY + (VH - GY) * .5 + 60);
      }
    };

    /* ======================= RAKETE ======================= */
    function rocket(u, flame, t) {
      var g = '';
      function row(r, off, w, c, st) { g += fb(off * u, r * u, u, w, c, st); }
      if (flame > 0) { var fl = flame * (1 + Math.sin(t * 46) * .22); g += '<ellipse cx="0" cy="' + R(10.5 * u) + '" rx="' + R(u * 2.6 * flame) + '" ry="' + R(u * 3.4 * flame) + '" fill="#FF9F1C" opacity=".22"/>' + scaleAt(fb(-.5 * u, 11 * u, u, 1, '#FF5EA0', false) + fb(-u, 10 * u, u, 2, '#FF9F1C', false) + fb(-u, 9 * u, u, 2, '#FFD300', false), 1, fl, 0, 9 * u); }
      row(8, -3.5, 2, '#FF5EA0'); row(8, 1.5, 2, '#FF5EA0'); row(8, -1.5, 3, '#CBD5E1'); row(7, -2.5, 1, '#FF5EA0'); row(7, 1.5, 1, '#FF5EA0'); row(7, -1.5, 3, '#FFFFFF'); row(6, -1.5, 3, '#FFFFFF'); row(5, -1.5, 3, '#2E8CFF'); row(4, -1.5, 3, '#FFFFFF'); row(3, -1.5, 3, '#FFFFFF'); row(2, -1, 2, '#FF5EA0'); row(1, -.5, 1, '#FF5EA0');
      g += '<circle cx="0" cy="' + 4.5 * u + '" r="' + u * .72 + '" fill="#0B1030"/><circle cx="0" cy="' + 4.5 * u + '" r="' + u * .52 + '" fill="#04D5EB"/><circle cx="' + R(-u * .16) + '" cy="' + R(4.34 * u) + '" r="' + R(u * .14) + '" fill="#fff" opacity=".8"/>';
      return g;
    }
    S.rakete = {
      d: 6.2, bg: '#0B1030', dark: false, draw: function (t) {
        var u = 36 * K, cx = 500, base = GY, s = BIG + '#0B1030"/>';
        var up = t > 2.0 ? Math.pow(t - 2.0, 2.4) * 420 : 0;            // gestiegene Höhe
        var cam = Math.max(0, up - VH * .22), speed = t > 2 ? Math.pow(t - 2, 1.4) * 60 : 0;
        s += stars(t, cam * .5, Math.min(60, speed * (t < 4.4 ? 1 : Math.max(0, 1 - (t - 4.4) * 2))));
        s += '<circle cx="840" cy="' + R(220 + cam * .25) + '" r="52" fill="#FFD300"/><circle cx="824" cy="' + R(206 + cam * .25) + '" r="11" fill="#F2A900"/>';
        // Boden + Rampe
        s += '<g transform="translate(0 ' + R(cam) + ')"><rect x="-3000" y="' + R(base + 30) + '" width="7000" height="4000" fill="#161B45"/><rect x="' + (cx - 190) + '" y="' + R(base) + '" width="380" height="32" rx="10" fill="#33455A"/><rect x="' + (cx - 250) + '" y="' + R(base + 30) + '" width="60" height="120" fill="#273449"/><rect x="' + (cx + 190) + '" y="' + R(base + 30) + '" width="60" height="120" fill="#273449"/>';
        var sm = pr(t, 1.5, 3.6); if (sm > 0) for (var k = 0; k < 8; k++) s += '<circle cx="' + R(cx + (k - 3.5) * 70 * (1 + sm * 1.3)) + '" cy="' + R(base - 6 - (k % 2) * 40 * sm) + '" r="' + R(34 + 110 * sm) + '" fill="#fff" opacity="' + R(.26 * (1 - sm * .75)) + '"/>';
        s += '</g>';
        // Rauchspur
        if (t > 2.1) for (var q = 1; q < 9; q++) { var tt = t - q * .07; if (tt > 2.0) { var uq = Math.pow(tt - 2.0, 2.4) * 420; s += '<circle cx="' + R(cx + Math.sin(q * 2.3) * 16) + '" cy="' + R(base - uq + cam + 2.4 * u + q * 6) + '" r="' + R(18 + q * 9) + '" fill="#fff" opacity="' + R(.2 - q * .02) + '"/>'; } }
        var jit = (t > 1.2 && t < 2.6) ? Math.sin(t * 95) * 5 * pr(t, 1.2, 2.0) : 0;
        var out = t > 4.2 ? Math.pow(t - 4.2, 2) * 2600 : 0;
        s += G(rocket(u, pr(t, 1.4, 2.0), t), cx + jit, base - 9 * u - up + cam - out, 1, t > 2.6 ? Math.sin(t * 5) * 2.5 : 0);
        ['3', '2', '1'].forEach(function (n, i) { var a = .15 + i * .6, p = pr(t, a, a + .6); if (p > 0 && p < 1) { s += '<circle cx="500" cy="' + R(VH * .2) + '" r="' + R(90 + 190 * eo(p)) + '" fill="none" stroke="#04D5EB" stroke-width="' + R(14 * (1 - p)) + '" opacity="' + R(1 - p) + '"/>' + G(txt(n, 0, 86, 250, '#fff'), 500, VH * .2, 1.5 - .5 * eo(p), 0, 1 - p * p * p); } });
        if (t > 1.95 && t < 2.5) s += G(txt('Start!', 0, 30, 110, '#FFD300'), 500, VH * .2, back(pr(t, 1.95, 2.25)), -4, 1 - pr(t, 2.3, 2.5));
        s += confetti(500, VH * .42, t, 4.5, 18, 21);
        return s + brand(t, 4.5, false, 'Deine Sammlung hebt ab.', VH * .5 + 80);
      }
    };

    /* ======================= ALIEN ======================= */
    S.alien = {
      d: 6.6, bg: '#12091F', dark: false, draw: function (t) {
        var u = 38 * K, s = BIG + '#12091F"/>' + stars(t) + star(150, VH * .16, 26, '#FFD300', .6 + .4 * Math.sin(t * 4)) + star(880, VH * .3, 22, '#fff', .6 + .4 * Math.sin(t * 5));
        s += '<circle cx="130" cy="' + R(VH * .43) + '" r="60" fill="#7A5CFF"/><ellipse cx="130" cy="' + R(VH * .43) + '" rx="104" ry="22" fill="none" stroke="#CF64E5" stroke-width="9" transform="rotate(-18 130 ' + R(VH * .43) + ')"/>';
        s += '<path d="M-3000 ' + R(GY + 60) + 'Q200 ' + R(GY - 60) + ' 520 ' + R(GY + 20) + 'T1100 ' + R(GY) + 'T4000 ' + R(GY + 60) + 'V6000H-3000Z" fill="#241544"/>';
        var hoverY = VH * .2, inn = pr(t, 0, 1.1), out = pr(t, 5.0, 5.6);
        var ux = lerp(1500, 500, eo(inn)) - ei(out) * 1500, uy = lerp(hoverY - 240, hoverY, eo(inn)) + Math.sin(t * 3) * 12 - ei(out) * 500;
        var tilt = (1 - eo(inn)) * -22 + Math.sin(t * 2) * 3 + ei(out) * -30 + (t > 3.0 && t < 3.5 ? Math.sin(t * 50) * 4 : 0);
        var beamOn = pr(t, 1.1, 1.35) * (1 - pr(t, 4.75, 5.0)), flick = .82 + .18 * Math.sin(t * 38), cyan = t > 3.3;
        if (beamOn > 0) s += '<polygon points="' + R(ux - 3.4 * u) + ',' + R(uy + 4.6 * u) + ' ' + R(ux + 3.4 * u) + ',' + R(uy + 4.6 * u) + ' ' + R(ux + 9 * u) + ',' + R(GY + 60) + ' ' + R(ux - 9 * u) + ',' + R(GY + 60) + '" fill="' + (cyan ? '#04D5EB' : '#FFD300') + '" opacity="' + R(.3 * beamOn * flick) + '"/><ellipse cx="' + R(ux) + '" cy="' + R(GY + 40) + '" rx="' + R(9 * u) + '" ry="34" fill="' + (cyan ? '#04D5EB' : '#FFD300') + '" opacity="' + R(.25 * beamOn) + '"/>';
        // Steine steigen im Strahl auf
        [[-5, 2, '#FF5EA0', -20], [3, 1, '#04D5EB', 25], [-1.5, 3, '#00C27A', 12], [5.5, 2, '#7A5CFF', -30], [-7, 1, '#FFD300', 40], [1, 2, '#2E8CFF', -8]].forEach(function (b, i) {
          var a = 1.4 + i * .24, p = pr(t, a, a + 1.25), e = p * p, bu = 50 * K, x = lerp(500 + b[0] * u, ux + Math.sin(p * 9 + i) * 60 * (1 - p), e), y = lerp(GY + 30 - bu / 2 + (i % 2) * 14, uy + 4.4 * u, e);
          if (p < 1) s += G(fb(-bu / 2 * b[1], -bu / 2, bu, b[1], b[2]), x, y, 1 - .65 * e, b[3] + p * 260);
          else if (t < a + 1.55) { var f = pr(t, a + 1.25, a + 1.55); s += '<circle cx="' + R(ux) + '" cy="' + R(uy + 4.4 * u) + '" r="' + R(20 + 90 * f) + '" fill="none" stroke="#fff" stroke-width="' + R(10 * (1 - f)) + '" opacity="' + R(1 - f) + '"/>'; }
        });
        // Logo wird heruntergebeamt
        var ly = VH * .56, lp = pr(t, 3.5, 4.5);
        if (lp > 0) s += '<circle cx="500" cy="' + R(lerp(uy + 5 * u, ly, eo(lp))) + '" r="' + R(150 * eo(lp)) + '" fill="#04D5EB" opacity="' + R(.25 * (1 - pr(t, 4.6, 5.0))) + '"/>' + G(logo(0, 0, 190, '#fff'), 500, lerp(uy + 5 * u, ly, eo(lp)), .2 + .8 * eo(lp), Math.sin(lp * 12) * 6 * (1 - lp), cl(lp * 4));
        // UFO mit Lauflicht
        var uf = sprite(['.....CCCC.....', '....CCCCCC....', '..SSSSSSSSSS..', 'SSSSSSSSSSSSSS', '..DDDDDDDDDD..'], u, -7 * u, 0), on = Math.floor(t * 8);
        for (var k = 0; k < 4; k++) uf += fb((-5 + k * 3) * u, 3 * u, u, 1, (on + k) % 4 === 0 ? '#FFFFFF' : (on + k) % 4 === 1 ? '#FFD300' : '#F2A900', false);
        uf += '<ellipse cx="0" cy="' + R(.5 * u) + '" rx="' + R(1.2 * u) + '" ry="' + R(.5 * u) + '" fill="#fff" opacity=".35"/>';
        s += G(uf, ux, uy, 1, tilt);
        if (out > 0 && out < 1) s += '<line x1="' + R(ux + 7 * u) + '" y1="' + R(uy + 2 * u) + '" x2="' + R(ux + 7 * u + 500 * out) + '" y2="' + R(uy + 2 * u + 160 * out) + '" stroke="#04D5EB" stroke-width="10" stroke-linecap="round" opacity="' + R(.6 * (1 - out)) + '"/>';
        return s + brand(t, 4.5, false, 'Nicht von dieser Welt.', ly + 250, true);
      }
    };

    /* ======================= HERZ ======================= */
    var HEART = ['.XX...XX.', 'XXXX.XXXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '...XXX...', '....X....'];
    seed = 31; var HC = []; (function () { for (var r = 0; r < 8; r++) for (var x = 0; x < 9; x++) if (HEART[r][x] === 'X') { var a = rnd() * Math.PI * 2; HC.push({ r: r, x: x, d: Math.hypot(x - 4, r - 3.2) * .16 + rnd() * .25, ax: Math.cos(a) * (900 + rnd() * 500), ay: Math.sin(a) * (900 + rnd() * 500), rot: (rnd() - .5) * 720 }); } HC.sort(function (a, b) { return b.r - a.r || a.x - b.x; }); })();
    S.herz = {
      d: 6.0, bg: '#12091F', dark: false, draw: function (t) {
        var u = (TALL ? 86 : 64), cx = 500, cy = TALL ? VH * .36 : 400, x0 = cx - 4.5 * u, y0 = cy - 4 * u, s = BIG + '#12091F"/>';
        var beatT = t - 2.5, beat = beatT > 0 && beatT < 1.5 ? Math.max(0, Math.sin(beatT * Math.PI * 2.4)) : 0;
        s += '<circle cx="' + cx + '" cy="' + R(cy) + '" r="' + R(u * 9 * (1 + beat * .12)) + '" fill="url(#fiGlow)" opacity="' + R(.5 + .5 * pr(t, 1.6, 2.4)) + '"/>';
        for (var q = 0; q < 2; q++) { var rp = pr(t, 2.55 + q * .42, 3.45 + q * .42); if (rp > 0 && rp < 1) s += '<circle cx="' + cx + '" cy="' + R(cy) + '" r="' + R(u * 4 + u * 7 * eo(rp)) + '" fill="none" stroke="#FF7BB5" stroke-width="' + R(14 * (1 - rp)) + '" opacity="' + R(.8 * (1 - rp)) + '"/>'; }
        var cs = ['#FF5EA0', '#FF3D8B', '#CF64E5', '#FF7BB5', '#E03A7A'], g = '';
        for (var i = 0; i < HC.length; i++) { var c = HC[i], p = pr(t, c.d, c.d + .75); if (p <= 0) continue; var e = eo(p), pop = p < 1 ? 1 : 1 + .16 * Math.sin(pr(t, c.d + .75, c.d + .95) * Math.PI), tx = x0 + c.x * u + c.ax * (1 - e), ty = y0 + c.r * u + c.ay * (1 - e); g += '<g transform="translate(' + R(tx + u / 2) + ' ' + R(ty + u / 2) + ') rotate(' + R(c.rot * (1 - e)) + ') scale(' + R(pop * 100) / 100 + ') translate(' + R(-u / 2) + ' ' + R(-u / 2) + ')">' + fb(0, 0, u, 1, cs[(c.x * 2 + c.r * 3) % 5]) + '</g>'; }
        s += scaleAt(rotAt(g, -6, cx, cy), 1 + beat * .09, 1 + beat * .09, cx, cy);
        if (t > 2.4) for (var k = 0; k < 7; k++) { var hp = pr(t, 2.5 + k * .16, 4.6 + k * .16); if (hp > 0 && hp < 1) s += '<path transform="translate(' + R(cx + (k - 3) * u * 1.3 + Math.sin(hp * 6 + k) * 24) + ' ' + R(cy + u * 2 - hp * u * 9) + ') scale(' + R(.5 + (k % 3) * .25) + ')" d="M0 30C-60-20-30-70 0-40C30-70 60-20 0 30Z" fill="' + (k % 2 ? '#fff' : '#FF7BB5') + '" opacity="' + R(.9 * (1 - hp)) + '"/>'; }
        s += star(cx - 4.6 * u, cy - 3 * u, 22, '#fff', .5 + .5 * Math.sin(t * 5)) + star(cx + 4.8 * u, cy - 2 * u, 28, '#fff', .5 + .5 * Math.sin(t * 4 + 1)) + star(cx + 3.6 * u, cy + 3.8 * u, 20, '#fff', .5 + .5 * Math.sin(t * 6 + 2));
        return s + brand(t, 3.6, false, 'Für alle, die Steine lieben.', cy + 4 * u + (TALL ? 330 : 300));
      }
    };


    /* ======================= DINO ======================= */
    function dinoFig(u, o) {
      // o: la, lb (Beinanhebung in u), tail (Grad), jaw (Grad, Maul offen), blink
      var s = '';
      function legA(dy) { return sprite(['GGGG', 'GG..', 'GGG.'], u, 3 * u, 10 * u - dy * u); }
      function legB(dy) { return sprite(['GGG', 'GG.', 'GGG'], u, 9 * u, 10 * u - dy * u); }
      s += '<g opacity=".9">' + legB(o.lb).replace(/#00C27A/g, KEY.H) + '</g>';
      s += rotAt(sprite(['Y..', 'GY.', 'GGY', '.GG'], u, 0, 5 * u), o.tail, 3 * u, 8.5 * u);
      s += sprite(['.........GGGG...', '........GGGGGG..', '......GGGGLLG.G.', '...GGGGGGLLLG...', '...GGGGGGLLLG...'], u, 0, 5 * u);
      s += fb(u, 8 * u, u, 2, KEY.G);
      s += legA(o.la);
      // Kopf: Unterkiefer fest, Oberkopf klappt auf
      if (o.jaw > 1) s += '<rect x="' + R(9.6 * u) + '" y="' + R(3.4 * u) + '" width="' + R(5.6 * u) + '" height="' + R(1.4 * u) + '" rx="' + R(u * .3) + '" fill="#7A1730"/>' + fb(10.4 * u, 3.9 * u, u * .9, 3, '#FF5EA0', false);
      s += sprite(['.........GGGWW..'], u, 0, 4 * u);
      var h = sprite(['..........GGGG..', '.........GGGGGG.', '.........GKGGGG.', '.........GGGGGG.'], u, 0, 0);
      if (o.blink) h += '<rect x="' + R(10 * u) + '" y="' + R(2 * u) + '" width="' + R(u) + '" height="' + R(u) + '" fill="' + KEY.G + '"/><rect x="' + R(10.1 * u) + '" y="' + R(2.45 * u) + '" width="' + R(u * .8) + '" height="' + R(u * .16) + '" rx="2" fill="' + NAVY + '"/>';
      if (o.jaw > 1) h += '<rect x="' + R(12.6 * u) + '" y="' + R(3.7 * u) + '" width="' + R(.7 * u) + '" height="' + R(.45 * u) + '" fill="#fff"/><rect x="' + R(13.7 * u) + '" y="' + R(3.7 * u) + '" width="' + R(.7 * u) + '" height="' + R(.45 * u) + '" fill="#fff"/>';
      s += rotAt(h, -o.jaw, 9.6 * u, 4 * u);
      return s;
    }
    S.dino = {
      d: 6.4, bg: '#BFF0D4', dark: true, draw: function (t) {
        var u = 34 * K, STEP = .42, walkEnd = 2.1;
        // Stampfen: jeder Schritt schüttelt kurz das Bild
        var ph = t / STEP, since = (t % STEP), stomp = t < walkEnd ? Math.exp(-since * 14) : 0;
        var roar = pr(t, 2.45, 2.6) * (1 - pr(t, 3.35, 3.6));
        var shake = stomp * 10 * Math.sin(t * 90) + roar * 7 * Math.sin(t * 70);
        var shakeY = stomp * 14 * Math.abs(Math.sin(t * 60));
        var s = BIG + '#BFF0D4"/>';
        var sy = TALL ? 300 : 180;
        s += '<circle cx="800" cy="' + sy + '" r="100" fill="#FFD300"/>' + cloud(110 + t * 8 + shake * .3, sy - 30, 1) + cloud(470 - t * 5, sy + 120, .7);
        s += '<g transform="translate(' + R(shake) + ' ' + R(shakeY * .5) + ')">';
        s += '<ellipse cx="760" cy="' + R(GY + 40) + '" rx="620" ry="170" fill="#8FE3B0"/>' + ground('#5FD08A', '#49BD77');
        // kleine Steine am Boden hüpfen bei jedem Schritt
        [[120, '#2E8CFF', 2, 10], [280, '#FF5EA0', 1, -20], [860, '#FFD300', 1, 25], [940, '#7A5CFF', 2, -8]].forEach(function (b, i) {
          var hp = (stomp + roar * Math.abs(Math.sin(t * 22 + i))) * (60 + i * 12);
          s += G(fb(-22 * b[2], -22, 44, b[2], b[1]), b[0], GY + 70 - hp, 1, b[3] + hp * (i % 2 ? .6 : -.6));
        });
        // Dino läuft herein
        var x = lerp(-17 * u, 500 - 8.8 * u, eo(pr(t, 0, walkEnd))), moving = t < walkEnd;
        var la = moving ? Math.max(0, Math.sin(ph * Math.PI)) * 1.1 : 0, lb = moving ? Math.max(0, -Math.sin(ph * Math.PI)) * 1.1 : 0;
        var bob = moving ? Math.abs(Math.sin(ph * Math.PI)) * 10 : 0;
        var lean = t > 2.2 && t < 2.5 ? -6 * Math.sin(pr(t, 2.2, 2.5) * Math.PI / 2) : (roar > 0 ? 4 * roar : 0);
        var o = { la: la, lb: lb, tail: Math.sin(t * (t > 3.6 ? 9 : 5)) * (t > 3.6 ? 14 : 8), jaw: 24 * roar, blink: (t > 3.95 && t < 4.08) || (t > 5.3 && t < 5.42) };
        var y = GY - 13 * u - bob;
        s += '<ellipse cx="' + R(x + 7.5 * u) + '" cy="' + R(GY + 6) + '" rx="' + R(6.8 * u) + '" ry="18" fill="#000" opacity=".15"/>';
        if (moving) { var k = Math.floor(ph); s += dust(x + (k % 2 ? 10 : 4.5) * u, GY, t, k * STEP, 5, '#fff'); }
        s += rotAt(G(dinoFig(u, o), x, y), lean, x + 7 * u, GY);
        // Brüllen: Schallwellen und Wort
        var mx = x + 15.4 * u, my = y + 3.6 * u;
        for (var q = 0; q < 3; q++) { var rp = pr(t, 2.55 + q * .22, 3.4 + q * .22); if (rp > 0 && rp < 1) s += '<path d="M' + R(mx + 20 + 150 * rp) + ' ' + R(my - 90 - 130 * rp) + 'Q' + R(mx + 70 + 200 * rp) + ' ' + R(my) + ' ' + R(mx + 20 + 150 * rp) + ' ' + R(my + 90 + 130 * rp) + '" stroke="#fff" stroke-width="' + R(16 * (1 - rp)) + '" fill="none" stroke-linecap="round" opacity="' + R(.9 * (1 - rp)) + '"/>'; }
        var wp = pr(t, 2.55, 2.85); if (wp > 0) s += G(txt('ROAR!', 0, 40, 130, NAVY), 520, y - 1.8 * u, back(wp) * (1 + roar * .06 * Math.sin(t * 40)), -7, cl(wp * 3) * (1 - pr(t, 3.9, 4.2)));
        s += confetti(500 + 5 * u, y + 2 * u, t, 3.6, 16, 41);
        s += '</g>';
        return s + brand(t, 4.2, true, 'Deine Sammlung wird riesig.', GY + (VH - GY) * .5 + 60);
      }
    };

    // ---------- Abspielen
    var sc = S[key];
    var ov = document.createElement('div');
    ov.setAttribute('aria-hidden', 'true');
    ov.setAttribute('data-sethub-intro', key);
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:' + sc.bg + ';cursor:pointer;overflow:hidden;-webkit-clip-path:circle(150% at 50% 45%);clip-path:circle(150% at 50% 45%);transition:clip-path .65s cubic-bezier(.7,0,.3,1),-webkit-clip-path .65s cubic-bezier(.7,0,.3,1),opacity .65s ease;';
    ov.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ' + VH + '" preserveAspectRatio="xMidYMid meet" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible"></svg>';
    var svg = ov.firstChild, done = false, t0 = null, hold = false;
    var root = document.documentElement, oldOv = root.style.overflow;
    function paint(t) { svg.innerHTML = DEFS + sc.draw(t); }
    function finish() { if (done) return; done = true; ov.style.clipPath = 'circle(0% at 50% 45%)'; ov.style.webkitClipPath = 'circle(0% at 50% 45%)'; ov.style.opacity = '.4'; ov.style.pointerEvents = 'none'; root.style.overflow = oldOv; setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 700); }
    ov.addEventListener('click', finish);
    // Test-Haken: draw(t) hält die Animation an und zeigt den Zeitpunkt t (Sekunden)
    window.__sethubFlyerIntro = { key: key, draw: function (t) { hold = true; paint(t); }, duration: sc.d };
    var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    function tick(now) {
      if (done || hold) return;
      if (t0 === null) t0 = now;
      var t = (now - t0) / 1000;
      if (still) { paint(sc.d - .01); if (t > 1.8) return finish(); }
      else { if (t >= sc.d) return finish(); paint(t); }
      requestAnimationFrame(tick);
    }
    (document.body || root).appendChild(ov); root.style.overflow = 'hidden';
    paint(0); requestAnimationFrame(tick);
  } catch (e) { if (window.console) console.warn('SetHub flyer intro', e); }
})();
