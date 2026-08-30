// ==========================================================
//  DOM — los cuatro atajos que usa todo el mundo
// ==========================================================

export const $ = id => document.getElementById(id);
export const $$ = sel => [...document.querySelectorAll(sel)];

/** La línea de estado del módulo Repostar. */
export const statusEl = () => $('status');

/** Escribe en esa línea. `clase` puede ser 'ok', 'aviso' u 'oro'. */
export const info = (html, clase) => {
  const el = statusEl();
  if (!el) return;
  el.innerHTML = clase ? '<span class="' + clase + '">' + html + '</span>' : html;
};

/** Una línea de aviso o error, del mismo tamaño en todas partes. */
export const lineaAviso = t =>
  '<div class="aviso" style="font-size:.79rem;margin-bottom:6px;line-height:1.45">' + t + '</div>';
