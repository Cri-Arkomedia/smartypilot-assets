(() => {
  'use strict';

  // ---- Export settings ----
  // SCALE ridotto a 1.5 per ottimizzare velocità e memoria senza perdere nitidezza
  const SLIDE_W = 1280;
  const SLIDE_H = 720;
  const SCALE  = 1.5;   

  // ---- Elements ----
  const btnPdf = document.getElementById('btnPdf');
  const btnPng = document.getElementById('btnPng');
  const btnPrint = document.getElementById('btnPrint');
  const slides = Array.from(document.querySelectorAll('.slide'));

  const menuToggle = document.getElementById('menuToggle');
  const menuClose = document.getElementById('menuClose');
  const menuBackdrop = document.getElementById('menuBackdrop');
  const actionPanel = document.getElementById('actionPanel');

  let lastFocusEl = null;

  function openMenu(){
    lastFocusEl = document.activeElement;
    menuToggle?.setAttribute('aria-expanded', 'true');
    if (actionPanel) actionPanel.hidden = false;
    if (menuBackdrop) menuBackdrop.hidden = false;

    // focus sul primo elemento interattivo del pannello
    const first = actionPanel?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    first?.focus?.();
  }

  function closeMenu(){
    menuToggle?.setAttribute('aria-expanded', 'false');
    if (actionPanel) actionPanel.hidden = true;
    if (menuBackdrop) menuBackdrop.hidden = true;
    lastFocusEl?.focus?.();
  }

  menuToggle?.addEventListener('click', () => {
    const expanded = menuToggle.getAttribute('aria-expanded') === 'true';
    expanded ? closeMenu() : openMenu();
  });

  menuClose?.addEventListener('click', closeMenu);
  menuBackdrop?.addEventListener('click', closeMenu);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuToggle?.getAttribute('aria-expanded') === 'true') {
      closeMenu();
    }
  });

  // Chiudi menu quando si clicca una action
  [btnPdf, btnPng, btnPrint].forEach(b => b?.addEventListener('click', closeMenu));

  // ---- Helpers ----
  async function ensureFontsReady() {
    // Aiuta a evitare export con font fallback
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch (_) {}
    }
  }

  async function capture(slideEl) {
    if (!window.html2canvas) throw new Error("html2canvas non è stato caricato.");

    const prevW = slideEl.style.width;
    const prevH = slideEl.style.height;

    slideEl.classList.add('is-exporting'); // niente radius in export

    slideEl.style.width  = SLIDE_W + 'px';
    slideEl.style.height = SLIDE_H + 'px';

    const canvas = await window.html2canvas(slideEl, {
      scale: SCALE,
      useCORS: true,
      logging: false, // <-- OTTIMIZZAZIONE 1: Spegne i log per sbloccare la velocità
      backgroundColor: '#ffffff'
    });

    slideEl.style.width  = prevW;
    slideEl.style.height = prevH;

    slideEl.classList.remove('is-exporting');

    return canvas;
  }

  function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement('a');
    a.download = filename;
    a.href = dataUrl;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---- PNG (Export della prima slide) ----
  btnPng?.addEventListener('click', async () => {
    if (!slides.length) return;
    btnPng.disabled = true;
    const prev = btnPng.textContent;
    btnPng.textContent = 'Genero PNG…';
    try {
      await ensureFontsReady();
      const canvas = await capture(slides[0]);
      downloadDataUrl(canvas.toDataURL('image/png'), `slide-1-${Date.now()}.png`);
    } catch (e) {
      console.error(e);
      alert('Errore durante export PNG. Vedi console.');
    } finally {
      btnPng.disabled = false;
      btnPng.textContent = prev || 'Salva Immagine';
    }
  });

  // ---- PDF multipagina ----
  btnPdf?.addEventListener('click', async () => {
    if (!slides.length) return;
    btnPdf.disabled = true;
    const prev = btnPdf.textContent;
    btnPdf.textContent = 'Genero PDF (Attendere)…';

    try {
      await ensureFontsReady();

      const jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
      if (!jsPDF) throw new Error("jsPDF non è stato caricato: controlla la rete o usa file locali.");

      const pageW = SLIDE_W * SCALE;
      const pageH = SLIDE_H * SCALE;

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'pt',
        format: [pageW, pageH]
      });

      for (let i = 0; i < slides.length; i++) {
        const canvas = await capture(slides[i]);
        // OTTIMIZZAZIONE 2: Usare JPEG (al 95% di qualità) per il PDF invece del PNG evita il blocco della RAM
        const img = canvas.toDataURL('image/jpeg', 0.95); 

        if (i > 0) pdf.addPage([pageW, pageH], 'landscape');
        pdf.addImage(img, 'JPEG', 0, 0, pageW, pageH);
      }

      pdf.save(`presentazione-16x9-${Date.now()}.pdf`);
    } catch (e) {
      console.error(e);
      alert('Errore durante la generazione del PDF. Vedi console.');
    } finally {
      btnPdf.disabled = false;
      btnPdf.textContent = prev || 'Esporta PDF';
    }
  });

  // ---- PRINT ----
  async function printAsImages() {
    await ensureFontsReady();

    const images = [];
    for (let i = 0; i < slides.length; i++) {
      const canvas = await capture(slides[i]);
      // OTTIMIZZAZIONE 3: Anche qui JPEG per non saturare la memoria in stampa
      images.push(canvas.toDataURL('image/jpeg', 0.95)); 
    }

    const w = window.open('', '_blank');
    if (!w) {
      alert("Popup bloccato: abilita i popup per stampare.");
      return;
    }

    w.document.open();
    w.document.write(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Print</title>
  <style>
    @page { size: A4 landscape; margin: 0; }
    html, body { margin:0; padding:0; background:#fff; }
    .page {
      width: 100vw;
      height: 100vh;
      page-break-after: always;
      break-after: page;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display:block;
    }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  </style>
</head>
<body>
  ${images.map(src => `<div class="page"><img src="${src}"></div>`).join('')}
  <script>
    window.onload = () => { setTimeout(() => { window.print(); }, 50); };
  <\/script>
</body>
</html>
    `);
    w.document.close();
  }

  btnPrint?.addEventListener('click', async () => {
    btnPrint.disabled = true;
    const prev = btnPrint.textContent;
    btnPrint.textContent = 'Preparo stampa…';
    try {
      await printAsImages();
    } catch (e) {
      console.error(e);
      alert("Errore durante la preparazione della stampa. Vedi console.");
    } finally {
      btnPrint.disabled = false;
      btnPrint.textContent = prev || 'Stampa Pro';
    }
  });

})();
