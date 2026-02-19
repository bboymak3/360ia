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
        
        // Scraping agresivo pero inteligente
        const resSite = await fetch(siteUrl, { 
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
          }
        });
        
        if (!resSite.ok) throw new Error("No se pudo acceder a la URL");
        
        const html = await resSite.text();
        
        // Extracción inteligente en 2 fases
        const datosExtraidos = extraerDatosInteligente(html, siteUrl);
        const textoLimpio = limpiarHTMLInteligente(html, datosExtraidos);

        // Buscar si email ya existe
        const existente = await env.DB.prepare(
          `SELECT widget_id FROM "360ia_db" WHERE email_usuario = ?`
        ).bind(email).first();

        let widgetId: string;
        let esNuevo: boolean;
        let mensaje: string;

        if (existente) {
          widgetId = existente.widget_id as string;
          esNuevo = false;
          mensaje = "✅ Datos actualizados correctamente";
          
          await env.DB.prepare(`
            UPDATE "360ia_db" 
            SET nombre_negocio = ?,
                url_web_escaneada = ?,
                contexto_entrenamiento = ?
            WHERE email_usuario = ?
          `).bind(nombre, siteUrl, textoLimpio, email).run();
          
        } else {
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
          mensaje,
          debug: {
            contactosEncontrados: datosExtraidos.contactos.length,
            preciosEncontrados: datosExtraidos.precios.length,
            preview: textoLimpio.substring(0, 200) + "..."
          }
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { 
          status: 500, headers: corsHeaders 
        });
      }
    }

    // 3. RE-SCAN INTELIGENTE
    if (url.pathname === "/api/rescan" && request.method === "POST") {
      try {
        const { widgetId } = await request.json() as any;
        
        const actual = await env.DB.prepare(
          `SELECT email_usuario, nombre_negocio, url_web_escaneada, contexto_entrenamiento 
           FROM "360ia_db" WHERE widget_id = ?`
        ).bind(widgetId).first();

        if (!actual) {
          return new Response(JSON.stringify({ success: false, error: "Widget no encontrado" }), {
            status: 404, headers: corsHeaders
          });
        }

        const resSite = await fetch(actual.url_web_escaneada as string, {
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        });
        
        if (!resSite.ok) throw new Error("No se pudo acceder a la URL");
        
        const html = await resSite.text();
        const datosExtraidos = extraerDatosInteligente(html, actual.url_web_escaneada as string);
        const nuevoTexto = limpiarHTMLInteligente(html, datosExtraidos);

        // Análisis de cambios
        const analisisCambios = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          messages: [
            {
              role: "system",
              content: `Compara textos. Responde SOLO JSON:
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
            resumen: "Web re-escaneada" 
          };
        }

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
          caracteresAnteriores: (actual.contexto_entrenamiento as string).length,
          contactosDetectados: datosExtraidos.contactos.length
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

      } catch (err: any) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500, headers: corsHeaders
        });
      }
    }

    // 4. DATOS DEL CLIENTE
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

    // 5. CHAT CON IA DUAL
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const { widgetId, messages, historialResumido } = await request.json() as any;
        
        const data = await env.DB.prepare(
          `SELECT contexto_entrenamiento, nombre_negocio FROM "360ia_db" WHERE widget_id = ?`
        ).bind(widgetId).first();

        if (!data) return new Response("Widget no encontrado", { status: 404, headers: corsHeaders });

        const ultimoMensaje = messages[messages.length - 1]?.content || "";

        // LLAMA #1: Detectar intención
        const analisisIntencion = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          messages: [
            {
              role: "system",
              content: `Analiza mensaje. Responde SOLO JSON:
                       {"intencion": "factual|comparar|precio|soporte|objecion|general", 
                        "etapa": "descubrimiento|consideracion|decision|postventa",
                        "urgencia": "baja|media|alta",
                        "busca_contacto": true|false}`
            },
            {
              role: "user",
              content: `Mensaje: "${ultimoMensaje}"
                       Historial: ${historialResumido || "Primera interacción"}`
            }
          ],
          max_tokens: 200
        });

        let metadatos: any;
        try {
          const respuestaLimpia = (analisisIntencion.response as string).replace(/```json|```/g, '').trim();
          metadatos = JSON.parse(respuestaLimpia);
        } catch (e) {
          metadatos = { intencion: 'general', etapa: 'descubrimiento', urgencia: 'baja', busca_contacto: false };
        }

        // Si busca contacto, enfatizar en el prompt
        const promptEspecializado = generarPromptEspecializado(
          metadatos.intencion,
          metadatos.etapa,
          data.nombre_negocio as string,
          data.contexto_entrenamiento as string,
          historialResumido,
          metadatos.busca_contacto
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

    // 6. RESUMEN IA
    if (url.pathname === "/api/resumen-ia" && request.method === "POST") {
      try {
        const { contexto, nombreNegocio } = await request.json() as any;

        const resumen = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          messages: [
            {
              role: "system",
              content: `Genera 4 bullet points persuasivos. Responde SOLO JSON: {"puntos": ["...", "...", "...", "..."]}`
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

// ============ FUNCIONES DE SCRAPING INTELIGENTE ============

interface DatosExtraidos {
  contactos: string[];
  precios: string[];
  whatsapp: string[];
  emails: string[];
  telefonos: string[];
  redes: string[];
  metaTags: Record<string, string>;
}

function extraerDatosInteligente(html: string, baseUrl: string): DatosExtraidos {
  const datos: DatosExtraidos = {
    contactos: [],
    precios: [],
    whatsapp: [],
    emails: [],
    telefonos: [],
    redes: [],
    metaTags: {}
  };

  // 1. Extraer WhatsApp (múltiples formatos)
  const whatsappPatterns = [
    /https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send)\/?\??(?:phone=)?(\d[\d\s\-\+\(\)]{7,})/gi,
    /whatsapp[:\s]*(\d[\d\s\-\+\(\)]{7,})/gi,
    /wa\.me\/(\d[\d\s\-\+\(\)]{7,})/gi,
    /chat.whatsapp.com\/[A-Za-z0-9]+/gi
  ];
  
  whatsappPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const numero = match[1] || match[0];
      if (numero && !datos.whatsapp.includes(numero)) {
        datos.whatsapp.push(numero.replace(/\s/g, '').replace(/[^\d+]/g, ''));
      }
    }
  });

  // 2. Extraer teléfonos (formatos internacionales)
  const telefonoPatterns = [
    /tel[:\s]*([\+\d\s\-\(\)]{8,})/gi,
    /teléfono[:\s]*([\+\d\s\-\(\)]{8,})/gi,
    /llámanos[:\s]*([\+\d\s\-\(\)]{8,})/gi,
    /call[:\s]*([\+\d\s\-\(\)]{8,})/gi,
    /\+\d{1,3}[\s\-]?\(?\d{2,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{3,4}/g
  ];

  telefonoPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const tel = (match[1] || match[0]).trim();
      if (tel.length > 7 && !datos.telefonos.includes(tel)) {
        datos.telefonos.push(tel);
      }
    }
  });

  // 3. Extraer emails
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let emailMatch;
  while ((emailMatch = emailPattern.exec(html)) !== null) {
    if (!datos.emails.includes(emailMatch[0])) {
      datos.emails.push(emailMatch[0]);
    }
  }

  // 4. Extraer precios (patrones comunes)
  const precioPatterns = [
    /\$\s*[\d.,]+(?:\s*(?:USD|EUR|MXN|COP|ARS|VES|Bs\.?|Bolívares?))?/gi,
    /(?:desde|from)[:\s]*\$?\s*[\d.,]+/gi,
    /(?:precio|price)[:\s]*\$?\s*[\d.,]+/gi,
    /(?:paquete|plan|plan)[:\s]*[^\$]*\$[\d.,]+/gi,
    /[\d.,]+\s*(?:USD|EUR|MXN|COP|ARS|VES|Bs\.?|Bolívares?)/gi
  ];

  precioPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const precio = match[0].trim();
      if (precio.length > 2 && !datos.precios.includes(precio)) {
        datos.precios.push(precio);
      }
    }
  });

  // 5. Extraer meta tags importantes
  const metaTitle = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)/i);
  const metaKeywords = html.match(/<meta[^>]*name=["']keywords["'][^>]*content=["']([^"']*)/i);
  const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)/i);
  const ogDesc = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)/i);

  if (metaTitle) datos.metaTags.title = metaTitle[1].trim();
  if (metaDesc) datos.metaTags.description = metaDesc[1].trim();
  if (metaKeywords) datos.metaTags.keywords = metaKeywords[1].trim();
  if (ogTitle) datos.metaTags.ogTitle = ogTitle[1].trim();
  if (ogDesc) datos.metaTags.ogDescription = ogDesc[1].trim();

  // 6. Extraer redes sociales
  const redesPatterns = [
    /facebook\.com\/[A-Za-z0-9.]+/gi,
    /instagram\.com\/[A-Za-z0-9._]+/gi,
    /twitter\.com\/[A-Za-z0-9_]+/gi,
    /linkedin\.com\/[A-Za-z0-9\/-]+/gi,
    /youtube\.com\/[A-Za-z0-9\/-]+/gi,
    /tiktok\.com\/@[A-Za-z0-9._]+/gi
  ];

  redesPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      if (!datos.redes.includes(match[0])) {
        datos.redes.push(match[0]);
      }
    }
  });

  // 7. Buscar en JSON-LD (structured data)
  const jsonLdPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jsonLdMatch;
  while ((jsonLdMatch = jsonLdPattern.exec(html)) !== null) {
    try {
      const jsonData = JSON.parse(jsonLdMatch[1]);
      if (jsonData.telephone && !datos.telefonos.includes(jsonData.telephone)) {
        datos.telefonos.push(jsonData.telephone);
      }
      if (jsonData.email && !datos.emails.includes(jsonData.email)) {
        datos.emails.push(jsonData.email);
      }
      if (jsonData.priceRange) {
        datos.precios.push(`Rango: ${jsonData.priceRange}`);
      }
    } catch (e) {}
  }

  return datos;
}

function limpiarHTMLInteligente(html: string, datos: DatosExtraidos): string {
  // FASE 1: Extraer texto de elementos importantes ANTES de limpiar
  let textoPreservado = '';
  
  // Preservar textos de precios encontrados
  datos.precios.forEach(precio => {
    textoPreservado += `PRECIO: ${precio}\n`;
  });
  
  // Preservar contactos
  datos.whatsapp.forEach(wa => {
    textoPreservado += `WHATSAPP: ${wa}\n`;
  });
  
  datos.telefonos.forEach(tel => {
    textoPreservado += `TELÉFONO: ${tel}\n`;
  });
  
  datos.emails.forEach(email => {
    textoPreservado += `EMAIL: ${email}\n`;
  });
  
  datos.redes.forEach(red => {
    textoPreservado += `RED SOCIAL: ${red}\n`;
  });

  // FASE 2: Limpieza quirúrgica (no agresiva)
  let limpio = html;

  // Eliminar scripts pero preservar su texto si contiene datos útiles
  limpio = limpio.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (match, content) => {
    // Si el script tiene precios o contactos, extraer esas líneas
    const lineasUtiles = content.split('\n').filter((linea: string) => 
      /precio|price|costo|whatsapp|teléfono|email|contacto/i.test(linea)
    );
    return lineasUtiles.length > 0 ? lineasUtiles.join(' ') : '';
  });

  // Eliminar styles
  limpio = limpio.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');

  // Eliminar SVGs
  limpio = limpio.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ');

  // Eliminar iframes
  limpio = limpio.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, ' ');

  // Eliminar comentarios
  limpio = limpio.replace(/<!--[\s\S]*?-->/g, ' ');

  // FASE 3: Extraer texto de tags importantes
  const seccionesImportantes: string[] = [];
  
  // Extraer de headers
  const headers = limpio.match(/<h[1-6][^>]*>([^<]*)<\/h[1-6]>/gi);
  if (headers) {
    headers.forEach(h => {
      const texto = h.replace(/<[^>]*>/g, ' ').trim();
      if (texto.length > 3) seccionesImportantes.push(texto);
    });
  }

  // Extraer de párrafos (pero filtrar los muy cortos)
  const parrafos = limpio.match(/<p[^>]*>([^<]{20,})<\/p>/gi);
  if (parrafos) {
    parrafos.forEach(p => {
      const texto = p.replace(/<[^>]*>/g, ' ').trim();
      if (texto.length > 20 && texto.length < 500) {
        seccionesImportantes.push(texto);
      }
    });
  }

  // Extraer de divs con clase de precio/contacto
  const divsImportantes = limpio.match(/<div[^>]*(?:precio|price|contacto|contact|whatsapp|tel)[^>]*>([\s\S]*?)<\/div>/gi);
  if (divsImportantes) {
    divsImportantes.forEach(div => {
      const texto = div.replace(/<[^>]*>/g, ' ').trim();
      if (texto.length > 5) seccionesImportantes.push(texto);
    });
  }

  // FASE 4: Limpieza final del HTML restante
  limpio = limpio.replace(/<[^>]*>/g, ' ');

  // FASE 5: Combinar todo
  let resultado = textoPreservado + '\n\n' + seccionesImportantes.join('\n\n') + '\n\n' + limpio;

  // Limpieza de espacios
  resultado = resultado
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();

  // FASE 6: Agregar metadatos si existen
  if (datos.metaTags.title) {
    resultado = `TÍTULO DEL NEGOCIO: ${datos.metaTags.title}\n\n${resultado}`;
  }
  if (datos.metaTags.description) {
    resultado = `DESCRIPCIÓN: ${datos.metaTags.description}\n\n${resultado}`;
  }

  return resultado.substring(0, 10000); // Aumentado a 10k para más contexto
}

function generarPromptEspecializado(
  intencion: Intencion,
  etapa: EtapaFunnel,
  nombreNegocio: string,
  contexto: string,
  historialResumido?: string,
  buscaContacto: boolean = false
): string {
  
  let base = `Eres el Asistente Experto de "${nombreNegocio}". 
CONTEXTO OFICIAL: "${contexto}"
${historialResumido ? `HISTORIAL: ${historialResumido}` : ''}`;

  // Si busca contacto, enfatizar extraer del contexto
  if (buscaContacto) {
    base += `\n\nIMPORTANTE: El usuario busca información de contacto. Revisa cuidadosamente el CONTEXTO buscando líneas que digan WHATSAPP:, TELÉFONO:, EMAIL:, o RED SOCIAL:. Si los encuentras, proporciónalos exactamente como aparecen.`;
  }

  const promptsPorIntencion: Record<Intencion, string> = {
    factual: `${base}
REGLAS: Responde con información del CONTEXTO. Si no está, di: "No tengo ese dato en mi base, pero un especialista de ${nombreNegocio} te ayudará al instante."`,

    comparar: `${base}
REGLAS: Destaca diferenciadores ÚNICOS del CONTEXTO. Usa conocimiento sectorial pero vincúlalo siempre a beneficios específicos mencionados.`,

    precio: `${base}
REGLAS: Busca en el CONTEXTO líneas que digan PRECIO: o menciones de costos. Si los encuentras, menciónalos. Si no, di: "Los precios varían según tus necesidades específicas. ¿Te gustaría que un especialista te prepare una cotización personalizada?"`,

    soporte: `${base}
REGLAS: Empatía primero. Si hay solución en el CONTEXTO, dala. Si no, ofrece contacto humano inmediato.`,

    objecion: `${base}
REGLAS: Valida preocupación, usa CONTEXTO para mostrar valor, cierra con pregunta de avance.`,

    general: `${base}
REGLAS: Cálido y profesional. Guía hacia entender necesidades. Si no sabes, ofrece conectar con humano.`
  };

  const promptsPorEtapa: Record<EtapaFunnel, string> = {
    descubrimiento: "ETAPA: Exploración. Informativo, genera interés.",
    consideracion: "ETAPA: Comparación. Destaca diferenciadores únicos.",
    decision: "ETAPA: Cierre. Acelera hacia conversión.",
    postventa: "ETAPA: Soporte o upsell."
  };

  return `${promptsPorIntencion[intencion]}\n\n${promptsPorEtapa[etapa]}\n\nMáximo 3-4 oraciones.`;
}