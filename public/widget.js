(function() {
    // 1. Obtener el ID del cliente desde la URL del script
    const scriptTag = document.currentScript;
    const scriptUrl = new URL(scriptTag.src);
    const widgetId = scriptUrl.searchParams.get('id');

    if (!widgetId) {
        console.error("360 IA: Falta el Widget ID. Asegúrate de incluir ?id=TU_ID en el script.");
        return;
    }

    // 2. Estilos CSS del Widget (para el botón y la ventana de chat)
    const style = document.createElement('style');
    style.innerHTML = `
        /* Botón Flotante */
        #ia360-button {
            position: fixed; bottom: 20px; right: 20px; width: 60px; height: 60px;
            background: #0070f3; border-radius: 50%; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2); z-index: 999999;
            transition: transform 0.3s ease-in-out; /* Animación al pasar el mouse */
        }
        #ia360-button:hover { transform: scale(1.1); }
        #ia360-button svg { width: 30px; height: 30px; fill: white; } /* Icono del chat */

        /* Contenedor del Chat */
        #ia360-container {
            position: fixed; bottom: 90px; right: 20px; width: 350px; height: 500px;
            background: white; border-radius: 15px;
            box-shadow: 0 5px 25px rgba(0,0,0,0.2);
            display: none; /* Oculto por defecto */
            flex-direction: column; overflow: hidden; z-index: 999999;
            font-family: 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif; /* Fuente moderna */
            border: 1px solid #e0e0e0;
        }

        /* Encabezado del Chat */
        #ia360-header {
            background: #0070f3; color: white; padding: 15px; font-weight: bold;
            display: flex; justify-content: space-between; align-items: center;
            font-size: 16px;
        }
        #ia360-close { cursor: pointer; font-size: 20px; }

        /* Área de Mensajes */
        #ia360-messages {
            flex: 1; padding: 15px; overflow-y: auto; background: #f0f2f5;
            display: flex; flex-direction: column; gap: 10px;
            scroll-behavior: smooth; /* Desplazamiento suave */
        }
        .ia360-msg {
            padding: 10px 14px; border-radius: 18px; max-width: 80%;
            font-size: 14px; line-height: 1.4; word-wrap: break-word; /* Romper palabras largas */
            box-shadow: 0 1px 2px rgba(0,0,0,0.08); /* Sombra ligera */
        }
        .user-msg {
            align-self: flex-end; /* A la derecha */
            background: #0070f3; color: white;
            border-bottom-right-radius: 4px; /* Esquina menos redondeada */
        }
        .bot-msg {
            align-self: flex-start; /* A la izquierda */
            background: #ffffff; color: #333;
            border-bottom-left-radius: 4px; /* Esquina menos redondeada */
        }
        .ia360-loading {
            align-self: flex-start; background: #e0e0e0; color: #666; font-style: italic;
        }

        /* Área de Input de Mensajes */
        #ia360-input-area {
            padding: 10px; border-top: 1px solid #e0e0e0; display: flex; gap: 8px;
            background: #ffffff;
        }
        #ia360-input {
            flex: 1; border: 1px solid #ddd; padding: 10px; border-radius: 20px;
            outline: none; font-size: 14px;
            transition: border-color 0.2s;
        }
        #ia360-input:focus { border-color: #0070f3; }
        #ia360-send {
            background: #0070f3; color: white; border: none; padding: 10px 18px;
            border-radius: 20px; cursor: pointer; font-weight: bold; font-size: 14px;
            transition: background 0.2s;
        }
        #ia360-send:hover { background: #005bb5; }
        #ia360-send:disabled { background: #cccccc; cursor: not-allowed; }
    `;
    document.head.appendChild(style);

    // 3. Crear Estructura HTML del Widget
    const container = document.createElement('div');
    container.id = 'ia360-container';
    container.innerHTML = `
        <div id="ia360-header"><span>Asistente 360 IA</span><span id="ia360-close">✕</span></div>
        <div id="ia360-messages"></div>
        <div id="ia360-input-area">
            <input type="text" id="ia360-input" placeholder="Escribe tu duda...">
            <button id="ia360-send">Enviar</button>
        </div>
    `;
    document.body.appendChild(container);

    const button = document.createElement('div');
    button.id = 'ia360-button';
    // Icono de burbuja de chat SVG
    button.innerHTML = `
        <svg width="30" height="30" viewBox="0 0 24 24" fill="white">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
        </svg>
    `;
    document.body.appendChild(button);

    // 4. Lógica de Interacción (Abrir/Cerrar, Enviar Mensajes)
    const msgContainer = document.getElementById('ia360-messages');
    const input = document.getElementById('ia360-input');
    const sendBtn = document.getElementById('ia360-send');

    // Toggle para abrir/cerrar el chat
    button.onclick = () => {
        container.style.display = container.style.display === 'flex' ? 'none' : 'flex';
        if (container.style.display === 'flex') {
            msgContainer.scrollTop = msgContainer.scrollHeight; // Scroll al final al abrir
            input.focus(); // Poner el cursor en el input
        }
    };

    // Cerrar el chat
    document.getElementById('ia360-close').onclick = () => {
        container.style.display = 'none';
    };

    // Función para enviar mensajes
    async function sendMessage() {
        const text = input.value.trim();
        if (!text) return;

        // Desactivar input y botón para evitar múltiples envíos
        input.disabled = true;
        sendBtn.disabled = true;

        // Mostrar mensaje del usuario
        msgContainer.innerHTML += `<div class="ia360-msg user-msg">${text}</div>`;
        input.value = '';
        msgContainer.scrollTop = msgContainer.scrollHeight;

        // Mostrar mensaje "escribiendo..." del bot
        const botMsgDiv = document.createElement('div');
        botMsgDiv.className = 'ia360-msg bot-msg ia360-loading';
        botMsgDiv.innerText = 'Escribiendo...';
        msgContainer.appendChild(botMsgDiv);
        msgContainer.scrollTop = msgContainer.scrollHeight;

        try {
            const response = await fetch('https://360ia.estilosgrado33.workers.dev/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    widgetId: widgetId,
                    messages: [{ role: 'user', content: text }]
                })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';
            
            // Borramos el "Escribiendo..." y empezamos a llenar el mensaje del bot
            botMsgDiv.innerText = '';
            botMsgDiv.classList.remove('ia360-loading');

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                        try {
                            const jsonData = JSON.parse(line.replace('data: ', ''));
                            if (jsonData.response) {
                                fullText += jsonData.response;
                                botMsgDiv.innerText = fullText; // Actualiza el texto en tiempo real
                            }
                        } catch (e) {
                            // Ignorar errores de parseo si la línea no es JSON (ej. si hay lineas vacías)
                        }
                    }
                }
                msgContainer.scrollTop = msgContainer.scrollHeight; // Scroll hacia abajo
            }
        } catch (e) {
            botMsgDiv.innerText = "Lo siento, hubo un error de conexión con la IA.";
            botMsgDiv.classList.add('error'); // Opcional: añadir clase de error para estilo
            console.error("Error en chat API:", e);
        } finally {
            // Reactivar input y botón
            input.disabled = false;
            sendBtn.disabled = false;
            input.focus(); // Volver a poner el cursor para el siguiente mensaje
            msgContainer.scrollTop = msgContainer.scrollHeight;
        }
    }

    // Eventos de envío de mensaje (clic en botón o Enter)
    sendBtn.onclick = sendMessage;
    input.onkeypress = (e) => { if(e.key === 'Enter') sendMessage(); };

})();