export interface Env {
  DB: D1Database;
  AI: any;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Cabeceras CORS para permitir conexión desde el Dashboard y Widget
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Manejo de pre-vuelo OPTIONS para CORS
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // --- RUTA 1: REGISTRO Y ESCANEO ---
    if (url.pathname === "/api/registrar" && request.method === "POST") {
      try {
        const { nombre, email, url: siteUrl } = await request.json() as any;
        
        // Escaneo simple del sitio
        const response = await fetch(siteUrl);
        const html = await response.text();

        // Limpieza de HTML para dejar solo texto útil
        const textoLimpio = html
          .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "")
          .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gmi, "")
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 4000);

        const widgetId = Math.random().toString(36).substring(2, 10);

        // Guardar en D1
        await env.DB.prepare(
          `INSERT INTO "360ia_db" (email_usuario, nombre_negocio, url_web_escaneada, contexto_entrenamiento, widget_id) VALUES (?, ?, ?, ?, ?)`
        ).bind(email, nombre, siteUrl, textoLimpio, widgetId).run();

        return new Response(JSON.stringify({ success: true, widgetId }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { 
          status: 500, 
          headers: corsHeaders 
        });
      }
    }

    // --- RUTA 2: LOGIN (Obtener ID del usuario) ---
    if (url.pathname === "/api/login" && request.method === "POST") {
      try {
        const { email } = await request.json() as any;
        const data = await env.DB.prepare(`SELECT widget_id FROM "360ia_db" WHERE email_usuario = ?`)
          .bind(email).first();

        if (data) {
          return new Response(JSON.stringify({ success: true, widgetId: data.widget_id }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        return new Response(JSON.stringify({ success: false, message: "Usuario no encontrado" }), { 
          status: 404, 
          headers: corsHeaders 
        });
      } catch (err: any) {
        return new Response(err.message, { status: 500, headers: corsHeaders });
      }
    }

    // --- RUTA 3: DATOS PARA EL DASHBOARD ---
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

    // --- RUTA 4: CHAT CON STREAMING (Para Dashboard y Widget) ---
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const { widgetId, messages } = await request.json() as any;
        const data = await env.DB.prepare(`SELECT contexto_entrenamiento FROM "360ia_db" WHERE widget_id = ?`)
          .bind(widgetId).first();

        if (!data) return new Response("Error: Widget no encontrado", { status: 404, headers: corsHeaders });

        const systemPrompt = `Eres el asistente de IA oficial. Responde basado en: ${data.contexto_entrenamiento}`;

        const stream = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          stream: true,
        });

        return new Response(stream, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      } catch (err: any) {
        return new Response(err.message, { status: 500, headers: corsHeaders });
      }
    }

    return new Response("Ruta no encontrada", { status: 404, headers: corsHeaders });
  }
};