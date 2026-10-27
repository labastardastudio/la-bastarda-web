# La Bastarda Studio · web

Pàgina estàtica (`index.html`) amb un panell d'edició a `/admin` (Decap CMS).

- **Continguts editables** a `content/`: `blog/*.json`, `cookies.json`, `preus.json`, `textos.json`.
  Es canvien des del panell; no cal tocar aquests fitxers a mà.
- **`build.js`** converteix `content/` en `content.js`, que és el que llegeix la pàgina.
  Netlify l'executa sol a cada canvi (`netlify.toml`). Per provar-ho a l'ordinador: `node build.js`.
- **Fotos**: les de la web són a `img/`; les que es pugen des del panell van a `img/uploads/`.
  Millor pujar-les a menys de 2000 px pel costat llarg (JPG o WebP), perquè la web carregui ràpid.
- **Cursives**: als textos, una paraula entre asteriscs (`*així*`) surt en cursiva.

## Configuració, un sol cop
1. `admin/config.yml` ja apunta a `labastardastudio/la-bastarda-web`.
2. A Netlify, connecta el repositori i activa l'inici de sessió amb GitHub
   (Site configuration → Access & security → OAuth → GitHub).

## Provar el panell a l'ordinador
`npx decap-server` en aquesta carpeta i, en una altra finestra, un servidor local (per exemple `npx serve`);
després obre `http://localhost:3000/admin/`.
