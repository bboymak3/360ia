export interface Env {
  DB: D1Database;
  AI: any;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 1. RUTA: LOGIN (FUNDAMENTAL PARA ENTRAR AL DASHBOARD)
    if (url.pathname === "/api/login" && request.method === "POST") {
      try {
        const { email } = await request.json() as any;
        // Buscamos al usuario por su email para obtener su ID único
        const data = await env.DB.prepare(`SELECT widget_id FROM "360ia_db" WHERE email_usuario = ?`)
          .bind(email).first();

        if (data) {
          return new Response(JSON.stringify({ success: true, widgetId: data.widget_id }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        } else {
          return new Response(JSON.stringify({ success: false, message: "Email no registrado" }), { 
            status: 404, headers: corsHeaders 
          });
        }
      } catch (err: any) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { 
          status: 500, headers: corsHeaders 
        });
      }
    }

    // 2. RUTA: REGISTRO Y ESCANEO
    if (url.pathname === "/api/registrar" && request.method === "POST") {
      try {
        const { nombre, email, url: siteUrl } = await request.json() as any;
        const resSite = await fetch(siteUrl);
        const html = await resSite.text();

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
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 3. RUTA: DATOS DEL CLIENTE (Para el Dashboard)
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

    // 4. RUTA: CHAT CON IA (EL PROMPT "PILAS")
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const { widgetId, messages } = await request.json() as any;
        const data = await env.DB.prepare(`SELECT contexto_entrenamiento, nombre_negocio FROM "360ia_db" WHERE widget_id = ?`)
          .bind(widgetId).first();

        if (!data) return new Response("Widget no encontrado", { status: 404, headers: corsHeaders });

        const systemPrompt = `Eres el Asistente Experto de "${data.nombre_negocio}". 
        Tu única fuente de verdad es el CONTEXTO DE ENTRENAMIENTO abajo. 
        Si no está ahí, di que no sabes y ofrece un humano. NO INVENTES.
        CONTEXTO: "${data.contexto_entrenamiento}"`;

        const response = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          stream: true,
        });

        return new Response(response, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      } catch (err: any) {
        return new Response(err.message, { status: 500, headers: corsHeaders });
      }
    }

    return new Response("No encontrado", { status: 404, headers: corsHeaders });
  }
};