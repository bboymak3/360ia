export interface Env {
  DB: D1Database;
  AI: any;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Configuración de CORS para que Dashboard y Widget funcionen
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 1. REGISTRO Y ESCANEO (Limpieza de datos profunda)
    if (url.pathname === "/api/registrar" && request.method === "POST") {
      try {
        const { nombre, email, url: siteUrl } = await request.json() as any;
        const resSite = await fetch(siteUrl);
        const html = await resSite.text();

        // Limpiamos el HTML para que la IA no se confunda con código basura
        const textoLimpio = html
          .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "")
          .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gmi, "")
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 4000);

        const widgetId = Math.random().toString(36).substring(2, 10);

        await env.DB.prepare(
          `INSERT INTO "360ia_db" (email_usuario, nombre_negocio, url_web_escaneada, contexto_entrenamiento, widget_id) VALUES (?, ?, ?, ?, ?)`
        ).bind(email, nombre, siteUrl, textoLimpio, widgetId).run();

        return new Response(JSON.stringify({ success: true, widgetId }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { 
          status: 500, headers: corsHeaders 
        });
      }
    }

    // 2. DATOS DEL CLIENTE (Para el Dashboard)
    if (url.pathname === "/api/datos-cliente" && request.method === "GET") {
      const id = url.searchParams.get("id");
      const data = await env.DB.prepare(`SELECT nombre_negocio, contexto_entrenamiento FROM "360ia_db" WHERE widget_id = ?`)
        .bind(id).first();

      if (data) {
        return new Response(JSON.stringify({
          success: true,
          nombre: data.nombre_negocio,
          contexto: data.contexto_entrenamiento
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: false }), { status: 404, headers: corsHeaders });
    }

    // 3. CHAT CON IA (EL PROMPT "PILAS" QUE NO INVENTA)
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const { widgetId, messages } = await request.json() as any;
        
        // Buscamos el contexto en la DB
        const data = await env.DB.prepare(`SELECT contexto_entrenamiento, nombre_negocio FROM "360ia_db" WHERE widget_id = ?`)
          .bind(widgetId).first();

        if (!data) return new Response("Widget no encontrado", { status: 404, headers: corsHeaders });

        // PROMPT DE ALTO NIVEL (Groundedness)
        const systemPrompt = `
          Eres el Asistente Experto de "${data.nombre_negocio}". 
          Tu única fuente de verdad es el CONTEXTO DE ENTRENAMIENTO que te doy abajo.

          REGLAS CRÍTICAS:
          1. NO INVENTAR: Si la respuesta no está en el CONTEXTO, di textualmente: "Lo siento, no tengo esa información a mano, pero puedo comunicarte con un asesor humano. ¿Te gustaría?".
          2. SOLO CONTEXTO: No uses conocimientos externos sobre precios, horarios o servicios que no estén escritos abajo.
          3. ESTILO: Sé profesional, amable y breve. Usa negritas para resaltar lo importante.
          4. PERSUASIÓN: Si el usuario muestra interés, anímalo a contactar al negocio.

          CONTEXTO DE ENTRENAMIENTO:
          "${data.contexto_entrenamiento}"
        `;

        // Usamos Llama-3 para mayor inteligencia siguiendo instrucciones
        const response = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          messages: [
            { role: "system", content: systemPrompt },
            ...messages
          ],
          stream: true,
        });

        return new Response(response, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });

      } catch (err: any) {
        return new Response(err.message, { status: 500, headers: corsHeaders });
      }
    }

    return new Response("Ruta no encontrada", { status: 404, headers: corsHeaders });
  }
};