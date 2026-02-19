(function() {
    // 1. Obtener el ID del cliente desde la URL del script
    const scriptTag = document.currentScript;
    const scriptUrl = new URL(scriptTag.src);
    const widgetId = scriptUrl.searchParams.get('id');

    if (!widgetId) {
        console.error("360 IA: Falta el Widget ID. Asegúrate de incluir ?id=TU_ID");
        return;
    }

    // 2. Estilos del Widget
    const style = document.createElement('style');
    style.innerHTML = `
        #ia360-button { position: fixed; bottom: 20px; right: 20px; width: 60px; height: 60px; background: #0070f3; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 15px rgba(0,0,0,0.2); z-index: 999999; transition: transform 0.3s; }
        #ia360-button:hover { transform: scale(1.1); }
        #ia360-container { position: fixed; bottom: 90px; right: 20px; width: 350px; height: 500px; background: white; border-radius: 15px; box-shadow: 0 5px 25px rgba(0,0,0,0.2); display: none; flex-direction: column; overflow: hidden; z-index: 999999; font-family: sans-serif; }
        #ia360-header { background: #0070f3; color: white; padding: 15px; font-weight: bold; display: flex; justify-content: space-between; }
        #ia360-messages { flex: 1; padding: 15px; overflow-y: auto; background: #f9f9f9; display: flex; flex-direction: column; gap: 10px; }
        .ia360-msg { padding: 8px 12px; border-radius: 10px; max-width: 80%; font-size: 14px; line-height: 1.4; }
        .user-msg { align-self: flex-end; background: #0070f3; color: white; }
        .bot-msg { align-self: flex-start; background: #e9e9eb; color: black; }
        #ia360-input-area { padding: 10px; border-top: 1px solid #eee; display: flex; gap: 5px; }
        #ia360-input { flex: 1; border: 1px solid #ddd; padding: 8px; border-radius: 5px; outline: none; }
        #ia360-send { background: #0070f3; color: white; border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer; }
    `;
    document.head.appendChild(style);

    // 3. Crear HTML del Widget
    const container = document.createElement('div');
    container.id = 'ia360-container';
    container.innerHTML = `
        <div id="ia360-header"><span>Asistente 360 IA</span><span style="cursor:pointer" id="ia360-close">✕</span></div>
        <div id="ia360-messages"></div>
        <div id="ia360-input-area">
            <input type="text" id="ia360-input" placeholder="Escribe tu duda...">
            <button id="ia360-send">Enviar</button>
        </div>
    `;
    document.body.appendChild(container);

    const button = document.createElement('div');
    button.id = 'ia360-button';
    button.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24" fill="white"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
    document.body.appendChild(button);

    // 4. Lógica de Interacción
    const msgContainer = document.getElementById('ia360-messages');
    const input = document.getElementById('ia360-input');
    const sendBtn = document.getElementById('ia360-send');

    button.onclick = () => {
        container.style.display = container.style.display === 'flex' ? 'none' : 'flex';
    };

    document.getElementById('ia360-close').onclick = () => container.style.display = 'none';

    async function sendMessage() {
        const text = input.value.trim();
        if (!text) return;

        // Agregar mensaje usuario
        msgContainer.innerHTML += `<div class="ia360-msg user-msg">${text}</div>`;
        input.value = '';
        msgContainer.scrollTop = msgContainer.scrollHeight;

        // Llamada al Worker
        try {
            const response = await fetch('https://360ia.estilosgrado33.workers.dev/api/chat', {
                method: 'POST',
                body: JSON.stringify({
                    widgetId: widgetId,
                    messages: [{ role: 'user', content: text }]
                })
            });

            const reader = response.body.getReader();
            const botMsgDiv = document.createElement('div');
            botMsgDiv.className = 'ia360-msg bot-msg';
            botMsgDiv.innerText = '...';
            msgContainer.appendChild(botMsgDiv);

            let fullText = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = new TextDecoder().decode(value);
                fullText += chunk;
                botMsgDiv.innerText = fullText;
                msgContainer.scrollTop = msgContainer.scrollHeight;
            }
        } catch (e) {
            msgContainer.innerHTML += `<div class="ia360-msg bot-msg">Error de conexión.</div>`;
        }
    }

    sendBtn.onclick = sendMessage;
    input.onkeypress = (e) => { if(e.key === 'Enter') sendMessage(); };

})();