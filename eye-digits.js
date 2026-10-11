/* Глаз из цифр: настоящие кадры поворота глаза из видео раскладываются на цифры,
   мышь слева от глаза листает эти кадры, вправо и вверх-вниз — небольшой сдвиг радужки.
   Глаз сам моргает поверх любого положения зрачка: веко взято из закрытого кадра видео,
   его край опускается по форме разреза глаза */
(() => {
  const SRC = 'img/eye-frames.webp';          // спрайт: кадры сложены сверху вниз, 0 — взгляд прямо
  const FRAMES = 11;
  const BLINK = false;                         // моргание выключено (не понравилось), код оставлен
  const CLOSED_SRC = 'img/eye-closed.webp';     // кадр с полностью закрытым глазом
  const OPEN = { x: .535, y: .49, rx: .33, ry: .23 }; // разрез глаза, который закрывает веко
  const BLINK_DOWN = 95, BLINK_HOLD = 40, BLINK_UP = 210; // мс: быстро закрылся, задержка, медленнее открылся
  const PUPIL = { x: .51, y: .476 };          // центр зрачка в кадре 0 (доли ширины/высоты)
  const PUPIL_LEFT = .46;                     // где зрачок в последнем кадре
  const IRIS = .125;                          // радиус радужки в долях ширины кадра
  const LID = { x: .53, y: .49, rx: .34, ry: .21 };
  const NUDGE = { x: .022, y: .028 };         // программный сдвиг вправо и вверх-вниз
  const CELL = 11, DIGITS = '0123456789', LEVELS = 10;

  const canvas = document.getElementById('eyeCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const RED_LEVELS = 6;
  const VIOLET = true, FLASH_MS = 1700;          // фиолетовый лейтмотив в глазу
  const state = window.eyeDigits = { alpha: reduce ? 1 : 0, reveal: reduce ? 1 : 0,
    red: new URLSearchParams(location.search).get('red') || 'none' }; // glint | planet | orbit | rim | none

  let accent = (getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '139,92,255').split(',').map(Number);
  state.setBlik = k => { blik = BLIK[k] || blik; setBlikLo(); if (atlas) buildAtlas(); };
  state.setAccent = c => { accent = c.split(',').map(Number); if (atlas) buildAtlas(); };
  const BLIK_AT = { x: .586, y: .451 };          // центр белого блика в кадре (найден по яркости)
  const PUPIL_R = .38, IRIS_IN = .42, IRIS_OUT = .92;           // кольцо радужки: между зрачком и белком, в долях радиуса радужки
  let blikLo = .8, blikHi = 1, irisVals = null;
  // варианты блика: фиолетовым становятся только самые белые цифры радужки (порог яркости),
  // 3 оттенка — смешивание с белым, без свечения
  // блик: в зрачке — пятно (pr, выбран «средний»); на радужке — редкие мерцающие цифры вокруг блика (dens — доля клеток)
  const BLIK = {
    soft:   { pr: .15, r: .2, dens: .2,  mix: [.18, .32, .46], glow: 0 },
    medium: { pr: .15, r: .2, dens: .36, mix: [.18, .32, .46], glow: 0 },
    strong: { pr: .15, r: .2, dens: .55, mix: [.18, .32, .46], glow: 0 },
  };
  let blik = BLIK[new URLSearchParams(location.search).get('blik')] || BLIK.medium;
  const setBlikLo = () => {};
  let atlasVio, atlasFlash, flashT, atlasRed, frames, closed, tone, SW, SH, cols, rows, dpr, W, H, rect, seeds, atlas;
  let mx = 0, my = 0, gx = 0, gy = 0, hasMouse = false;
  let blinkAt = 4500, prevBlink = 0;            // когда следующее моргание

  // спрайт → массивы яркости по кадрам
  function decode(im, count) {
    const h = im.height / count, off = document.createElement('canvas');
    off.width = im.width; off.height = im.height;
    const o = off.getContext('2d'); o.drawImage(im, 0, 0);
    const d = o.getImageData(0, 0, im.width, im.height).data, n = im.width * h, out = [];
    for (let f = 0; f < count; f++) {
      const l = new Float32Array(n);
      for (let i = 0; i < n; i++) l[i] = d[(f * n + i) * 4] / 255;
      out.push(l);
    }
    return out;
  }

  const img = new Image();
  img.src = SRC;
  img.onload = () => {
    SW = img.width; SH = img.height / FRAMES;
    frames = decode(img, FRAMES);
    const n = SW * SH;
    // одна кривая яркости для всех кадров (по кадру 0), чтобы при повороте и моргании не мигало
    const hist = new Float32Array(256);
    for (const v of frames[0]) hist[Math.round(v * 255)]++;
    for (let i = 1; i < 256; i++) hist[i] += hist[i - 1];
    for (let i = 0; i < 256; i++) hist[i] /= n;
    tone = l => { for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
      const i = y * SW + x, u = x / SW, v = y / SH;
      const e = Math.hypot((u - LID.x) / (LID.rx * 1.5), (v - LID.y) / (LID.ry * 1.9));
      const fall = e < 1 ? 1 : Math.max(.3, 1 - (e - 1) * .9);
      l[i] = Math.pow(hist[Math.round(l[i] * 255)], .9) * fall;
    } };
    frames.forEach(tone);
    // порог блика: самые светлые 12% радужки в кадре «прямо»
    const iv = [];
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++)
      if (Math.hypot(x / SW - PUPIL.x, (y / SH - PUPIL.y) / (SW / SH)) / IRIS < .95) for (const f of frames) iv.push(f[y * SW + x]);
    iv.sort((p, q) => p - q);
    irisVals = iv; blikHi = iv[Math.floor(iv.length * .995)]; setBlikLo();
    if (BLINK && !reduce) { const im = new Image(); im.src = CLOSED_SRC; im.onload = () => {
      const c = decode(im, 1)[0]; tone(c);
      // кожа века светлее открытого глаза — приводим её к яркости открытого глаза в том же месте
      let so = 0, sc = 0, n = 0;
      for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
        const q = (x / SW - OPEN.x) / OPEN.rx, r = (y / SH - OPEN.y) / OPEN.ry;
        if (q * q + r * r < 1) { const i = y * SW + x; so += frames[0][i]; sc += c[i]; n++; }
      }
      const k = Math.min(1, (so / sc) * 1.05);
      for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
        const q = (x / SW - OPEN.x) / (OPEN.rx * 1.25), r = (y / SH - OPEN.y) / (OPEN.ry * 1.6), d = q * q + r * r;
        const w = d < .6 ? 1 : d > 1 ? 0 : (1 - d) / .4;            // плавно гасим к краям
        const i = y * SW + x;
        let v = c[i] * (1 - w + w * k);
        // тень вдоль линии ресниц закрытого глаза и в складке века
        const lashY = OPEN.y + OPEN.ry * .62 * Math.sqrt(Math.max(0, 1 - ((x / SW - OPEN.x) / OPEN.rx) ** 2));
        v *= 1 - .3 * Math.max(0, 1 - Math.abs(y / SH - lashY) / .06) * w;
        c[i] = v;
      }
      closed = c;
    }; }
    resize(); addEventListener('resize', resize);
    requestAnimationFrame(loop);
  };

  function buildAtlas() {
    atlas = document.createElement('canvas');
    atlas.width = CELL * dpr * DIGITS.length; atlas.height = CELL * dpr * LEVELS;
    const a = atlas.getContext('2d');
    a.font = `${Math.round(CELL * 1.05 * dpr)}px "JetBrains Mono", ui-monospace, Consolas, monospace`;
    a.textBaseline = 'top';
    for (let l = 0; l < LEVELS; l++) {
      const v = Math.round(40 + 215 * (l / (LEVELS - 1)));
      a.fillStyle = `rgb(${v},${v},${Math.round(v * .97)})`;
      for (let k = 0; k < DIGITS.length; k++) a.fillText(DIGITS[k], k * CELL * dpr, l * CELL * dpr);
    }
    // фиолетовый лейтмотив: блик — 3 приглушённых оттенка, вспышки — по уровням яркости
    const [ar, ag, ab] = accent, mix = (c, w, k) => Math.round(c + (w - c) * k);
    atlasVio = document.createElement('canvas');
    atlasVio.width = atlas.width; atlasVio.height = CELL * dpr * 3;
    const av = atlasVio.getContext('2d'); av.font = a.font; av.textBaseline = 'top';
    av.shadowColor = `rgba(${ar},${ag},${ab},.7)`; av.shadowBlur = blik.glow * dpr;
    blik.mix.forEach((k, l) => {                          // от насыщенного к светлому сиреневому
      av.fillStyle = `rgb(${mix(ar, 236, k)},${mix(ag, 232, k)},${mix(ab, 246, k)})`;
      for (let d = 0; d < DIGITS.length; d++) av.fillText(DIGITS[d], d * CELL * dpr, l * CELL * dpr);
    });
    atlasFlash = document.createElement('canvas');
    atlasFlash.width = atlas.width; atlasFlash.height = CELL * dpr * LEVELS;
    const af = atlasFlash.getContext('2d'); af.font = a.font; af.textBaseline = 'top';
    af.shadowColor = `rgba(${ar},${ag},${ab},.55)`; af.shadowBlur = 3 * dpr;
    for (let l = 0; l < LEVELS; l++) {
      const v = 40 + 215 * (l / (LEVELS - 1)), k = .35;          // 65% фиолетового, 35% яркости клетки
      af.fillStyle = `rgb(${mix(ar, v, k)},${mix(ag, v, k)},${mix(ab, v, k)})`;
      for (let d = 0; d < DIGITS.length; d++) af.fillText(DIGITS[d], d * CELL * dpr, l * CELL * dpr);
    }
    atlasRed = document.createElement('canvas');
    atlasRed.width = atlas.width; atlasRed.height = CELL * dpr * RED_LEVELS;
    const r = atlasRed.getContext('2d');
    r.font = a.font; r.textBaseline = 'top';
    for (let l = 0; l < RED_LEVELS; l++) {
      const k = .35 + .65 * l / (RED_LEVELS - 1);
      const [ar, ag, ab] = accent, hi = k * k * .45;           // светлее к центру блика
      r.fillStyle = `rgb(${Math.round(ar + (255 - ar) * hi)},${Math.round(ag + (255 - ag) * hi)},${Math.round(ab + (255 - ab) * hi)})`;
      r.shadowColor = `rgba(${ar},${ag},${ab},${(.5 + .5 * k).toFixed(2)})`; r.shadowBlur = 4 * dpr;
      r.globalAlpha = .45 + .55 * k;
      for (let d = 0; d < DIGITS.length; d++) r.fillText(DIGITS[d], d * CELL * dpr, l * CELL * dpr);
    }
  }

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    cols = Math.ceil(W / CELL); rows = Math.ceil(H / CELL);
    const mobile = W < 900;
    const ew = mobile ? W * 2.1 : Math.max(W * 1.35, H * 2.3);
    const eh = ew * SH / SW;
    const px = mobile ? W * .66 : W * .76, py = mobile ? H * .34 : H * .5;
    rect = { x: px - PUPIL.x * ew, y: py - PUPIL.y * eh, w: ew, h: eh, px, py };
    seeds = new Float32Array(cols * rows * 3);
    flashT = new Float32Array(cols * rows).fill(-1e9);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    buildAtlas();
  }

  addEventListener('pointermove', e => { hasMouse = true; mx = e.clientX; my = e.clientY; });

  let last = 0;
  function loop(t) {
    requestAnimationFrame(loop);
    const blinking = closed && t > blinkAt && t < blinkAt + BLINK_DOWN + BLINK_HOLD + BLINK_UP + 40;
    if (t - last < (blinking ? 15 : 33)) return;   // во время моргания — 60 кадров/с
    last = t;
    const r = canvas.getBoundingClientRect();
    if (r.bottom < 0) return;

    let tx = 0, ty = 0;
    if (hasMouse && !reduce) {
      tx = Math.max(-1, Math.min(1, (mx - r.left - rect.px) / (W * .45)));
      ty = Math.max(-1, Math.min(1, (my - r.top - rect.py) / (H * .45)));
    } else if (!reduce) { tx = Math.sin(t / 2600) * .6; ty = Math.sin(t / 3700) * .3; }
    gx += (tx - gx) * .1; gy += (ty - gy) * .1;

    // моргание: 0 — открыт, 1 — закрыт
    let blink = 0;
    if (closed && t > blinkAt) {
      const bt = t - blinkAt;
      if (bt < BLINK_DOWN) { const k = bt / BLINK_DOWN; blink = k * k * (2 - k); }            // разгон вниз, мягкое касание
      else if (bt < BLINK_DOWN + BLINK_HOLD) blink = 1;                                      // глаз на миг закрыт
      else { const k = Math.min(1, (bt - BLINK_DOWN - BLINK_HOLD) / BLINK_UP); blink = 1 - k * k * (3 - 2 * k); } // плавно открылся
      if (bt > BLINK_DOWN + BLINK_HOLD + BLINK_UP) { blink = 0; blinkAt = t + 7000 + Math.random() * 7000; }
    }
    // размытие края века по скорости движения
    const speed = Math.abs(blink - prevBlink); prevBlink = blink;
    const blur = Math.min(.07, .008 + speed * OPEN.ry * 2.2);
    let A, B, fk, pupX, ox, oy;
    const fpos = Math.max(0, -gx) * (FRAMES - 1);
    const f0 = Math.floor(fpos);
    A = frames[f0]; B = frames[Math.min(FRAMES - 1, f0 + 1)]; fk = fpos - f0;
    pupX = PUPIL.x - (PUPIL.x - PUPIL_LEFT) * (fpos / (FRAMES - 1));
    // вправо и вверх-вниз — лёгкий сдвиг радужки
    ox = Math.max(0, gx) * NUDGE.x; oy = gy * NUDGE.y;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = state.alpha;
    const c = CELL * dpr, aspect = SW / SH, rv = state.reveal;
    const flick = reduce ? 0 : .015 + .3 * (1 - rv);
    const read = Math.max(0, Math.min(1, -r.top / H));            // насколько прокручен первый экран
    const flashRate = reduce ? 0 : 3e-5 * (1 + 3 * read);
    const maxD = Math.hypot(Math.max(rect.px, W - rect.px), Math.max(rect.py, H - rect.py));
    // красный слой — тоже из цифр
    const mode = state.red, redOn = Math.max(0, Math.min(1, (rv - .75) / .25));
    const irisR = IRIS * rect.w;
    const pcx = rect.x + (pupX + ox) * rect.w, pcy = rect.y + (PUPIL.y + oy) * rect.h;   // зрачок сейчас
    const rcx = rect.x + PUPIL.x * rect.w, rcy = rect.y + PUPIL.y * rect.h;             // зрачок в покое
    const ts = t / 1000;
    // планета-отражение: стоит на месте, как блик
    const plR = irisR * .17, plx = rcx - irisR * .16, ply = rcy - irisR * .2;
    const plTilt = -.32, plC = Math.cos(plTilt), plS = Math.sin(plTilt);
    // орбита вокруг радужки
    const obTilt = (-9 + gx * 6) * Math.PI / 180, obC = Math.cos(obTilt), obS = Math.sin(obTilt);
    const obRx = irisR * 1.6, obRy = irisR * (.3 + gy * .06);
    // блики — отражение неподвижного света: стоят на месте (у края зрачка в покое),
    // видны только там, где под ними тёмный зрачок. Зрачок едет вправо — оголяет их, влево — прячет
    const pupR = irisR * .45;
    const gl = [
      { x: rcx + pupR * .78, y: rcy - pupR * .52, r: pupR * .26 },
      { x: rcx + pupR * 1.02, y: rcy - pupR * .12, r: pupR * .11 },
    ];
    function redAt(sx, sy) {
      if (mode === 'glint') {
        // маска зрачка: 1 внутри, мягко к краю
        const pd = Math.hypot(sx - pcx, sy - pcy) / pupR;
        const inPupil = Math.max(0, Math.min(1, (1.02 - pd) / .12));
        if (inPupil <= 0) return 0;
        let v = 0;
        for (const g of gl) {
          const d = Math.hypot(sx - g.x, sy - g.y) / Math.max(g.r, CELL * .55);
          if (d < 1) v = Math.max(v, 1 - d * d);
        }
        return v * inPupil;
      }
      if (mode === 'planet') {
        const dx = sx - plx, dy = sy - ply, d = Math.hypot(dx, dy) / plR;
        let v = 0;
        if (d < 1) {
          const nz = Math.sqrt(1 - d * d), nx = dx / plR, ny = dy / plR;
          const lit = Math.max(0, -nx * .55 - ny * .6 + nz * .58);
          const lon = Math.atan2(nx, nz) + ts * .6;                          // вращение: бегут полосы
          v = (.25 + .75 * lit) * (.7 + .3 * Math.sin(lon * 5 + ny * 6));
        }
        // тонкое кольцо, задняя половина спрятана за шаром
        const rx = dx * plC + dy * plS, ry = -dx * plS + dy * plC;
        const e = Math.hypot(rx / (plR * 1.9), ry / (plR * .5));
        const ax = plR * 1.9, ay = plR * .5, ge = Math.hypot(rx / (ax * ax), ry / (ay * ay)) / Math.max(e, 1e-3);
        if (Math.abs(e - 1) / ge < CELL * .55 && (ry > 0 || d > 1)) v = Math.max(v, .55 + .35 * Math.sin(Math.atan2(ry, rx) * 3 - ts * 2));
        return v;
      }
      if (mode === 'orbit') {
        const dx = sx - pcx, dy = sy - pcy;
        const rx = dx * obC + dy * obS, ry = -dx * obS + dy * obC;
        const e = Math.hypot(rx / obRx, ry / obRy);
        const ge = Math.hypot(rx / (obRx * obRx), ry / (obRy * obRy)) / Math.max(e, 1e-3);
        if (Math.abs(e - 1) / ge > CELL * .65) return 0;                      // толщина кольца ~1 цифра
        const front = ry > 0;
        if (!front && Math.hypot(dx, dy) < irisR * 1.02) return 0;            // задняя часть уходит за радужку
        const a = Math.atan2(ry / obRy, rx / obRx);
        const run = .5 + .5 * Math.sin(a * 6 - ts * 2.2);                     // цифры бегут по кольцу
        return (front ? .75 : .35) * (.55 + .45 * run);
      }
      if (mode === 'rim') {
        const dx = sx - pcx, dy = sy - pcy, d = Math.hypot(dx, dy) / irisR;
        if (d < .84 || d > 1.06) return 0;
        const g = Math.hypot(gx, gy) > .05 ? (dx * gx + dy * gy) / (Math.hypot(dx, dy) * Math.hypot(gx, gy)) : 0;
        const band = 1 - Math.abs(d - .95) / .11;
        return band * (.3 + .55 * Math.max(0, g) + .1 * Math.sin(Math.atan2(dy, dx) * 8 + ts * 1.5));
      }
      return 0;
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let u = ((x + .5) * CELL - rect.x) / rect.w, v = ((y + .5) * CELL - rect.y) / rect.h;
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        const u0 = u, v0 = v;
        const lx = (u - LID.x) / LID.rx, ly = (v - LID.y) / LID.ry, ld = lx * lx + ly * ly;
        if (ld < 1 && (ox || oy)) {
          const dr = Math.hypot(u - pupX - ox, (v - PUPIL.y - oy) / aspect) / IRIS;
          const k = dr < 1.05 ? 1 : dr > 1.7 ? 0 : 1 - (dr - 1.05) / .65;
          const edge = Math.min(1, (1 - ld) * 4);
          u -= ox * k * edge; v -= oy * k * edge;
        }
        const si = Math.min(SH - 1, Math.floor(v * SH)) * SW + Math.min(SW - 1, Math.floor(u * SW));
        let l = A[si] + (B[si] - A[si]) * fk;
        if (blink > 0) {
          // край века опускается от верхней границы разреза к нижней
          const q = (u0 - OPEN.x) / OPEN.rx;
          if (q > -1 && q < 1) {
            const half = OPEN.ry * Math.sqrt(1 - q * q), top = OPEN.y - half, bot = OPEN.y + half - half * .18 * blink;
            // край века сохраняет дугу верхнего века и сдвигается вниз, у нижнего века упирается
            const edge = Math.min(bot, top + blink * OPEN.ry * 2.05);
            const side = Math.min(1, (1 - Math.abs(q)) / .15);           // мягко к уголкам глаза
            // край размыт по скорости: веко «смазывается» в движении
            const w = Math.max(0, Math.min(1, (edge + blur - v0) / (2 * blur)));
            if (w > 0) { const cl = closed[Math.min(SH - 1, Math.floor(v0 * SH)) * SW + Math.min(SW - 1, Math.floor(u0 * SW))]; l += (cl - l) * w * side; }
            // тень ресниц, в быстром движении бледнее
            const lash = blink < .97 && v0 > edge && v0 < edge + .022 ? (.5 - .5 * (v0 - edge) / .022) * side * Math.max(0, 1 - speed * 6) : 0;
            l *= 1 - lash;
          }
        }
        const i = (y * cols + x) * 3;
        if (redOn > 0 && mode !== 'none') {
          const rd = redAt((x + .5) * CELL, (y + .5) * CELL) * redOn;
          if (rd > .08) {
            if (Math.random() < .08) seeds[i + 1] = Math.random();
            const lv = Math.min(RED_LEVELS - 1, Math.floor(rd * RED_LEVELS));
            ctx.drawImage(atlasRed, Math.floor(seeds[i + 1] * 10) * c, lv * c, c, c, x * c, y * c, c, c);
            continue;
          }
        }
        // блик в зрачке: отражение стоит на месте (справа вверху от зрачка в покое), виден только внутри текущего зрачка
        if (VIOLET && rv > .9) {
          const pd = Math.hypot(u - pupX, (v - PUPIL.y) / aspect) / IRIS;
          const gd = Math.hypot(u0 - (PUPIL.x + IRIS * .17), (v0 - (PUPIL.y - IRIS * aspect * .15)) / aspect) / IRIS / blik.pr;
          if (pd < PUPIL_R && gd < 1 && seeds[i] < .8) {
            if (Math.random() < flick) seeds[i + 1] = Math.random();
            ctx.drawImage(atlasVio, Math.floor(seeds[i + 1] * 10) * c, Math.min(2, Math.floor((1 - gd) * 3)) * c, c, c, x * c, y * c, c, c);
            continue;
          }
        }
        if (l < .05 || seeds[i] > .62 + .38 * l) continue;
        // появление: цифры собираются от зрачка наружу
        if (rv < 1) {
          const dd = Math.hypot((x + .5) * CELL - rect.px, (y + .5) * CELL - rect.py) / maxD;
          if (dd > rv * 1.25 - seeds[i + 2] * .25) continue;
        }
        if (Math.random() < flick) seeds[i + 1] = Math.random();
        const digit = Math.floor(seeds[i + 1] * 10), level = Math.min(LEVELS - 1, Math.floor(l * LEVELS));
        const cell = i / 3, ir = Math.hypot(u - pupX, (v - PUPIL.y) / aspect) / IRIS;
        // брызги блика на радужке: редкие цифры в области блика, загораются и гаснут
        if (VIOLET && rv > .9 && seeds[i + 2] < blik.dens) {
          const pd = Math.hypot(u - pupX, (v - PUPIL.y) / aspect) / IRIS;
          const gd = Math.hypot(u0 - BLIK_AT.x, (v0 - BLIK_AT.y) / aspect) / IRIS / blik.r;
          if (pd > IRIS_IN && pd < IRIS_OUT && gd < 1) {
            const tw = Math.sin(t / 900 + seeds[i + 2] * 60);
            if (tw > 0) {
              ctx.drawImage(atlas, digit * c, level * c, c, c, x * c, y * c, c, c);
              ctx.globalAlpha = state.alpha * Math.min(1, tw * 1.6);
              ctx.drawImage(atlasVio, digit * c, Math.min(2, Math.floor((1 - gd) * 3)) * c, c, c, x * c, y * c, c, c);
              ctx.globalAlpha = state.alpha;
              continue;
            }
          }
        }
        ctx.drawImage(atlas, digit * c, level * c, c, c, x * c, y * c, c, c);
        // случайные фиолетовые вспышки: глаз «выхватывает» смысл, чаще у радужки, больше при прокрутке
        if (VIOLET && rv >= 1) {
          if (Math.random() < flashRate * (ir < 1.6 ? 6 : 1)) flashT[cell] = t;
          const ft = (t - flashT[cell]) / FLASH_MS;
          if (ft >= 0 && ft < 1) {
            ctx.globalAlpha = state.alpha * Math.sin(ft * Math.PI);
            ctx.drawImage(atlasFlash, digit * c, level * c, c, c, x * c, y * c, c, c);
            ctx.globalAlpha = state.alpha;
          }
        }
      }
    }
  }
})();
