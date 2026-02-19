(function() {
    // 1. EXTRAER PARÁMETROS DE PERSONALIZACIÓN
    const scriptTag = document.currentScript;
    const scriptUrl = new URL(scriptTag.src);
    
    const widgetId = scriptUrl.searchParams.get('id');
    const customColor = scriptUrl.searchParams.get('color') || '#0070f3';
    const customPos = scriptUrl.searchParams.get('pos') || 'right: 20px';
    const customSize = scriptUrl.searchParams.get('size') || '60px';
    const customText = scriptUrl.searchParams.get('text') || '¿En qué puedo ayudarte?';

    if (!widgetId) return console.error("360 IA: Falta ID");

    // 2. ESTILOS DINÁMICOS
    const style = document.createElement('style');
    style.innerHTML = `
        #ia360-btn { 
            position: fixed; bottom: 20px; ${customPos}; 
            width: ${customSize}; height: ${customSize}; 
            background: ${customColor}; border-radius: 50%; 
            cursor: pointer; display: flex; align-items: center; justify-content: center; 
            box-shadow: 0 4px 15px rgba(0,0,0,0.2); z-index: 99999; transition: 0.3s; 
        }
        #ia360-chat { 
            position: fixed; bottom: 90px; ${customPos}; 
            width: 350px; height: 500px; background: white; 
            border-radius: 15px; box-shadow: 0 5px 25px rgba(0,0,0,0.2); 
            display: none; flex-direction: column; overflow: hidden; 
            z-index: 99999; font-family: 'Inter', sans-serif; border: 1px solid #ddd; 
        }
        #ia360-header { background: ${customColor}; color: white; padding: 15px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; }
        #ia360-msgs { flex: 1; padding: 15px; overflow-y: auto; background: #f9f9f9; display: flex; flex-direction: column; gap: 10px; }
        .msg { padding: 10px; border-radius: 10px; max-width: 80%; font-size: 14px; line-height: 1.4; word-wrap: break-word; }
        .user { align-self: flex-end; background: ${customColor}; color: white; border-bottom-right-radius: 2px; }
        .bot { align-self: flex-start; background: #e9e9eb; color: black; border-bottom-left-radius: 2px; }
        #ia360-input-area { padding: 10px; border-top: 1px solid #eee; display: flex; gap: 5px; background: white; }
        #ia360-in { flex: 1; border: 1px solid #ddd; padding: 10px; border-radius: 8px; outline: none; }
        #ia360-send { background: ${customColor}; color: white; border: none; padding: 10px 15px; border-radius: 8px; cursor: pointer; font-weight: bold; }
        
        /* Animación de escritura */
        .typing { font-style: italic; font-size: 12px; color: #666; }
    `;
    document.head.appendChild(style);

    // 3. ESTRUCTURA DEL CHAT
    const chat = document.createElement('div');
    chat.id = 'ia360-chat';
    chat.innerHTML = `
        <div id="ia360-header">
            <span>Asistente IA</span>
            <span id="ia360-close" style="cursor:pointer; font-size: 20px;">✕</span>
        </div>
        <div id="ia360-msgs">
            <div class="msg bot">${customText}</div>
        </div>
        <div id="ia360-input-area">
            <input type="text" id="ia360-in" placeholder="Escribe tu mensaje...">
            <button id="ia360-send">➤</button>
        </div>
    `;
    document.body.appendChild(chat);

    const btn = document.createElement('div');
    btn.id = 'ia360-btn';
    btn.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24" fill="white"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
    document.body.appendChild(btn);

    // 4. LÓGICA DE COMUNICACIÓN
    const msgs = document.getElementById('ia360-msgs');
    const input = document.getElementById('ia360-in');
    const send = document.getElementById('ia360-send');

    btn.onclick = () => {
        chat.style.display = chat.style.display === 'flex' ? 'none' : 'flex';
        input.focus();
    };
    
    document.getElementById('ia360-close').onclick = () => chat.style.display = 'none';

    async function hablar() {
        const query = input.value.trim();
        if (!query) return;

        input.value = '';
        msgs.innerHTML += `<div class="msg user">${query}</div>`;
        msgs.scrollTop = msgs.scrollHeight;

        // Crear burbuja del bot vacía para el streaming
        const botDiv = document.createElement('div');
        botDiv.className = 'msg bot';
        botDiv.innerHTML = '<span class="typing">Escribiendo...</span>';
        msgs.appendChild(botDiv);
        msgs.scrollTop = msgs.scrollHeight;

        try {
            const res = await fetch('https://360ia.estilosgrado33.workers.dev/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ widgetId, messages: [{ role: 'user', content: query }] })
            });

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let textoAcumulado = '';
            botDiv.innerText = ''; // Limpiar el "Escribiendo..."

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lineas = chunk.split('\n');

                for (let linea of lineas) {
                    linea = linea.trim();
                    // CORRECCIÓN: Filtrar solo la data de respuesta real
                    if (linea.startsWith('data: ') && linea !== 'data: [DONE]') {
                        try {
                            const strJson = linea.replace('data: ', '');
                            const json = JSON.parse(strJson);
                            if (json.response) {
                                textoAcumulado += json.response;
                                botDiv.innerText = textoAcumulado;
                            }
                        } catch (e) {
                            // Ignorar fragmentos que no sean JSON válido
                        }
                    }
                }
                msgs.scrollTop = msgs.scrollHeight;
            }
        } catch (e) {
            botDiv.innerText = "Lo siento, tuve un problema de conexión. Intenta de nuevo.";
        }
    }

    send.onclick = hablar;
    input.onkeypress = (e) => { if (e.key === 'Enter') hablar(); };
})();