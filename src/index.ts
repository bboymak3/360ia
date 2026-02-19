export interface Env {
  DB: D1Database;
  AI: any;
}

type Intencion = 'factual' | 'comparar' | 'precio' | 'soporte' | 'objecion' | 'general';
type EtapaFunnel = 'descubrimiento' | 'consideracion' | 'decision' | 'postventa';

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

    // 1. LOGIN
    if (url.pathname === "/api/login" && request.method === "POST") {
      try {
        const { email } = await request.json() as any;
        const data = await env.DB.prepare(
          `SELECT widget_id, nombre_negocio FROM "360ia_db" WHERE email_usuario = ?`
        ).bind(email).first();

        if (data) {
          return new Response(JSON.stringify({ 
            success: true, 
            widgetId: data.widget_id,
            nombre: data.nombre_negocio
          }), {
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

    // 2. REGISTRO CON SCRAPING INTELIGENTE
    if (url.pathname === "/api/registrar" && request.method === "POST") {
      try {
        const { nombre, email, url: siteUrl } = await request.json() as any;
        console.log(`[SCRAPING] Iniciando scan de: ${siteUrl}`);
        
        const html = await scrapeInteligente(siteUrl);
        if (html.length < 100) throw new Error("No se pudo obtener contenido válido de la web");

        const datosExtraidos = extraerDatosDetallados(html, siteUrl);
        const textoLimpio = limpiarHTMLPreservandoDatos(html, datosExtraidos);

        if (textoLimpio.length < 50) throw new Error("No se pudo extraer contenido procesable");

        const existente = await env.DB.prepare(
          `SELECT widget_id FROM "360ia_db" WHERE email_usuario = ?`
        ).bind(email).first();

        let widgetId: string;
        let esNuevo: boolean;

        if (existente) {
          widgetId = existente.widget_id as string;
          esNuevo = false;
          await env.DB.prepare(`
            UPDATE "360ia_db" SET nombre_negocio = ?, url_web_escaneada = ?, contexto_entrenamiento = ?
            WHERE email_usuario = ?
          `).bind(nombre, siteUrl, textoLimpio, email).run();
        } else {
          widgetId = Math.random().toString(36).substring(2, 10);
          esNuevo = true;
          await env.DB.prepare(`
            INSERT INTO "360ia_db" (email_usuario, nombre_negocio, url_web_escaneada, contexto_entrenamiento, widget_id)
            VALUES (?, ?, ?, ?, ?)
          `).bind(email, nombre, siteUrl, textoLimpio, widgetId).run();
        }

        return new Response(JSON.stringify({ 
          success: true, widgetId, esNuevo, 
          stats: { whatsapp: datosExtraidos.whatsapp, telefonos: datosExtraidos.telefonos, precios: datosExtraidos.precios.slice(0, 5) }
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (err: any) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 3. RE-SCAN INTELIGENTE
    if (url.pathname === "/api/rescan" && request.method === "POST") {
      try {
        const { widgetId } = await request.json() as any;
        const actual = await env.DB.prepare(`SELECT * FROM "360ia_db" WHERE widget_id = ?`).bind(widgetId).first();
        if (!actual) return new Response(JSON.stringify({ success: false, error: "No encontrado" }), { status: 404, headers: corsHeaders });

        const html = await scrapeInteligente(actual.url_web_escaneada as string);
        const datosExtraidos = extraerDatosDetallados(html, actual.url_web_escaneada as string);
        const nuevoTexto = limpiarHTMLPreservandoDatos(html, datosExtraidos);

        await env.DB.prepare(`UPDATE "360ia_db" SET contexto_entrenamiento = ? WHERE widget_id = ?`).bind(nuevoTexto, widgetId).run();

        return new Response(JSON.stringify({ success: true, timestamp: new Date().toISOString() }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (err: any) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 4. DATOS DEL CLIENTE
    if (url.pathname === "/api/datos-cliente" && request.method === "GET") {
      const id = url.searchParams.get("id");
      const data = await env.DB.prepare(`SELECT * FROM "360ia_db" WHERE widget_id = ?`).bind(id).first();
      if (data) return new Response(JSON.stringify({ success: true, nombre: data.nombre_negocio, contexto: data.contexto_entrenamiento, url: data.url_web_escaneada }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ success: false }), { status: 404, headers: corsHeaders });
    }

    // 5. CHAT CON IA NATURAL
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const { widgetId, messages, historialResumido } = await request.json() as any;
        const data = await env.DB.prepare(`SELECT * FROM "360ia_db" WHERE widget_id = ?`).bind(widgetId).first();
        if (!data) return new Response("No encontrado", { status: 404, headers: corsHeaders });

        const ultimoMensaje = messages[messages.length - 1]?.content || "";
        const analisisIntencion = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          messages: [{ role: "system", content: "Analiza mensaje. Responde SOLO JSON: {\"intencion\": \"factual|comparar|precio|soporte|objecion|general\", \"etapa\": \"descubrimiento|consideracion|decision|postventa\", \"busca_contacto\": true|false, \"busca_precio\": true|false}" }, { role: "user", content: ultimoMensaje }],
          max_tokens: 200
        });

        let metadatos = JSON.parse(analisisIntencion.response.replace(/```json|```/g, '').trim());
        const promptEspecializado = generarPromptNatural(metadatos.intencion, metadatos.etapa, data.nombre_negocio as string, data.contexto_entrenamiento as string, historialResumido, metadatos.busca_contacto, metadatos.busca_precio);

        const response = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          messages: [{ role: "system", content: promptEspecializado }, ...messages],
          stream: true,
          max_tokens: 800
        });

        return new Response(response, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
      } catch (err: any) {
        return new Response(err.message, { status: 500, headers: corsHeaders });
      }
    }

    // 6. RESUMEN IA
    if (url.pathname === "/api/resumen-ia" && request.method === "POST") {
      try {
        const { contexto, nombreNegocio } = await request.json() as any;
        const resumen = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          messages: [{ role: "system", content: "Genera 4 bullet points. Responde SOLO JSON: {\"puntos\": [\"...\", \"...\", \"...\", \"...\"]}" }, { role: "user", content: `Negocio: ${nombreNegocio}\nContexto: ${contexto.substring(0, 4000)}` }],
          max_tokens: 400
        });
        return new Response(resumen.response, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (err: any) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    return new Response("No encontrado", { status: 404, headers: corsHeaders });
  }
};

// ============ FUNCIONES DE APOYO (SCRAPING, EXTRACCION, LIMPIEZA, PROMPT) ============

async function scrapeInteligente(siteUrl: string): Promise<string> {
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' };
  try {
    const res = await fetch(siteUrl, { headers, redirect: 'follow' });
    if (res.ok) return await res.text();
  } catch (e) { console.error("Scraping fallido", e); }
  throw new Error("Error de conexión con la web");
}

interface DatosExtraidos { whatsapp: string[]; telefonos: string[]; emails: string[]; precios: string[]; direcciones: string[]; metaTags: Record<string, string>; titulos: string[]; secciones: string[]; }

function extraerDatosDetallados(html: string, baseUrl: string): DatosExtraidos {
  const datos: DatosExtraidos = { whatsapp: [], telefonos: [], emails: [], precios: [], direcciones: [], metaTags: {}, titulos: [], secciones: [] };
  const waMatch = html.match(/wa\.me\/(\d+)/g);
  if (waMatch) waMatch.forEach(m => datos.whatsapp.push(m.replace(/\D/g, '')));
  const emailMatch = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  if (emailMatch) datos.emails = [...new Set(emailMatch)];
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) datos.metaTags.title = titleMatch[1];
  return datos;
}

function limpiarHTMLPreservandoDatos(html: string, datos: DatosExtraidos): string {
  let resultado = `=== CONTACTO ===\nWhatsApp: ${datos.whatsapp.join(', ')}\nEmails: ${datos.emails.join(', ')}\n\n`;
  const limpio = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return (resultado + limpio).substring(0, 12000);
}

function generarPromptNatural(intencion: Intencion, etapa: EtapaFunnel, nombreNegocio: string, contexto: string, historialResumido?: string, buscaContacto: boolean = false, buscaPrecio: boolean = false): string {
  return `Eres el asistente oficial de ${nombreNegocio}. 
  REGLAS:
  1. Habla de forma natural, sin decir "según el texto".
  2. Si te piden contacto usa los datos del contexto.
  3. Si detectas que el cliente quiere comprar, pide amablemente su nombre y teléfono para agendar.
  
  CONTEXTO:
  ${contexto}
  
  HISTORIAL: ${historialResumido || 'Inicio'}
  Responde de forma breve y humana.`;
}
