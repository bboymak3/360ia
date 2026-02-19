(function() {
    // 1. OBTENER EL ID DEL WIDGET DESDE EL SCRIPT
    const scriptTag = document.currentScript;
    const widgetId = new URL(scriptTag.src).searchParams.get('id');

    if (!widgetId) {
        console.error("360 IA: Falta el ID del widget en el script.");
        return;
    }

    // 2. ESTILOS DEL WIDGET (Diseño Profesional Azul)
    const style = document.createElement('style');
    style.innerHTML = `
        #ia360-container { font-family: 'Inter', -apple-system, sans-serif; position: fixed; bottom: 20px; right: 20px; z-index: 999999; }
        #ia360-btn { 
            width: 60px; height: 60px; background: #0070f3; border-radius: 50%; 
            display: flex; align-items: center; justify-content: center; cursor: pointer; 
            box-shadow: 0 4px 15px rgba(0,112,243,0.4); transition: transform 0.3s ease; 
        }
        #ia360-btn:hover { transform: scale(1.1); }
        #ia360-btn svg { width: 30px; fill: white; }

        #ia360-window { 
            display: none; position: fixed; bottom: 90px; right: 20px; 
            width: 350px; height: 500px; background: white; border-radius: 15px; 
            flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,0.2); 
            overflow: hidden; border: 1px solid #e2e8f0; 
        }
        #ia360-header { background: #0070f3; color: white; padding: 15px; font-weight: bold; display: flex; justify-content: space-between; }
        #ia360-msgs { flex: 1; padding: 15px; overflow-y: auto; background: #f8fafc; display: flex; flex-direction: column; gap: 10px; }
        
        .ia360-msg { padding: 10px 14px; border-radius: 15px; font-size: 14px; line-height: 1.5; max-width: 80%; }
        .ia360-msg.user { background: #0070f3; color: white; align-self: flex-end; border-bottom-right-radius: 2px; }
        .ia360-msg.bot { background: #e2e8f0; color: #1e293b; align-self: flex-start; border-bottom-left-radius: 2px; }

        #ia360-input-area { padding: 15px; border-top: 1px solid #eee; display: flex; gap: 8px; }
        #ia360-in { flex: 1; border: 1px solid #ddd; padding: 10px; border-radius: 8px; outline: none; }
        #ia360-in:focus { border-color: #0070f3; }
        #ia360-send { background: #0070f3; color: white; border: none; padding: 8px 15px; border-radius: 8px; cursor: pointer; font-weight: bold; }
        
        @media (max-width: 400px) {
            #ia360-window { width: 90%; right: 5%; left: 5%; bottom: 85px; height: 70vh; }
        }
    `;
    document.head.appendChild(style);

    // 3. ESTRUCTURA HTML
    const container = document.createElement('div');
    container.id = 'ia360-container';
    container.innerHTML = `
        <div id="ia360-window">
            <div id="ia360-header">
                <span>Asistente 360 IA</span>
                <span id="ia360-close" style="cursor:pointer">✕</span>
            </div>
            <div id="ia360-msgs">
                <div class="ia360-msg bot">¡Hola! ¿En qué puedo ayudarte hoy?</div>
            </div>
            <div id="ia360-input-area">
                <input type="text" id="ia360-in" placeholder="Escribe tu duda...">
                <button id="ia360-send">➤</button>
            </div>
        </div>
        <div id="ia360-btn">
            <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
        </div>
    `;
    document.body.appendChild(container);

    // 4. LÓGICA DE FUNCIONAMIENTO
    const btn = document.getElementById('ia360-btn');
    const win = document.getElementById('ia360-window');
    const close = document.getElementById('ia360-close');
    const msgs = document.getElementById('ia360-msgs');
    const input = document.getElementById('ia360-in');
    const send = document.getElementById('ia360-send');

    btn.onclick = () => win.style.display = win.style.display === 'flex' ? 'none' : 'flex';
    close.onclick = () => win.style.display = 'none';

    async function enviarMensaje() {
        const texto = input.value.trim();
        if (!texto) return;

        input.value = '';
        // Mensaje del usuario
        msgs.innerHTML += `<div class="ia360-msg user">${texto}</div>`;
        msgs.scrollTop = msgs.scrollHeight;

        // Burbuja del Bot (vacía esperando el stream)
        const botMsgDiv = document.createElement('div');
        botMsgDiv.className = 'ia360-msg bot';
        botMsgDiv.innerText = '...';
        msgs.appendChild(botMsgDiv);
        msgs.scrollTop = msgs.scrollHeight;

        try {
            const response = await fetch('https://360ia.estilosgrado33.workers.dev/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    widgetId: widgetId,
                    messages: [{ role: 'user', content: texto }]
                })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let respuestaAcumulada = '';
            botMsgDiv.innerText = ''; // Limpiamos los puntos suspensivos

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (let line of lines) {
                    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                        try {
                            const data = JSON.parse(line.substring(6));
                            if (data.response) {
                                respuestaAcumulada += data.response;
                                botMsgDiv.innerText = respuestaAcumulada;
                                msgs.scrollTop = msgs.scrollHeight;
                            }
                        } catch (e) { /* Ignorar errores de parseo de chunks incompletos */ }
                    }
                }
            }
        } catch (error) {
            botMsgDiv.innerText = "Lo siento, hubo un error de conexión.";
        }
    }

    send.onclick = enviarMensaje;
    input.onkeypress = (e) => { if (e.key === 'Enter') enviarMensaje(); };
})();