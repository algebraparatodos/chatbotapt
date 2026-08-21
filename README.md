# chatbotapt — la burbuja de Mateo

**Este repo es público a propósito, y tiene que seguir siéndolo.**

`algebraparatodos.com` carga `apt-chatbot.js` directamente desde
`raw.githubusercontent.com/algebraparatodos/chatbotapt/main/`, que **no
sirve repos privados**. Si este repo se cierra, el chatbot desaparece de la
web sin dar ningún error.

Acá vive únicamente el código que corre en el navegador. Todo lo que Mateo
sabe —precios, fechas, preguntas frecuentes, tono— está en el repo
**privado** `chatbots-conocimiento`, y lo lee el Worker con un token de
sólo lectura. Nada de eso pasa por este repo.

## Sobre el historial

El historial arranca el 21/08/2026. Se creó limpio a propósito: el repo
anterior conservaba en sus versiones viejas los archivos de conocimiento
que después se hicieron privados. El original quedó respaldado fuera de
GitHub.
