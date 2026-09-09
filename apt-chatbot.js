(function () {
  "use strict";

  // ============================================================
  // CONFIGURACIÓN
  // ============================================================
  const WORKER_URL = "https://chat.algebraparatodos.com";

  // Se oculta si "qr" o "yt" aparece en cualquier parte del path.
  const EXCLUDE_SUBSTRINGS = ["qr", "yt"];
  const path = window.location.pathname.toLowerCase();
  const shouldHide = EXCLUDE_SUBSTRINGS.some((p) => path.includes(p));
  if (shouldHide) return;

  // ============================================================
  // EXPIRACIÓN DE SESIÓN E HISTORIAL (24 horas)
  // ============================================================
  const ACTIVITY_KEY = "apt_chat_last_activity";
  const SESSION_KEY = "apt_chat_session";
  const HISTORY_KEY = "apt_chat_history";
  const HISTORY_TTL_MS = 24 * 60 * 60 * 1000; // 1 día
  const HISTORY_MAX = 40; // tope para no dejar crecer el localStorage sin límite

  // ============================================================
  // QUIÉN ESTÁ DEL OTRO LADO
  //
  // Desde el 09/09/2026 la burbuja pide el nombre y el correo antes del
  // primer mensaje. El motivo, medido ese día sobre las charlas reales
  // de los tres bots vivos de la casa: 80 sesiones, 169 mensajes y CERO
  // contactos guardados. Pedirlo en mitad de la conversación depende de
  // que el modelo se acuerde; un formulario captura siempre.
  //
  // Se guarda también a quien pulsó "prefiero no dejarlo ahora", y por
  // el mismo motivo que a quien sí lo dejó: para no volver a
  // preguntárselo cada vez que abre la burbuja. Un formulario que
  // reaparece después de que alguien lo rechazó es la forma más rápida
  // de que cierre la ventana.
  const PERSONA_KEY = "apt_chat_persona";

  function leerPersona() {
    try {
      const crudo = localStorage.getItem(PERSONA_KEY);
      return crudo ? JSON.parse(crudo) : null;
    } catch (e) {
      return null;
    }
  }

  function guardarPersona(persona) {
    try {
      localStorage.setItem(PERSONA_KEY, JSON.stringify(persona));
    } catch (e) {
      // Sin almacenamiento se le vuelve a preguntar en la próxima
      // visita. Molesta, pero no rompe nada.
    }
  }

  // Deliberadamente flojo: esto no valida direcciones, sólo descarta lo
  // que es evidente que no lo es. Una comprobación estricta rechaza
  // direcciones válidas y raras, y el precio de equivocarse es perder
  // justo al contacto que veníamos a capturar. El Worker comprueba lo
  // mismo.
  function pareceEmail(valor) {
    const v = String(valor || "").trim();
    return v.length >= 6 && v.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  }

  function clearExpiredSessionIfNeeded() {
    try {
      const lastActivity = localStorage.getItem(ACTIVITY_KEY);
      if (lastActivity && Date.now() - Number(lastActivity) > HISTORY_TTL_MS) {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(HISTORY_KEY);
        localStorage.removeItem(ACTIVITY_KEY);
        // La persona NO se borra a propósito: la charla vence a las 24
        // horas, pero quién es no cambia. Borrarla haría que a la
        // segunda visita se le pidiera el correo otra vez, que es justo
        // lo que molesta de estos formularios.
      }
    } catch (e) {
      // Si localStorage no está disponible, no hay nada que limpiar.
    }
  }

  function touchActivity() {
    try {
      localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
    } catch (e) {}
  }

  clearExpiredSessionIfNeeded();

  // ============================================================
  // SESIÓN
  // ============================================================
  function generateId() {
    return (
      (crypto.randomUUID && crypto.randomUUID()) ||
      "sess-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
  }

  function getSessionId() {
    try {
      let id = localStorage.getItem(SESSION_KEY);
      if (!id) {
        id = generateId();
        localStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch (e) {
      console.warn("Mateo (chat): localStorage no disponible, usando sesión temporal.");
      return generateId();
    }
  }
  const sessionId = getSessionId();

  // ============================================================
  // HISTORIAL PERSISTENTE
  // ============================================================
  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(history) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_MAX)));
      touchActivity();
    } catch (e) {}
  }

  let conversationHistory = loadHistory();

  // ============================================================
  // ESTILOS
  // Los fonts (Arvo, Bitter) ya están cargados globalmente por el
  // sitio (ver el <link> de Google Fonts en el tracking code de
  // Kajabi) — no hace falta volver a cargarlos acá.
  // ============================================================
  const style = document.createElement("style");
  style.textContent = `
    #apt-chat-toggle {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: #48507D;
      border: 3px solid #FFFFFF;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
      z-index: 999998;
      font-size: 26px;
      color: #FFFFFF;
      transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
    }
    #apt-chat-toggle:hover {
      transform: scale(1.05);
      box-shadow: 0 8px 22px rgba(0, 0, 0, 0.3);
    }
    #apt-chat-toggle.hidden {
      opacity: 0;
      pointer-events: none;
      transform: scale(0.9);
    }

    #apt-chat-panel {
      position: fixed;
      top: var(--apt-header-offset, 0px);
      right: 0;
      width: 33.333vw;
      height: calc(100vh - var(--apt-header-offset, 0px));
      max-width: 100vw;
      background: #FFFFFF;
      box-shadow: -8px 0 40px rgba(0, 0, 0, 0.22);
      display: none;
      flex-direction: column;
      overflow: hidden;
      z-index: var(--apt-panel-z, 999999);
      font-family: 'Arvo', serif;
      border-left: 1px solid rgba(72, 80, 125, 0.25);
      transition: width 0.2s ease;
    }
    #apt-chat-panel.open { display: flex; }
    #apt-chat-panel.fullscreen {
      width: 100vw;
    }

    #apt-chat-header {
      background: #48507D;
      color: #FFFFFF;
      padding: 16px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    #apt-chat-header-title {
      font-family: 'Bitter', serif;
      font-size: 20px;
      font-weight: 600;
      line-height: 1.2;
    }
    #apt-chat-header-sub {
      font-family: 'Arvo', serif;
      font-size: 12px;
      opacity: 0.85;
      margin-top: 3px;
    }
    #apt-chat-header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #apt-chat-fullscreen,
    #apt-chat-close {
      background: none;
      border: none;
      color: #FFFFFF;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 6px;
      border-radius: 6px;
      transition: background 0.15s ease;
    }
    #apt-chat-fullscreen:hover,
    #apt-chat-close:hover {
      background: rgba(255, 255, 255, 0.15);
    }
    #apt-chat-fullscreen svg {
      width: 18px;
      height: 18px;
    }
    #apt-chat-close {
      font-size: 22px;
      line-height: 1;
    }

    #apt-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: #FFFFFF;
    }
    .apt-msg {
      max-width: 82%;
      padding: 10px 14px;
      border-radius: 14px;
      font-size: 15px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .apt-msg.bot {
      align-self: flex-start;
      background: #F0F0F3;
      color: #000000;
      border-bottom-left-radius: 4px;
    }
    .apt-msg.user {
      align-self: flex-end;
      background: #48507D;
      color: #FFFFFF;
      border-bottom-right-radius: 4px;
    }
    .apt-msg.typing {
      align-self: flex-start;
      background: #F0F0F3;
      color: #555555;
      font-style: italic;
      font-size: 13px;
    }
    .apt-msg a { color: inherit; text-decoration: underline; }

    /* La pantalla de presentación: lo primero que se ve al abrir. */
    #apt-chat-presentacion {
      display: none;
      flex-direction: column;
      padding: 22px 20px;
      overflow-y: auto;
      flex: 1;
      background: #FFFFFF;
      color: #000000;
      font-family: 'Arvo', serif;
    }
    #apt-chat-presentacion.visible { display: flex; }
    #apt-chat-presentacion p.intro {
      margin: 0 0 18px;
      font-size: 15px;
      line-height: 1.55;
    }
    #apt-chat-presentacion label {
      display: block;
      font-size: 13px;
      color: #555555;
      margin-bottom: 12px;
    }
    #apt-chat-presentacion input {
      display: block;
      width: 100%;
      box-sizing: border-box;
      margin-top: 5px;
      padding: 10px 16px;
      /* 16px como mínimo: con menos, Safari en iPhone hace zoom solo al
         tocar el campo y descuadra la página entera. */
      font-size: 16px;
      font-family: 'Arvo', serif;
      color: #000000;
      background: #FFFFFF;
      border: 1px solid rgba(0, 0, 0, 0.2);
      border-radius: 20px;
      outline: none;
    }
    #apt-chat-presentacion input:focus { border-color: #48507D; }
    #apt-chat-empezar {
      width: 100%;
      margin-top: 6px;
      padding: 12px 16px;
      font-family: 'Arvo', serif;
      font-size: 15px;
      color: #FFFFFF;
      background: #48507D;
      border: none;
      border-radius: 999px;
      cursor: pointer;
    }
    #apt-chat-empezar[disabled] { opacity: 0.4; cursor: default; }
    #apt-chat-empezar .girando {
      display: inline-block;
      width: 13px;
      height: 13px;
      margin-right: 7px;
      vertical-align: -2px;
      border: 2px solid rgba(255, 255, 255, 0.35);
      border-top-color: #FFFFFF;
      border-radius: 50%;
      animation: apt-girar 0.7s linear infinite;
    }
    @keyframes apt-girar { to { transform: rotate(360deg); } }
    #apt-chat-presentacion .pista {
      margin: 8px 0 0;
      font-size: 12px;
      color: #555555;
      text-align: center;
    }
    #apt-chat-saltar {
      margin-top: 18px;
      background: none;
      border: none;
      font-family: 'Arvo', serif;
      font-size: 12px;
      color: #555555;
      text-decoration: underline;
      cursor: pointer;
    }
    #apt-chat-presentacion .legal {
      margin: 22px 0 0;
      font-size: 11px;
      line-height: 1.5;
      color: #555555;
    }

    #apt-chat-inputbar {
      display: flex;
      gap: 8px;
      padding: 14px;
      background: #FFFFFF;
      border-top: 1px solid rgba(72, 80, 125, 0.2);
      flex-shrink: 0;
    }
    #apt-chat-input {
      flex: 1;
      border: 1px solid rgba(0, 0, 0, 0.2);
      border-radius: 20px;
      padding: 10px 16px;
      font-family: 'Arvo', serif;
      font-size: 15px;
      outline: none;
      background: #FFFFFF;
      color: #000000;
    }
    #apt-chat-input:focus { border-color: #48507D; }
    #apt-chat-send {
      background: #48507D;
      border: none;
      color: #FFFFFF;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    #apt-chat-send:disabled { opacity: 0.5; cursor: default; }
    #apt-chat-send svg { width: 16px; height: 16px; fill: #FFFFFF; }

    @media (prefers-reduced-motion: reduce) {
      #apt-chat-toggle, #apt-chat-panel { transition: none; }
    }

    /* Bloque de overrides mobile — AL FINAL a propósito: en CSS, entre
       reglas con la misma especificidad, gana la que aparece después
       en el texto. Poniéndolo acá abajo nos aseguramos de que esto
       nunca quede pisado por una regla anterior. */
    @media (max-width: 768px) {
      #apt-chat-toggle {
        opacity: 0.85;
        right: 16px;
        bottom: 16px;
      }
      #apt-chat-toggle:active {
        opacity: 1;
      }
      #apt-chat-panel {
        width: 100vw;
        height: calc(100dvh - var(--apt-header-offset, 0px));
      }
      #apt-chat-fullscreen {
        display: none;
      }
      #apt-chat-input {
        /* 16px o más evita el zoom automático de iOS Safari al enfocar */
        font-size: 16px;
      }
    }
  `;
  document.head.appendChild(style);

  // ============================================================
  // HTML
  // ============================================================
  const toggle = document.createElement("button");
  toggle.id = "apt-chat-toggle";
  toggle.setAttribute("aria-label", "Abrir chat con Mateo");
  toggle.innerHTML = "💬";

  const panel = document.createElement("div");
  panel.id = "apt-chat-panel";
  panel.innerHTML = `
    <div id="apt-chat-header">
      <div>
        <div id="apt-chat-header-title">¡Hola, soy Mateo!</div>
        <div id="apt-chat-header-sub">Preguntame sobre el libro o las clases ✨</div>
      </div>
      <div id="apt-chat-header-actions">
        <button id="apt-chat-fullscreen" aria-label="Pantalla completa" title="Pantalla completa">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
            <path d="M16 3h3a2 2 0 0 1 2 2v3"/>
            <path d="M8 21H5a2 2 0 0 1-2-2v-3"/>
            <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
          </svg>
        </button>
        <button id="apt-chat-close" aria-label="Cerrar chat">×</button>
      </div>
    </div>
    <div id="apt-chat-presentacion">
      <p class="intro">Antes de empezar, decime cómo te llamás y tu correo. Si veo que no puedo ayudarte, te va a contactar alguien del equipo lo antes posible.</p>
      <label>Nombre
        <input id="apt-chat-nombre" type="text" autocomplete="given-name" maxlength="120" aria-label="Nombre" placeholder="Cómo te llamás" />
      </label>
      <label>Correo
        <input id="apt-chat-email" type="email" inputmode="email" autocomplete="email" maxlength="200" aria-label="Correo" placeholder="tu@correo.com" />
      </label>
      <button id="apt-chat-empezar" type="button" disabled>Empezar a chatear</button>
      <p class="pista" id="apt-chat-pista">Escribí tu nombre y un correo para empezar.</p>
      <button id="apt-chat-saltar" type="button">Prefiero no dejarlo ahora</button>
      <p class="legal">Los datos son para que Juani pueda escribirte.</p>
    </div>
    <div id="apt-chat-messages"></div>
    <div id="apt-chat-inputbar">
      <input id="apt-chat-input" type="text" placeholder="Escribí tu consulta..." autocomplete="off" />
      <button id="apt-chat-send" aria-label="Enviar">
        <svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
      </button>
    </div>
  `;

  document.body.appendChild(toggle);
  document.body.appendChild(panel);

  const presentacionEl = panel.querySelector("#apt-chat-presentacion");
  const inputbarEl = panel.querySelector("#apt-chat-inputbar");
  const nombreEl = panel.querySelector("#apt-chat-nombre");
  const emailEl = panel.querySelector("#apt-chat-email");
  const empezarBtn = panel.querySelector("#apt-chat-empezar");
  const pistaEl = panel.querySelector("#apt-chat-pista");
  const saltarBtn = panel.querySelector("#apt-chat-saltar");
  const messagesEl = panel.querySelector("#apt-chat-messages");
  const inputEl = panel.querySelector("#apt-chat-input");
  const sendBtn = panel.querySelector("#apt-chat-send");
  const closeBtn = panel.querySelector("#apt-chat-close");
  const fullscreenBtn = panel.querySelector("#apt-chat-fullscreen");

  // Detección de mobile/touch: ancho de viewport + "pointer: coarse"
  // (dedo en vez de mouse) como red de seguridad adicional, por si
  // el <meta viewport> de la página no está bien configurado.
  const isTouchDevice =
    window.matchMedia("(max-width: 768px)").matches ||
    window.matchMedia("(pointer: coarse)").matches;

  // Estilo inline (no solo la regla CSS de @media): un inline style
  // gana pase lo que pase con el viewport reportado por la página.
  if (isTouchDevice) {
    fullscreenBtn.style.display = "none";
  }

  let opened = false;

  // ============================================================
  // OFFSET DEL HEADER DEL SITIO — para no taparlo, y que su menú
  // desplegable se vea siempre por encima del panel del chat.
  // ============================================================
  function findStickyHeaderEl() {
    const candidates = Array.from(
      document.querySelectorAll(
        "header, .header, .header__content, .header__content--desktop, .header__content--mobile, .announcement, .topbar, .nav, .navbar"
      )
    );

    return (
      candidates
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { el, r };
        })
        .filter((x) => x.r.top <= 20 && x.r.bottom > 0 && x.r.height > 30)
        .sort((a, b) => b.r.height - a.r.height)[0] || null
    );
  }

  function updateHeaderOffset() {
    const found = findStickyHeaderEl();
    const h = found ? Math.round(found.r.height) : 0;
    document.documentElement.style.setProperty("--apt-header-offset", h + "px");

    if (found) {
      found.el.style.zIndex = "1000000";
    }
    panel.style.zIndex = "500000";
    toggle.style.zIndex = "500000";
  }

  updateHeaderOffset();
  window.addEventListener("resize", updateHeaderOffset);

  let scrollTicking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (scrollTicking) return;
      scrollTicking = true;
      requestAnimationFrame(() => {
        updateHeaderOffset();
        scrollTicking = false;
      });
    },
    { passive: true }
  );

  // ============================================================
  // Escapado de HTML + linkify (nunca innerHTML directo con texto
  // sin escapar primero)
  // ============================================================
  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function linkify(text) {
    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    return text.replace(urlRegex, function (url) {
      let clean = url;
      let trailing = "";
      const m = clean.match(/[.,;:!?)]+$/);
      if (m) {
        trailing = m[0];
        clean = clean.slice(0, -trailing.length);
      }
      return (
        '<a href="' + clean + '" target="_blank" rel="noopener noreferrer">' + clean + "</a>" + trailing
      );
    });
  }

  function addMessage(text, who) {
    const div = document.createElement("div");
    div.className = "apt-msg " + who;
    div.innerHTML = linkify(escapeHTML(text));
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  // Si venimos de otra página con conversación en curso, reconstruimos
  // ya mismo (sin esperar a que se abra el panel) y marcamos "opened"
  // para no repetir el saludo inicial.
  if (conversationHistory.length > 0) {
    opened = true;
    conversationHistory.forEach(function (turn) {
      addMessage(turn.content, turn.role === "user" ? "user" : "bot");
    });
  }

  // Juani da UNA sola materia: Álgebra Lineal. El saludo nombraba también
  // Análisis Matemático I, que no da: es lo primero que lee todo el que
  // abre la burbuja, y después Mateo lo desmiente — su base de
  // conocimiento sí lo tiene bien. No volver a sumar materias acá: lo que
  // se ofrece se dice en el repo de conocimiento, no en este saludo.
  //
  // El "¿cómo te llamás?" del final sólo va cuando de verdad no lo
  // sabemos. Desde que existe el formulario de apertura, preguntárselo a
  // alguien que acaba de escribir su nombre dos renglones más arriba
  // hace quedar al bot como si no leyera.
  function saludo(persona) {
    const base =
      "¡Hola! Soy Mateo, el asistente de Juani Silva de Álgebra Para Todos. Puedo ayudarte " +
      "con dudas sobre el libro, las clases grupales de Álgebra Lineal, o los recursos gratuitos.";

    if (persona && persona.nombre) {
      return `¡Hola, ${persona.nombre}! Soy Mateo, el asistente de Juani Silva de Álgebra Para ` +
        "Todos. Puedo ayudarte con dudas sobre el libro, las clases grupales de Álgebra Lineal, " +
        "o los recursos gratuitos. ¿Qué querés saber?";
    }

    return base + " ¿Cómo te llamás?";
  }

  // El estado de la puerta de entrada. `null` mientras no sepamos quién
  // es: ahí se ve el formulario en lugar de la conversación.
  let persona = leerPersona();
  let presentando = false;

  // Quien ya tenía una charla empezada sigue como estaba. El día que
  // esto se despliega hay gente con una conversación guardada y sin
  // datos, porque cuando la empezó el formulario no existía: plantárselo
  // encima de lo que estaba hablando sería la peor forma de estrenarlo.
  // Se marca sólo en el navegador, sin avisarle al Worker, para que no
  // cuente como "prefirió no dejarlo" y ensucie la medición.
  if (persona === null && conversationHistory.length > 0) {
    persona = { enCurso: true };
  }

  function mostrarPresentacion(hayQuePresentarse) {
    presentacionEl.classList.toggle("visible", hayQuePresentarse);
    messagesEl.style.display = hayQuePresentarse ? "none" : "";
    inputbarEl.style.display = hayQuePresentarse ? "none" : "";
  }

  function revisarFormulario() {
    const listo = nombreEl.value.trim() !== "" && pareceEmail(emailEl.value);
    // El botón no se puede pulsar hasta que se pueda usar, y la pista
    // dice por qué antes de pulsarlo en vez de explicarlo después.
    empezarBtn.disabled = !listo || presentando;
    pistaEl.style.display = listo ? "none" : "";
    return listo;
  }

  nombreEl.addEventListener("input", revisarFormulario);
  emailEl.addEventListener("input", revisarFormulario);
  nombreEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") emailEl.focus();
  });
  emailEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && revisarFormulario()) presentarse();
  });
  empezarBtn.addEventListener("click", function () {
    if (revisarFormulario()) presentarse();
  });
  saltarBtn.addEventListener("click", function () {
    presentarse({ saltada: true });
  });

  /**
   * Guarda quién abrió el chat, o que prefirió no decirlo.
   *
   * Pase lo que pase se entra al chat. El Worker ya está escrito para no
   * fallar nunca acá, pero si la red se cae del todo esta persona tiene
   * que poder preguntar igual: un formulario de captación que deja a
   * alguien mirando una burbuja rota cuesta más que el contacto que
   * venía a capturar.
   */
  async function presentarse(saltar) {
    if (presentando) return;
    presentando = true;

    const saltada = !!(saltar && saltar.saltada);
    const datos = saltada
      ? { session_id: sessionId, saltada: true }
      : {
          session_id: sessionId,
          nombre: nombreEl.value.trim(),
          email: emailEl.value.trim(),
        };

    if (!saltada) {
      empezarBtn.disabled = true;
      empezarBtn.innerHTML = '<span class="girando"></span>Un momento...';
    }
    saltarBtn.disabled = true;

    try {
      await fetch(WORKER_URL + "/presentacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(datos),
      });
    } catch (e) {
      // Silencio a propósito: el contacto se pierde, la conversación no.
    }

    presentando = false;
    empezarBtn.textContent = "Empezar a chatear";
    saltarBtn.disabled = false;

    persona = saltada ? { saltada: true } : { nombre: datos.nombre, email: datos.email };
    guardarPersona(persona);

    mostrarPresentacion(false);
    if (!opened) {
      opened = true;
      addMessage(saludo(persona), "bot");
    }
    if (!isTouchDevice) inputEl.focus();
  }

  function openPanel() {
    updateHeaderOffset();
    panel.classList.add("open");
    toggle.classList.add("hidden");

    // Mientras no sepamos quién es, lo que se ve es el formulario y no
    // la conversación: es el único momento en que se puede pedir el
    // correo antes de que la persona se vaya.
    const hayQuePresentarse = persona === null;
    mostrarPresentacion(hayQuePresentarse);

    if (!hayQuePresentarse && !opened) {
      opened = true;
      addMessage(saludo(persona), "bot");
    }

    if (!isTouchDevice) {
      (hayQuePresentarse ? nombreEl : inputEl).focus();
    }
  }

  function closePanel() {
    panel.classList.remove("open");
    panel.classList.remove("fullscreen");
    toggle.classList.remove("hidden");
  }

  toggle.addEventListener("click", () => {
    if (panel.classList.contains("open")) {
      closePanel();
    } else {
      openPanel();
    }
  });
  closeBtn.addEventListener("click", closePanel);
  fullscreenBtn.addEventListener("click", () => {
    panel.classList.toggle("fullscreen");
  });

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text) return;

    addMessage(text, "user");
    inputEl.value = "";
    sendBtn.disabled = true;

    const typingEl = addMessage("Escribiendo...", "typing");

    try {
      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          session_id: sessionId,
          history: conversationHistory,
        }),
      });
      const data = await res.json();
      typingEl.remove();

      if (data.reply) {
        addMessage(data.reply, "bot");
        conversationHistory.push({ role: "user", content: text });
        conversationHistory.push({ role: "assistant", content: data.reply });
        saveHistory(conversationHistory);
      } else {
        addMessage(
          "Uy, algo no salió bien. Probá de nuevo o escribile a Juani por WhatsApp o email.",
          "bot"
        );
      }
    } catch (err) {
      typingEl.remove();
      addMessage(
        "No pude conectarme en este momento. Probá de nuevo en un rato, o escribile a Juani directo por WhatsApp o email.",
        "bot"
      );
    } finally {
      sendBtn.disabled = false;
      if (!isTouchDevice) inputEl.focus();
    }
  }

  sendBtn.addEventListener("click", sendMessage);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });
})();
