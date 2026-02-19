// 2. API: REGISTRO Y SCRAPING (Mejorado para limpiar basura)
if (url.pathname === "/api/registrar" && request.method === "POST") {
    try {
        const { nombre, email, url: siteUrl } = await request.json() as any;

        const response = await fetch(siteUrl);
        const html = await response.text();

        // --- INICIO DE LIMPIEZA PROFUNDA ---
        let textoLimpio = html
            .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "") // Quita Scripts (Google Analytics, etc)
            .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gmi, "")   // Quita CSS (Estilos)
            .replace(/<[^>]*>/g, ' ')                              // Quita etiquetas HTML
            .replace(/\s+/g, ' ')                                  // Quita espacios extras
            .trim();
        
        // Solo nos quedamos con los primeros 5000 caracteres de TEXTO REAL
        textoLimpio = textoLimpio.substring(0, 5000);
        // --- FIN DE LIMPIEZA ---

        const widgetId = Math.random().toString(36).substring(2, 10);

        await env.DB.prepare(
            `INSERT INTO "360ia_db" (email_usuario, nombre_negocio, url_web_escaneada, contexto_entrenamiento, widget_id) VALUES (?, ?, ?, ?, ?)`
        ).bind(email, nombre, siteUrl, textoLimpio, widgetId).run();

        return new Response(JSON.stringify({ success: true, widgetId }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });

    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
    }
}