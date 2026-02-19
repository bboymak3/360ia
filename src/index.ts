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

    // 2. REGISTRO CON REESCRITURA MANUAL (sin UNIQUE constraints)
    if (url.pathname === "/api/registrar" && request.method === "POST") {
      try {
        const { nombre, email, url: siteUrl } = await request.json() as any;
        
        // Scraping mejorado
        const resSite = await fetch(siteUrl, { 
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; 360IA-Bot/1.0)' }
        });
        
        if (!resSite.ok) throw new Error("No se pudo acceder a la URL");
        
        const html = await resSite.text();
        const textoLimpio = limpiarHTML(html);

        // Buscar si email ya existe
        const existente = await env.DB.prepare(
          `SELECT widget_id FROM "360ia_db" WHERE email_usuario = ?`
        ).bind(email).first();

        let widgetId: string;
        let esNuevo: boolean;
        let mensaje: string;

        if (existente) {
          // REESCRIBIR: Actualizar registro existente
          widgetId = existente.widget_id as string;
          esNuevo = false;
          mensaje = "✅ Datos actualizados correctamente (escaneo anterior reemplazado)";
          
          await env.DB.prepare(`
            UPDATE "360ia_db" 
            SET nombre_negocio = ?,
                url_web_escaneada = ?,
                contexto_entrenamiento = ?
            WHERE email_usuario = ?
          `).bind(nombre, siteUrl, textoLimpio, email).run();
          
        } else {
          // NUEVO: Insertar registro
          widgetId = Math.random().toString(36).substring(2, 10);
          esNuevo = true;
          mensaje = "✅ Registro creado exitosamente";
          
          await env.DB.prepare(`
            INSERT INTO "360ia_db" 
            (email_usuario, nombre_negocio, url_web_escaneada, contexto_entrenamiento, widget_id)
            VALUES (?, ?, ?, ?, ?)
          `).bind(email, nombre, siteUrl, textoLimpio, widgetId).run();
        }

        return new Response(JSON.stringify({ 
          success: true, 
          widgetId,
          esNuevo,
          mensaje
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { 
          status: 500, headers: corsHeaders 
        });
      }
    }

    // 3. RE-SCAN INTELIGENTE (botón del dashboard)
    if (url.pathname === "/api/rescan" && request.method === "POST") {
      try {
        const { widgetId } = await request.json() as any;
        
        // Obtener datos actuales
        const actual = await env.DB.prepare(
          `SELECT email_usuario, nombre_negocio, url_web_escaneada, contexto_entrenamiento 
           FROM "360ia_db" WHERE widget_id = ?`
        ).bind(widgetId).first();

        if (!actual) {
          return new Response(JSON.stringify({ success: false, error: "Widget no encontrado" }), {
            status: 404, headers: corsHeaders
          });
        }

        // Nuevo scraping
        const resSite = await fetch(actual.url_web_escaneada as string, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; 360IA-Bot/1.0)' }
        });
        
        if (!resSite.ok) throw new Error("No se pudo acceder a la URL para re-escanear");
        
        const html = await resSite.text();
        const nuevoTexto = limpiarHTML(html);

        // LLAMA #1: Analizar cambios significativos
        const analisisCambios = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          messages: [
            {
              role: "system",
              content: `Eres analista de contenido web. Compara texto anterior vs nuevo.
                       Identifica: servicios nuevos, precios cambiados, info eliminada.
                       Responde SOLO en JSON válido sin markdown:
                       {"cambios_detectados": ["..."], "prioridad": "alta|media|baja", "resumen": "..."}`
            },
            {
              role: "user",
              content: `ANTERIOR: ${(actual.contexto_entrenamiento as string).substring(0, 3000)}
                       NUEVO: ${nuevoTexto.substring(0, 3000)}`
            }
          ],
          max_tokens: 500
        });

        let cambios: any;
        try {
          const respuestaLimpia = (analisisCambios.response as string).replace(/```json|```/g, '').trim();
          cambios = JSON.parse(respuestaLimpia);
        } catch (e) {
          cambios = { 
            cambios_detectados: ["Contenido actualizado"], 
            prioridad: "media",
            resumen: "Se detectaron modificaciones en el sitio web" 
          };
        }

        // Actualizar en la base de datos (tu tabla exacta, sin fecha_actualizacion)
        await env.DB.prepare(`
          UPDATE "360ia_db" 
          SET contexto_entrenamiento = ?
          WHERE widget_id = ?
        `).bind(nuevoTexto, widgetId).run();

        return new Response(JSON.stringify({
          success: true,
          cambios: cambios.cambios_detectados,
          prioridad: cambios.prioridad,
          resumen: cambios.resumen,
          timestamp: new Date().toISOString(),
          caracteresNuevos: nuevoTexto.length,
          caracteresAnteriores: (actual.contexto_entrenamiento as string).length
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

      } catch (err: any) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500, headers: corsHeaders
        });
      }
    }

    // 4. DATOS DEL CLIENTE (tu tabla exacta)
    if (url.pathname === "/api/datos-cliente" && request.method === "GET") {
      const id = url.searchParams.get("id");
      const data = await env.DB.prepare(
        `SELECT nombre_negocio, contexto_entrenamiento, url_web_escaneada 
         FROM "360ia_db" WHERE widget_id = ?`
      ).bind(id).first();

      if (data) {
        return new Response(JSON.stringify({
          success: true,
          nombre: data.nombre_negocio,
          contexto: data.contexto_entrenamiento,
          url: data.url_web_escaneada
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: false }), { status: 404, headers: corsHeaders });
    }

    // 5. CHAT CON IA DUAL (inteligencia mejorada)
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const { widgetId, messages, historialResumido } = await request.json() as any;
        
        const data = await env.DB.prepare(
          `SELECT contexto_entrenamiento, nombre_negocio FROM "360ia_db" WHERE widget_id = ?`
        ).bind(widgetId).first();

        if (!data) return new Response("Widget no encontrado", { status: 404, headers: corsHeaders });

        const ultimoMensaje = messages[messages.length - 1]?.content || "";

        // LLAMA #1: Detectar intención y etapa del funnel
        const analisisIntencion = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          messages: [
            {
              role: "system",
              content: `Analiza el mensaje del usuario. Responde SOLO en JSON:
                       {"intencion": "factual|comparar|precio|soporte|objecion|general", 
                        "etapa": "descubrimiento|consideracion|decision|postventa",
                        "urgencia": "baja|media|alta",
                        "sentimiento": "positivo|neutral|negativo"}`
            },
            {
              role: "user",
              content: `Mensaje: "${ultimoMensaje}"
                       Historial resumido: ${historialResumido || "Primera interacción"}`
            }
          ],
          max_tokens: 200
        });

        let metadatos: any;
        try {
          const respuestaLimpia = (analisisIntencion.response as string).replace(/```json|```/g, '').trim();
          metadatos = JSON.parse(respuestaLimpia);
        } catch (e) {
          metadatos = { intencion: 'general', etapa: 'descubrimiento', urgencia: 'baja', sentimiento: 'neutral' };
        }

        // LLAMA #2: Generar respuesta con prompt especializado
        const promptEspecializado = generarPromptEspecializado(
          metadatos.intencion,
          metadatos.etapa,
          data.nombre_negocio as string,
          data.contexto_entrenamiento as string,
          historialResumido
        );

        const response = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          messages: [
            { role: "system", content: promptEspecializado },
            ...messages
          ],
          stream: true,
          max_tokens: 800
        });

        return new Response(response, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });

      } catch (err: any) {
        return new Response(err.message, { status: 500, headers: corsHeaders });
      }
    }

    // 6. GENERAR RESUMEN INTELIGENTE (para dashboard)
    if (url.pathname === "/api/resumen-ia" && request.method === "POST") {
      try {
        const { contexto, nombreNegocio } = await request.json() as any;

        const resumen = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          messages: [
            {
              role: "system",
              content: `Genera 4 bullet points persuasivos sobre este negocio.
                       Responde SOLO en JSON: {"puntos": ["...", "...", "...", "..."]}`
            },
            {
              role: "user",
              content: `Negocio: ${nombreNegocio}\nContexto: ${contexto.substring(0, 4000)}`
            }
          ],
          max_tokens: 400
        });

        let puntos: string[];
        try {
          const limpio = (resumen.response as string).replace(/```json|```/g, '').trim();
          puntos = JSON.parse(limpio).puntos;
        } catch (e) {
          puntos = ["Asistente IA configurado", "Información del negocio cargada", "Listo para atender clientes", "Disponible 24/7"];
        }

        return new Response(JSON.stringify({ success: true, puntos }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

      } catch (err: any) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500, headers: corsHeaders
        });
      }
    }

    return new Response("No encontrado", { status: 404, headers: corsHeaders });
  }
};

