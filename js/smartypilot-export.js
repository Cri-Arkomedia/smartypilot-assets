(() => {
  'use strict';

  // ---- Export settings ----
  const SLIDE_W = 1280;
  const SLIDE_H = 720;
  const SCALE   = 1.5;
  const JPEG_Q  = 0.92;

  // ---- Elements ----
  const btnPdf     = document.getElementById('btnPdf');
  const btnPng     = document.getElementById('btnPng');
  const btnPrint   = document.getElementById('btnPrint');
  const slides     = Array.from(document.querySelectorAll('.slide'));

  const menuToggle  = document.getElementById('menuToggle');
  const menuClose   = document.getElementById('menuClose');
  const menuBackdrop= document.getElementById('menuBackdrop');
  const actionPanel = document.getElementById('actionPanel');

  let lastFocusEl = null;

  // ---- Menu ----
  function openMenu() {
    lastFocusEl = document.activeElement;
    menuToggle?.setAttribute('aria-expanded', 'true');
    if (actionPanel)  actionPanel.hidden  = false;
    if (menuBackdrop) menuBackdrop.hidden = false;
    const first = actionPanel?.querySelector('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
    first?.focus?.();
  }

  function closeMenu() {
    menuToggle?.setAttribute('aria-expanded', 'false');
    if (actionPanel)  actionPanel.hidden  = true;
    if (menuBackdrop) menuBackdrop.hidden = true;
    lastFocusEl?.focus?.();
  }

  menuToggle?.addEventListener('click', () => {
    menuToggle.getAttribute('aria-expanded') === 'true' ? closeMenu() : openMenu();
  });
  menuClose?.addEventListener('click', closeMenu);
  menuBackdrop?.addEventListener('click', closeMenu);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && menuToggle?.getAttribute('aria-expanded') === 'true') closeMenu();
  });
  [btnPdf, btnPng, btnPrint].forEach(b => b?.addEventListener('click', closeMenu));

  // ---- FIX #1: Image cache — le immagini condivise (es. logo) vengono scaricate una sola volta ----
  const _imgCache = new Map();

  async function preloadImages() {
    const allImgs = document.querySelectorAll('.slide img[src]');
    const toFetch = [...new Set([...allImgs].map(i => i.src))];
    await Promise.all(toFetch.map(src => {
      if (_imgCache.has(src)) return Promise.resolve();
      return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload  = () => { _imgCache.set(src, true); resolve(); };
        img.onerror = () => resolve(); // non bloccare su errore
        img.src = src;
      });
    }));
  }

  // ---- Helpers ----
  async function ensureFontsReady() {
    if (document.fonts?.ready) {
      try { await document.fonts.ready; } catch (_) {}
    }
  }

  // FIX #2: capture restituisce una Promise<string> (dataURL JPEG) e distrugge subito il canvas
  // FIX #3: toBlob è asincrono e non blocca il main thread come toDataURL
  function canvasToJpegAsync(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => {
          if (!blob) { reject(new Error('toBlob failed')); return; }
          const reader = new FileReader();
          reader.onload  = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        },
        'image/jpeg',
        quality
      );
    });
  }

  async function capture(slideEl) {
    if (!window.html2canvas) throw new Error('html2canvas non è stato caricato.');

    slideEl.classList.add('is-exporting');
    slideEl.style.width  = SLIDE_W + 'px';
    slideEl.style.height = SLIDE_H + 'px';

    let canvas;
    try {
      canvas = await window.html2canvas(slideEl, {
        scale:           SCALE,
        useCORS:         true,
        allowTaint:      false,
        logging:         false,
        backgroundColor: '#ffffff',
        imageTimeout:    8000,   // evita attese infinite su immagini lente
        removeContainer: true    // html2canvas rimuove subito il clone dal DOM
      });

      // FIX #3: conversione asincrona, non blocca il thread
      const dataUrl = await canvasToJpegAsync(canvas, JPEG_Q);
      return dataUrl;

    } finally {
      // FIX #2: pulizia immediata — libera ~8MB di RAM per slide
      slideEl.style.width  = '';
      slideEl.style.height = '';
      slideEl.classList.remove('is-exporting');

      if (canvas) {
        canvas.width  = 0;
        canvas.height = 0;
      }
    }
  }

  function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement('a');
    a.download = filename;
    a.href = dataUrl;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Feedback visivo sul bottone
  function setBtn(btn, text, disabled) {
    if (!btn) return;
    btn.disabled = disabled;
    btn.textContent = text;
  }

  // ---- PNG (prima slide) ----
  btnPng?.addEventListener('click', async () => {
    const prev = btnPng.textContent;
    setBtn(btnPng, 'Genero PNG…', true);
    try {
      await ensureFontsReady();
      await preloadImages();
      const dataUrl = await capture(slides[0]);
      downloadDataUrl(dataUrl, `slide-1-${Date.now()}.png`);
    } catch (e) {
      console.error(e);
      alert('Errore durante export PNG. Vedi console.');
    } finally {
      setBtn(btnPng, prev || 'Salva Immagine', false);
    }
  });

  // ---- PDF multipagina ----
  btnPdf?.addEventListener('click', async () => {
    if (!slides.length) return;
    const prev = btnPdf.textContent;
    setBtn(btnPdf, `Genero PDF… (0/${slides.length})`, true);

    try {
      await ensureFontsReady();

      // FIX #1: pre-carica tutte le immagini una sola volta prima di iniziare
      setBtn(btnPdf, 'Carico risorse…', true);
      await preloadImages();

      const jsPDF = (window.jspdf?.jsPDF) || window.jsPDF;
      if (!jsPDF) throw new Error('jsPDF non è stato caricato.');

      const pageW = SLIDE_W * SCALE;
      const pageH = SLIDE_H * SCALE;

      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [pageW, pageH] });

      // FIX #4: le slide vengono ancora catturate in sequenza (html2canvas non è thread-safe),
      // ma ora ogni canvas viene immediatamente liberato dopo la conversione in JPEG,
      // e il feedback aggiornato dopo ogni slide riduce la percezione di lentezza.
      for (let i = 0; i < slides.length; i++) {
        setBtn(btnPdf, `Slide ${i + 1}/${slides.length}…`, true);

        // Piccola pausa per sbloccare il thread tra una slide e l'altra
        // → permette al browser di aggiornare UI e garbage-collect il canvas precedente
        await new Promise(r => setTimeout(r, 50));

        const img = await capture(slides[i]);

        if (i > 0) pdf.addPage([pageW, pageH], 'landscape');
        pdf.addImage(img, 'JPEG', 0, 0, pageW, pageH);
      }

      pdf.save(`presentazione-${Date.now()}.pdf`);

    } catch (e) {
      console.error(e);
      alert('Errore durante la generazione del PDF. Vedi console.');
    } finally {
      setBtn(btnPdf, prev || 'Esporta PDF', false);
    }
  });

  // ---- PRINT ----
  async function printAsImages() {
    await ensureFontsReady();
    await preloadImages();

    const images = [];
    for (let i = 0; i < slides.length; i++) {
      await new Promise(r => setTimeout(r, 50)); // respiro tra una slide e l'altra
      images.push(await capture(slides[i]));
    }

    const w = window.open('', '_blank');
    if (!w) { alert('Popup bloccato: abilita i popup per stampare.'); return; }

    w.document.open();
    w.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Print</title>
  <style>
    @page { size: A4 landscape; margin: 0; }
    html,body { margin:0; padding:0; background:#fff; }
    .page { width:100vw; height:100vh; page-break-after:always; break-after:page; display:flex; align-items:center; justify-content:center; overflow:hidden; }
    img { width:100%; height:100%; object-fit:contain; display:block; }
    * { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  </style>
</head>
<body>
  ${images.map(src => `<div class="page"><img src="${src}"></div>`).join('')}
  <script>window.onload=()=>setTimeout(()=>window.print(),80);<\/script>
</body>
</html>`);
    w.document.close();
  }

  btnPrint?.addEventListener('click', async () => {
    const prev = btnPrint.textContent;
    setBtn(btnPrint, 'Preparo stampa…', true);
    try {
      await printAsImages();
    } catch (e) {
      console.error(e);
      alert('Errore durante la preparazione della stampa. Vedi console.');
    } finally {
      setBtn(btnPrint, prev || 'Stampa Pro', false);
    }
  });

})();
