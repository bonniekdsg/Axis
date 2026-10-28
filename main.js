// AXIS — orquestração das animações de entrada.
// O CSS define toda a coreografia; este módulo só prepara o DOM e liga as
// classes de gatilho (.is-loaded na abertura, .is-in no scroll).

// Sinaliza ao failsafe do <head> que o módulo carregou.
window.__axisReady = true;

const root = document.documentElement;
const motionOK = matchMedia("(prefers-reduced-motion: no-preference)").matches;

// O que já está visível abaixo do hero entra depois dele, em cascata, e não
// junto: o olho lê a abertura primeiro.
const FOLD_STAGGER_MS = 700;
// Teto de espera por imagens antes de revelar um bloco.
const DECODE_TIMEOUT_MS = 1200;

// Rolagem horizontal fixada (seção de serviços).
// Abaixo dessa altura de janela (celular deitado) o palco não cabe; o
// carrossel nativo é mais usável.
const HSCROLL_MIN_VIEWPORT = 560;
const HSCROLL_CARD_MIN = 380;
const HSCROLL_CARD_MAX = 542;
// Respiro acima e abaixo do palco quando ele cabe na tela.
const HSCROLL_BREATHING = 32;
// Rolagem extra no fim, com os cards parados, antes de soltar a seção: o
// último card "assenta" antes da próxima seção chegar.
const HSCROLL_DWELL_RATIO = 0.15;
// Fração da distância percorrida por quadro (suaviza a roda do mouse).
const HSCROLL_EASE = 0.16;
// Barra de endereço do celular aparecendo/sumindo muda a altura em ~50–100px;
// isso não deve recalcular o palco no meio da rolagem.
const HSCROLL_RESIZE_THRESHOLD = 120;

// Atrasos de stagger vêm de data-delay (ms). Passam por CSSOM porque a CSP
// bloqueia atributos style inline.
for (const el of document.querySelectorAll("[data-delay]")) {
  el.style.setProperty("--d", `${Number(el.dataset.delay) || 0}ms`);
}

initNav();
initHorizontalScroll();

if (motionOK) {
  document.querySelectorAll("[data-split]").forEach(splitWords);
  playIntro().then(() => setTimeout(observeReveals, FOLD_STAGGER_MS));
}

/**
 * Quebra o texto em palavras, cada uma dentro de uma máscara, para que possam
 * subir de baixo da linha de base. O texto original fica no aria-label, então
 * leitores de tela leem a frase inteira, não palavra por palavra.
 */
function splitWords(el) {
  const text = el.textContent.trim().replace(/\s+/g, " ");
  const words = text.split(" ");
  const frag = document.createDocumentFragment();

  words.forEach((word, i) => {
    const mask = document.createElement("span");
    mask.className = "w";
    mask.setAttribute("aria-hidden", "true");

    const inner = document.createElement("span");
    inner.className = "w-i";
    inner.style.setProperty("--i", i);
    inner.textContent = word;

    mask.append(inner);
    frag.append(mask);
    if (i < words.length - 1) frag.append(" ");
  });

  el.setAttribute("aria-label", text);
  el.replaceChildren(frag);
  el.classList.add("is-split");
}

/**
 * Espera a fonte, a foto e a pessoa do hero (com teto de 900ms, para nunca
 * segurar a página em rede lenta) e só então abre a cena. Assim a animação
 * não roda por cima de uma troca de fonte ou de uma imagem ainda em branco.
 */
async function playIntro() {
  const heroImgs = document.querySelectorAll(
    "[data-intro-media] img, [data-intro-person] img",
  );
  const ready = Promise.all([
    document.fonts?.ready,
    ...[...heroImgs].map((img) => img.decode().catch(() => {})),
  ]);

  await Promise.race([ready, wait(900)]);
  await nextFrame();
  root.classList.add("is-loaded");
}

function observeReveals() {
  const targets = document.querySelectorAll("[data-reveal]");

  if (!("IntersectionObserver" in window)) {
    targets.forEach(reveal);
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        reveal(entry.target);
      }
    },
    { rootMargin: "0px 0px -12% 0px" },
  );

  targets.forEach((t) => io.observe(t));
}

/**
 * Revela um bloco só depois que as imagens dele estão decodificadas, para a
 * foto nunca "subir" em branco e aparecer no meio do movimento.
 */
async function reveal(el) {
  // Só as imagens à vista: cards fora da tela à direita não seguram a entrada.
  const visible = [...el.querySelectorAll("img")].filter(
    (img) => img.getBoundingClientRect().left < innerWidth,
  );
  const decoded = Promise.all(visible.map((img) => img.decode().catch(() => {})));
  await Promise.race([decoded, wait(DECODE_TIMEOUT_MS)]);
  el.classList.add("is-in");
}

/** Fundo translúcido na navegação assim que a página sai do topo. */
function initNav() {
  const nav = document.querySelector("[data-nav]");
  if (!nav) return;

  let scrolled = null;
  const update = () => {
    const next = window.scrollY > 8;
    if (next === scrolled) return;
    scrolled = next;
    nav.classList.toggle("is-scrolled", next);
  };

  addEventListener("scroll", update, { passive: true });
  update();
}

/**
 * Seção de serviços: ao chegar nela, a seção fixa na tela e a rolagem
 * vertical desliza os cards para o lado; no último card, a página volta a
 * rolar normalmente. A altura da seção vira "pista" de rolagem:
 * altura do palco + distância horizontal + uma pausa no fim.
 *
 * Sem movimento (ou em janela baixa demais), fica o carrossel nativo, e o
 * mesmo indicador acompanha o scrollLeft.
 */
