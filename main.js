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

// Atrasos de stagger vêm de data-delay (ms). Passam por CSSOM porque a CSP
// bloqueia atributos style inline.
for (const el of document.querySelectorAll("[data-delay]")) {
  el.style.setProperty("--d", `${Number(el.dataset.delay) || 0}ms`);
}

initNav();

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
  const decoded = Promise.all(
    [...el.querySelectorAll("img")].map((img) => img.decode().catch(() => {})),
  );
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