function limpiarHTML(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "")
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 8000);
}

function generarPromptEspecializado(
  intencion: Intencion,
  etapa: EtapaFunnel,
  nombreNegocio: string,
  contexto: string,
  historialResumido?: string
): string {
  
  const base = `Eres el Asistente Experto de "${nombreNegocio}". 
CONTEXTO OFICIAL DEL NEGOCIO: "${contexto}"
${historialResumido ? `HISTORIAL DE CONVERSACIÓN: ${historialResumido}` : ''}`;

  const promptsPorIntencion: Record<Intencion, string> = {
    factual: `${base}
REGLAS: Responde SOLO con información del CONTEXTO. Si no está ahí, di: "No tengo esa información específica, pero un especialista de ${nombreNegocio} te ayudará personalmente." NO inventes.`,

    comparar: `${base}
REGLAS: Usa el CONTEXTO para destacar diferenciadores ÚNICOS de ${nombreNegocio}. Puedes usar conocimiento general del sector PERO siempre vincula a beneficios específicos del contexto.`,

    precio: `${base}
REGLAS: NUNCA des precios exactos salvo que estén explícitos en el CONTEXTO. Pregunta qué necesita específicamente y ofrece agendar una llamada. Sé consultivo, no evasivo.`,

    soporte: `${base}
REGLAS: Prioridad: EMPATÍA. Si la solución está en el CONTEXTO, dala paso a paso. Si no, ofrece transferir con soporte prioritario.`,

    objecion: `${base}
REGLAS: Valida la preocupación, usa el CONTEXTO para mostrar valor/resultados, cierra con: "¿Te gustaría que un especialista te muestre cómo funciona en tu caso?"`,

    general: `${base}
REGLAS: Sé cálido y profesional. Guía hacia entender necesidades y ofrecer ayuda de ${nombreNegocio}. Si no sabes algo, ofrece conectar con humano.`
  };

  const promptsPorEtapa: Record<EtapaFunnel, string> = {
    descubrimiento: "ETAPA: Exploración. Sé informativo, genera interés sin ser pushy.",
    consideracion: "ETAPA: Comparación. Destaca diferenciadores únicos, usa pruebas del contexto.",
    decision: "ETAPA: Cierre. Detecta señales de compra y acelera hacia conversión.",
    postventa: "ETAPA: Cliente existente. Soporte técnico o upsell."
  };

  return `${promptsPorIntencion[intencion]}\n\n${promptsPorEtapa[etapa]}\n\nMáximo 3-4 oraciones salvo que requiera detalle técnico.`;
}