function initHorizontalScroll() {
  const section = document.querySelector("[data-hscroll]");
  if (!section) return;

  const pin = section.querySelector("[data-hscroll-pin]");
  const viewport = section.querySelector("[data-hscroll-viewport]");
  const track = section.querySelector("[data-hscroll-track]");
  const count = section.querySelector("[data-hscroll-count]");
  const nav = document.querySelector("[data-nav]");
  const cards = [...track.children];
  const total = pad2(cards.length);

  let m = null;
  let current = 0;
  let target = 0;
  let frame = 0;
  let label = "";
  let size = { w: innerWidth, h: innerHeight };

  function measure() {
    section.classList.remove("is-pinned");
    section.style.removeProperty("height");
    section.style.removeProperty("--card-h");
    track.style.transform = "";

    const pinnable = motionOK && innerHeight >= HSCROLL_MIN_VIEWPORT;
    if (pinnable) section.classList.add("is-pinned");

    const viewW = viewport.clientWidth;
    let maxShift = track.offsetWidth - viewW;

    if (pinnable && maxShift > 0) {
      const navH = nav?.offsetHeight ?? 0;
      const avail = innerHeight - navH;

      // Tudo que não é card (cabeçalho, margens, indicador) fica fixo; o card
      // ocupa o resto, dentro dos limites.
      const chrome = pin.offsetHeight - cards[0].offsetHeight;
      const cardH = clamp(avail - chrome - HSCROLL_BREATHING, HSCROLL_CARD_MIN, HSCROLL_CARD_MAX);
      section.style.setProperty("--card-h", `${cardH}px`);

      // Cabe: centraliza na área útil. Não cabe: ancora pelo pé, para os
      // cards ficarem inteiros (o topo do cabeçalho passa sob a nav).
      const pinH = pin.offsetHeight;
      const top = pinH <= avail ? navH + (avail - pinH) / 2 : innerHeight - pinH;
      const dwell = Math.round(innerHeight * HSCROLL_DWELL_RATIO);

      maxShift = track.offsetWidth - viewW;
      section.style.height = `${pinH + maxShift + dwell}px`;
      section.style.setProperty("--hs-top", `${top}px`);

      const startY = section.getBoundingClientRect().top + scrollY - top;
      m = { pinned: true, maxShift, startY, viewW };
    } else {
      section.classList.remove("is-pinned");
      m = { pinned: false, maxShift: Math.max(0, viewport.scrollWidth - viewW), viewW };
    }

    m.cardX = cards.map((c) => c.offsetLeft);
    m.cardW = cards[0].offsetWidth;

    const frac = Math.min(1, viewW / track.offsetWidth);
    section.style.setProperty("--hs-frac", frac.toFixed(4));
    section.style.setProperty("--hs-k", ((1 - frac) / frac).toFixed(4));

    // Recalcular nunca anima: a trilha vai direto à posição certa.
    current = target = readTarget();
    paint();
  }

  function readTarget() {
    if (!m.pinned) return viewport.scrollLeft;
    return clamp((scrollY - m.startY) / m.maxShift, 0, 1) * m.maxShift;
  }

  function paint() {
    if (m.pinned) track.style.transform = `translate3d(${-current}px, 0, 0)`;
    section.style.setProperty("--hs-p", (m.maxShift ? current / m.maxShift : 0).toFixed(4));

    // Contagem: cards com ao menos metade à vista. "01–04 / 06" diz ao mesmo
    // tempo onde se está e quanto ainda falta.
    let first = 0;
    let last = 0;
    m.cardX.forEach((x, i) => {
      const left = x - current;
      const seen = Math.min(left + m.cardW, m.viewW) - Math.max(left, 0);
      if (seen >= m.cardW / 2) {
        if (!first) first = i + 1;
        last = i + 1;
      }
    });
    const next = first === last ? `${pad2(first)} / ${total}` : `${pad2(first)}–${pad2(last)} / ${total}`;
    if (first && next !== label) count.textContent = label = next;
  }

  function tick() {
    current += (target - current) * HSCROLL_EASE;
    if (Math.abs(target - current) < 0.5) current = target;
    paint();
    frame = current === target ? 0 : requestAnimationFrame(tick);
  }

  addEventListener(
    "scroll",
    () => {
      if (!m?.pinned) return;
      target = readTarget();
      if (!frame) frame = requestAnimationFrame(tick);
    },
    { passive: true },
  );

  viewport.addEventListener(
    "scroll",
    () => {
      if (m?.pinned) return;
      current = target = viewport.scrollLeft;
      paint();
    },
    { passive: true },
  );

  let resizeFrame = 0;
  addEventListener("resize", () => {
    const dw = innerWidth !== size.w;
    const dh = Math.abs(innerHeight - size.h) > HSCROLL_RESIZE_THRESHOLD;
    if ((!dw && !dh) || resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      size = { w: innerWidth, h: innerHeight };
      measure();
    });
  });

  // Cards fora da tela à direita não entrariam no lazy-load a tempo de
  // deslizar para dentro já carregados: ao se aproximar da seção, carrega.
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        track.querySelectorAll("img[loading='lazy']").forEach((img) => (img.loading = "eager"));
        io.disconnect();
      },
      { rootMargin: "100% 0px" },
    );
    io.observe(section);
  }

  measure();
  // A fonte final muda a altura do cabeçalho; remede quando chegar.
  document.fonts?.ready.then(measure);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
