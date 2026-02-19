(function() {
    // Obtenemos el Widget ID desde la URL del script
    const scriptTag = document.currentScript;
    const urlParams = new URLSearchParams(scriptTag.src.split('?')[1]);
    const widgetId = urlParams.get('id');

    if (!widgetId) return console.error("360 IA: Falta el Widget ID");

    // Crear el botón flotante
    const button = document.createElement('div');
    button.innerHTML = '💬';
    button.style = "position:fixed;bottom:20px;right:20px;width:60px;height:60px;background:#0070f3;color:white;border-radius:50%;display:flex;justify-content:center;align-items:center;cursor:pointer;font-size:30px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.2);";
    document.body.appendChild(button);

    // Crear el contenedor del chat (oculto al inicio)
    const chatBox = document.createElement('div');
    chatBox.style = "position:fixed;bottom:90px;right:20px;width:350px;height:450px;background:white;border-radius:15px;display:none;flex-direction:column;box-shadow:0 8px 24px rgba(0,0,0,0.15);z-index:9999;overflow:hidden;border:1px solid #eaeaea;";
    chatBox.innerHTML = `
        <div style="background:#0070f3;color:white;padding:15px;font-weight:bold;">Asistente 360 IA</div>
        <div id="360chat-content" style="flex:1;padding:15px;overflow-y:auto;font-family:sans-serif;font-size:14px;"></div>
        <div style="padding:10px;border-top:1px solid #eee;display:flex;">
            <input id="360chat-input" type="text" placeholder="Escribe tu duda..." style="flex:1;padding:8px;border:1px solid #ddd;border-radius:5px;outline:none;">
            <button id="360chat-send" style="margin-left:5px;background:#0070f3;color:white;border:none;padding:8px 15px;border-radius:5px;cursor:pointer;">Enviar</button>
        </div>
    `;
    document.body.appendChild(chatBox);

    // Lógica para abrir/cerrar
    button.onclick = () => {
        chatBox.style.display = chatBox.style.display === 'none' ? 'flex' : 'none';
    };

    // Lógica para enviar mensajes
    const input = chatBox.querySelector('#360chat-input');
    const sendBtn = chatBox.querySelector('#360chat-send');
    const content = chatBox.querySelector('#360chat-content');

    sendBtn.onclick = async () => {
        const text = input.value.trim();
        if (!text) return;

        content.innerHTML += `<div style="margin-bottom:10px;text-align:right;"><b>Tú:</b> ${text}</div>`;
        input.value = '';

        const res = await fetch('https://360ia.estilosgrado33.workers.dev/api/chat', {
            method: 'POST',
            body: JSON.stringify({ messages: [{role: 'user', content: text}], widgetId })
        });

        // Manejo de respuesta en streaming
        const reader = res.body.getReader();
        let aiMsg = document.createElement('div');
        aiMsg.style.marginBottom = "10px";
        aiMsg.innerHTML = `<b>IA:</b> `;
        content.appendChild(aiMsg);

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = new TextDecoder().decode(value);
            aiMsg.innerHTML += chunk;
            content.scrollTop = content.scrollHeight;
        }
    };
})();
