(function() {
    const scriptTag = document.currentScript;
    const scriptUrl = new URL(scriptTag.src);
    const widgetId = scriptUrl.searchParams.get('id');

    if (!widgetId) return console.error("360 IA: Falta ID");

    // Estilos
    const style = document.createElement('style');
    style.innerHTML = `
        #ia360-btn { position: fixed; bottom: 20px; right: 20px; width: 60px; height: 60px; background: #0070f3; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 15px rgba(0,0,0,0.2); z-index: 9999; transition: 0.3s; }
        #ia360-chat { position: fixed; bottom: 90px; right: 20px; width: 350px; height: 500px; background: white; border-radius: 15px; box-shadow: 0 5px 25px rgba(0,0,0,0.2); display: none; flex-direction: column; overflow: hidden; z-index: 9999; font-family: sans-serif; border: 1px solid #ddd; }
        #ia360-header { background: #0070f3; color: white; padding: 15px; font-weight: bold; display: flex; justify-content: space-between; }
        #ia360-msgs { flex: 1; padding: 15px; overflow-y: auto; background: #f9f9f9; display: flex; flex-direction: column; gap: 10px; }
        .msg { padding: 10px; border-radius: 10px; max-width: 80%; font-size: 14px; }
        .user { align-self: flex-end; background: #0070f3; color: white; }
        .bot { align-self: flex-start; background: #e9e9eb; color: black; }
        #ia360-input-area { padding: 10px; border-top: 1px solid #eee; display: flex; gap: 5px; }
        #ia360-in { flex: 1; border: 1px solid #ddd; padding: 10px; border-radius: 5px; outline: none; }
        #ia360-send { background: #0070f3; color: white; border: none; padding: 10px; border-radius: 5px; cursor: pointer; }
    `;
    document.head.appendChild(style);

    // Estructura
    const chat = document.createElement('div');
    chat.id = 'ia360-chat';
    chat.innerHTML = `
        <div id="ia360-header"><span>Asistente 360 IA</span><span id="ia360-close" style="cursor:pointer">✕</span></div>
        <div id="ia360-msgs"></div>
        <div id="ia360-input-area">
            <input type="text" id="ia360-in" placeholder="Pregúntame algo...">
            <button id="ia360-send">Enviar</button>
        </div>
    `;
    document.body.appendChild(chat);

    const btn = document.createElement('div');
    btn.id = 'ia360-btn';
    btn.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24" fill="white"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
    document.body.appendChild(btn);

    // Lógica
    const msgs = document.getElementById('ia360-msgs');
    const input = document.getElementById('ia360-in');
    const send = document.getElementById('ia360-send');

    btn.onclick = () => chat.style.display = chat.style.display === 'flex' ? 'none' : 'flex';
    document.getElementById('ia360-close').onclick = () => chat.style.display = 'none';

    async function hablar() {
        const query = input.value.trim();
        if (!query) return;

        input.value = '';
        msgs.innerHTML += `<div class="msg user">${query}</div>`;
        msgs.scrollTop = msgs.scrollHeight;

        const botDiv = document.createElement('div');
        botDiv.className = 'msg bot';
        botDiv.innerText = '...';
        msgs.appendChild(botDiv);

        try {
            const res = await fetch('https://360ia.estilosgrado33.workers.dev/api/chat', {
                method: 'POST',
                body: JSON.stringify({ widgetId, messages: [{ role: 'user', content: query }] })
            });

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let textoAcumulado = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lineas = chunk.split('\n');

                for (let linea of lineas) {
                    linea = linea.trim();
                    // AQUÍ ESTÁ EL TRUCO: Solo procesamos si empieza con data: y NO es el cierre [DONE]
                    if (linea.startsWith('data: ') && linea !== 'data: [DONE]') {
                        try {
                            const json = JSON.parse(linea.replace('data: ', ''));
                            if (json.response) {
                                textoAcumulado += json.response;
                                botDiv.innerText = textoAcumulado; // Mostramos solo el texto limpio
                            }
                        } catch (e) { 
                            // Ignora líneas que no sean JSON válido
                        }
                    }
                }
                msgs.scrollTop = msgs.scrollHeight;
            }
        } catch (e) {
            botDiv.innerText = "Error de conexión.";
        }
    }

    send.onclick = hablar;
    input.onkeypress = (e) => { if (e.key === 'Enter') hablar(); };
})();