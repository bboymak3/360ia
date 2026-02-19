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

    // 2. REGISTRO CON SCRAPING DETALLADO Y SUAVE
    if (url.pathname === "/api/registrar" && request.method === "POST") {
      try {
        const { nombre, email, url: siteUrl } = await request.json() as any;
        
        console.log(`[SCRAPING] Iniciando scan de: ${siteUrl}`);
        
        // Fetch con timeout extendido y headers completos
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 segundos
        
        const resSite = await fetch(siteUrl, { 
          signal: controller.signal,
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8,en-US;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Cache-Control': 'max-age=0'
          },
          redirect: 'follow'
        });
        
        clearTimeout(timeoutId);
        
        if (!resSite.ok) {
          throw new Error(`HTTP ${resSite.status}: No se pudo acceder a la URL`);
        }
        
        const contentType = resSite.headers.get('content-type') || '';
        if (!contentType.includes('text/html')) {
          throw new Error(`Content-Type no es HTML: ${contentType}`);
        }
        
        const html = await resSite.text();
        console.log(`[SCRAPING] HTML recibido: ${html.length} caracteres`);
        
        if (html.length < 100) {
          throw new Error("Respuesta HTML demasiado corta, posible bloqueo");
        }

        // Extracción en fases separadas y detalladas
        console.log(`[SCRAPING] Extrayendo datos estructurados...`);
        const datosExtraidos = extraerDatosDetallados(html, siteUrl);
        
        console.log(`[SCRAPING] Encontrados: ${datosExtraidos.whatsapp.length} WhatsApp, ${datosExtraidos.telefonos.length} teléfonos, ${datosExtraidos.precios.length} precios, ${datosExtraidos.emails.length} emails`);
        
        console.log(`[SCRAPING] Limpiando HTML preservando datos...`);
        const textoLimpio = limpiarHTMLPreservandoDatos(html, datosExtraidos);

        // Verificar que tenemos contenido válido
        if (textoLimpio.length < 50) {
          throw new Error("No se pudo extraer contenido válido de la web");
        }

        console.log(`[SCRAPING] Contenido final: ${textoLimpio.length} caracteres`);

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
            htmlOriginal: html.length,
            contenidoFinal: textoLimpio.length,
            whatsapp: datosExtraidos.whatsapp,
            telefonos: datosExtraidos.telefonos,
            precios: datosExtraidos.precios.slice(0, 5), // Primeros 5 precios
            emails: datosExtraidos.emails
          }
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err: any) {
        console.error(`[ERROR] ${err.message}`);
        return new Response(JSON.stringify({ 
          success: false, 
          error: err.message,
          tipo: err.name === 'AbortError' ? 'timeout' : 'general'
        }), { 
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

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        
        const resSite = await fetch(actual.url_web_escaneada as string, {
          signal: controller.signal,
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.9'
          },
          redirect: 'follow'
        });
        
        clearTimeout(timeoutId);
        
        if (!resSite.ok) throw new Error(`HTTP ${resSite.status}`);
        
        const html = await resSite.text();
        const datosExtraidos = extraerDatosDetallados(html, actual.url_web_escaneada as string);
        const nuevoTexto = limpiarHTMLPreservandoDatos(html, datosExtraidos);

        // Análisis de cambios con IA
        const analisisCambios = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          messages: [
            {
              role: "system",
              content: `Analiza cambios entre versiones de web. Responde SOLO JSON:
                       {"cambios_detectados": ["..."], "prioridad": "alta|media|baja", "resumen": "..."}`
            },
            {
              role: "user",
              content: `ANTERIOR (${(actual.contexto_entrenamiento as string).length} chars): ${(actual.contexto_entrenamiento as string).substring(0, 2000)}
                       NUEVO (${nuevoTexto.length} chars): ${nuevoTexto.substring(0, 2000)}`
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
            resumen: "Web re-escaneada con nuevos datos" 
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
          stats: {
            caracteresNuevos: nuevoTexto.length,
            caracteresAnteriores: (actual.contexto_entrenamiento as string).length,
            whatsappDetectados: datosExtraidos.whatsapp.length,
            preciosDetectados: datosExtraidos.precios.length
          }
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
                        "busca_contacto": true|false,
                        "busca_precio": true|false}`
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
          metadatos = { intencion: 'general', etapa: 'descubrimiento', busca_contacto: false, busca_precio: false };
        }

        const promptEspecializado = generarPromptEspecializado(
          metadatos.intencion,
          metadatos.etapa,
          data.nombre_negocio as string,
          data.contexto_entrenamiento as string,
          historialResumido,
          metadatos.busca_contacto,
          metadatos.busca_precio
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
              content: `Genera 4 bullet points. Responde SOLO JSON: {"puntos": ["...", "...", "...", "..."]}`
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
          puntos = ["Asistente IA listo", "Información cargada", "Atención 24/7", "Respuestas instantáneas"];
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

// ============ SCRAPING DETALLADO Y SUAVE ============

interface DatosExtraidos {
  whatsapp: string[];
  telefonos: string[];
  emails: string[];
  precios: string[];
  direcciones: string[];
  horarios: string[];
  metaTags: Record<string, string>;
  titulos: string[];
  secciones: string[];
}

/**
 * Extracción detallada de datos - NO destructiva
 */
function extraerDatosDetallados(html: string, baseUrl: string): DatosExtraidos {
  const datos: DatosExtraidos = {
    whatsapp: [],
    telefonos: [],
    emails: [],
    precios: [],
    direcciones: [],
    horarios: [],
    metaTags: {},
    titulos: [],
    secciones: []
  };

  // 1. WHATSAPP - Múltiples formatos incluyendo wa.me y api.whatsapp.com
  const whatsappRegex = [
    /https?:\/\/wa\.me\/(\d{10,15})/gi,
    /https?:\/\/api\.whatsapp\.com\/send\?phone=(\d{10,15})/gi,
    /whatsapp[:\s]+(\+?\d{10,15})/gi,
    /wa\.me\/(\d{10,15})/gi,
    /chat\.whatsapp\.com\/[A-Za-z0-9]+/gi
  ];

  whatsappRegex.forEach(regex => {
    let match;
    while ((match = regex.exec(html)) !== null) {
      let numero = match[1] || match[0];
      // Limpiar y normalizar
      numero = numero.replace(/[^\d+]/g, '');
      // Asegurar que tenga código de país
      if (numero.length >= 10 && !datos.whatsapp.includes(numero)) {
        datos.whatsapp.push(numero);
      }
    }
  });

  // 2. TELÉFONOS - Formato venezolano y latinoamericano completo
  // Patrón: +58 0416-7775771, +584167775771, 0416-7775771, etc.
  const telefonoPatterns = [
    // Formato completo internacional: +584167775771
    /\+\d{1,3}\d{10,11}/g,
    // Formato con espacios/guiones: +58 416-777-5771
    /\+\d{1,3}[\s\-]?\d{3,4}[\s\-]?\d{3}[\s\-]?\d{4}/g,
    // Formato venezolano común: 0416-7775771
    /0\d{3}[\s\-]?\d{7}/g,
    // Teléfono en texto: Tel: +58 416 777 5771
    /(?:tel[eé]fono|tel|ll[aá]manos|contacto)[:\s]+([\+\d\s\-\(\)]{10,})/gi,
    // Teléfono en atributos href="tel:+584167775771"
    /href=["']tel:([\+\d]{10,})["']/gi
  ];

  telefonoPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      let tel = match[1] || match[0];
      // Limpiar
      tel = tel.replace(/[^\d+]/g, '');
      // Validar longitud (10-13 dígitos incluyendo +)
      if (tel.length >= 10 && tel.length <= 13 && !datos.telefonos.includes(tel)) {
        datos.telefonos.push(tel);
      }
    }
  });

  // 3. EMAILS - Estándar
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let emailMatch;
  while ((emailMatch = emailRegex.exec(html)) !== null) {
    if (!datos.emails.includes(emailMatch[0])) {
      datos.emails.push(emailMatch[0]);
    }
  }

  // 4. PRECIOS - Múltiples formatos monetarios
  const precioPatterns = [
    // $ 1,234.56 o $1234
    /\$\s*[\d.,]+(?:\s*(?:USD|EUR|MXN|COP|ARS|VES|Bs\.?|Bolívares?|pesos?))?/gi,
    // Desde $X
    /(?:desde|from|a partir de)[:\s]*\$?\s*[\d.,]+/gi,
    // Precio: $X
    /(?:precio|price|costo|valor|inversi[oó]n)[:\s]*\$?\s*[\d.,]+/gi,
    // Montos con símbolo al final: 1000 Bs.
    /[\d.,]+\s*(?:USD|EUR|MXN|COP|ARS|VES|Bs\.?|Bolívares?|\$)/gi,
    // Rangos: $500 - $1000
    /\$\s*[\d.,]+\s*(?:a|-|~|hasta)\s*\$?\s*[\d.,]+/gi
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

  // 5. META TAGS
  const metaPatterns = {
    title: /<title[^>]*>([^<]*)<\/title>/i,
    description: /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)/i,
    keywords: /<meta[^>]*name=["']keywords["'][^>]*content=["']([^"']*)/i,
    ogTitle: /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)/i,
    ogDescription: /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)/i,
    ogImage: /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)/i
  };

  for (const [key, regex] of Object.entries(metaPatterns)) {
    const match = regex.exec(html);
    if (match) datos.metaTags[key] = match[1].trim();
  }

  // 6. TÍTULOS (h1-h3) para estructura
  const tituloRegex = /<h[1-3][^>]*>([^<]*)<\/h[1-3]>/gi;
  let tituloMatch;
  while ((tituloMatch = tituloRegex.exec(html)) !== null) {
    const titulo = tituloMatch[1].replace(/<[^>]*>/g, '').trim();
    if (titulo.length > 3 && titulo.length < 200) {
      datos.titulos.push(titulo);
    }
  }

  // 7. SECCIONES con clases/ids específicos
  const seccionSelectors = [
    /<(div|section|article)[^>]*(?:id|class)=["'](?:[^"']*precio|[^"']*price|[^"']*contacto|[^"']*contact|[^"']*servicio|[^"']*service|[^"']*about|[^"']*nosotros)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi
  ];

  seccionSelectors.forEach(regex => {
    let match;
    while ((match = regex.exec(html)) !== null) {
      const contenido = match[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (contenido.length > 20 && contenido.length < 1000) {
        datos.secciones.push(contenido);
      }
    }
  });

  // 8. JSON-LD (Schema.org) - Datos estructurados
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jsonLdMatch;
  while ((jsonLdMatch = jsonLdRegex.exec(html)) !== null) {
    try {
      const jsonData = JSON.parse(jsonLdMatch[1]);
      
      // Extraer de Organization o LocalBusiness
      if (jsonData['@type'] === 'Organization' || jsonData['@type'] === 'LocalBusiness') {
        if (jsonData.telephone && !datos.telefonos.includes(jsonData.telephone)) {
          datos.telefonos.push(jsonData.telephone);
        }
        if (jsonData.email && !datos.emails.includes(jsonData.email)) {
          datos.emails.push(jsonData.email);
        }
        if (jsonData.priceRange) {
          datos.precios.push(`Rango: ${jsonData.priceRange}`);
        }
        if (jsonData.address) {
          const direccion = typeof jsonData.address === 'string' 
            ? jsonData.address 
            : `${jsonData.address.streetAddress || ''}, ${jsonData.address.addressLocality || ''}`;
          if (direccion.trim()) datos.direcciones.push(direccion);
        }
      }
    } catch (e) {}
  }

  return datos;
}

/**
 * Limpieza SUAVE que preserva datos críticos
 */
function limpiarHTMLPreservandoDatos(html: string, datos: DatosExtraidos): string {
  let seccionesTexto: string[] = [];

  // 1. SECCIÓN DE CONTACTO (al inicio para prioridad)
  let contactoSection = "=== DATOS DE CONTACTO ===\n";
  if (datos.whatsapp.length > 0) {
    contactoSection += `WhatsApp: ${datos.whatsapp.join(', ')}\n`;
  }
  if (datos.telefonos.length > 0) {
    contactoSection += `Teléfonos: ${datos.telefonos.join(', ')}\n`;
  }
  if (datos.emails.length > 0) {
    contactoSection += `Emails: ${datos.emails.join(', ')}\n`;
  }
  if (datos.direcciones.length > 0) {
    contactoSection += `Dirección: ${datos.direcciones.join(', ')}\n`;
  }
  seccionesTexto.push(contactoSection);

  // 2. SECCIÓN DE PRECIOS
  if (datos.precios.length > 0) {
    let preciosSection = "=== PRECIOS Y TARIFAS ===\n";
    datos.precios.slice(0, 20).forEach(p => { // Limitar a 20 precios
      preciosSection += `- ${p}\n`;
    });
    seccionesTexto.push(preciosSection);
  }

  // 3. METADATOS DEL NEGOCIO
  let metaSection = "=== INFORMACIÓN GENERAL ===\n";
  if (datos.metaTags.title) metaSection += `Nombre: ${datos.metaTags.title}\n`;
  if (datos.metaTags.description) metaSection += `Descripción: ${datos.metaTags.description}\n`;
  if (datos.metaTags.keywords) metaSection += `Palabras clave: ${datos.metaTags.keywords}\n`;
  seccionesTexto.push(metaSection);

  // 4. TÍTULOS Y ESTRUCTURA
  if (datos.titulos.length > 0) {
    let titulosSection = "=== SERVICIOS Y SECCIONES ===\n";
    datos.titulos.slice(0, 15).forEach(t => {
      titulosSection += `- ${t}\n`;
    });
    seccionesTexto.push(titulosSection);
  }

  // 5. CONTENIDO DE SECCIONES ESPECÍFICAS
  datos.secciones.slice(0, 5).forEach((seccion, i) => {
    seccionesTexto.push(`=== CONTENIDO ${i + 1} ===\n${seccion}`);
  });

  // 6. LIMPIEZA DEL HTML RESTANT (suave)
  // Primero extraer texto de párrafos importantes
  const parrafosRegex = /<p[^>]*>([^<]{30,500})<\/p>/gi;
  let parrafoMatch;
  const parrafosUtiles: string[] = [];
  while ((parrafoMatch = parrafosRegex.exec(html)) !== null) {
    const texto = parrafoMatch[1].replace(/<[^>]*>/g, ' ').trim();
    if (texto.length > 30) {
      parrafosUtiles.push(texto);
    }
  }

  // Limpieza básica del HTML completo
  let limpio = html
    // Eliminar scripts pero extraer si tienen datos útiles primero
    .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (match, content) => {
      // Verificar si contiene datos de contacto o precios
      if (/tel:|mailto:|price|precio|whatsapp/i.test(content)) {
        // Extraer URLs útiles
        const urls = content.match(/https?:\/\/[^\s"']+/g) || [];
        return urls.join(' ');
      }
      return ' ';
    })
    // Eliminar styles
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    // Eliminar SVGs
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    // Eliminar iframes
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, ' ')
    // Eliminar canvas
    .replace(/<canvas\b[^>]*>[\s\S]*?<\/canvas>/gi, ' ')
    // Eliminar comentarios
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Eliminar tags pero preservar espacios
    .replace(/<[^>]*>/g, ' ')
    // Normalizar espacios
    .replace(/\s+/g, ' ')
    .trim();

  // 7. COMBINAR TODO
  let resultado = seccionesTexto.join('\n\n');

  // Agregar párrafos útiles si hay espacio
  if (parrafosUtiles.length > 0) {
    resultado += '\n\n=== CONTENIDO ADICIONAL ===\n';
    resultado += parrafosUtiles.slice(0, 10).join('\n\n');
  }

  // Agregar contenido limpio general (resumido)
  if (limpio.length > 100) {
    resultado += '\n\n=== DESCRIPCIÓN GENERAL ===\n';
    resultado += limpio.substring(0, 3000); // Limitar para no saturar
  }

  // Limpieza final
  resultado = resultado
    .replace(/\n\s*\n\s*\n/g, '\n\n') // Máximo 2 saltos de línea
    .replace(/[ \t]+/g, ' ') // Espacios múltiples
    .trim();

  return resultado.substring(0, 12000); // Aumentado a 12k
}

function generarPromptEspecializado(
  intencion: Intencion,
  etapa: EtapaFunnel,
  nombreNegocio: string,
  contexto: string,
  historialResumido?: string,
  buscaContacto: boolean = false,
  buscaPrecio: boolean = false
): string {
  
  let instruccionesEspecificas = '';
  
  if (buscaContacto) {
    instruccionesEspecificas += `
INSTRUCCIÓN CRÍTICA - CONTACTO: El usuario busca información de contacto. 
En el CONTEXTO busca EXACTAMENTE líneas que digan:
"WhatsApp: X", "Teléfonos: X", "Emails: X", "Dirección: X"
Proporciona los datos EXACTOS como aparecen. Si hay múltiples, lista el principal y menciona que hay alternativas.
`;
  }

  if (buscaPrecio) {
    instruccionesEspecificas += `
INSTRUCCIÓN CRÍTICA - PRECIOS: El usuario pregunta por precios.
En el CONTEXTO busca la sección "=== PRECIOS Y TARIFAS ===" y menciona los valores EXACTOS que aparecen.
Si hay rangos (ej: "Desde $500"), indica el rango. Si no hay precios específicos, explica que varían según el proyecto y ofrece cotización personalizada.
`;
  }

  const base = `Eres el Asistente Experto de "${nombreNegocio}". 
${instruccionesEspecificas}
CONTEXTO OFICIAL DEL NEGOCIO:
"""
${contexto}
"""
${historialResumido ? `RESUMEN DE CONVERSACIÓN: ${historialResumido}` : ''}`;

  const promptsPorIntencion: Record<Intencion, string> = {
    factual: `${base}
REGLAS: Responde usando EXACTAMENTE la información del CONTEXTO. Si no está ahí, di: "Ese dato específico no lo tengo en mi base, pero puedo conectarte con un especialista de ${nombreNegocio} que te ayudará de inmediato." NO inventes.`,

    comparar: `${base}
REGLAS: Usa el CONTEXTO para destacar diferenciadores ÚNICOS de ${nombreNegocio}. Puedes usar conocimiento general del sector pero SIEMPRE vincula a beneficios específicos del contexto.`,

    precio: `${base}
REGLAS: Menciona precios EXACTOS del CONTEXTO si existen. Si no, di: "Los precios dependen de tus necesidades específicas. ¿Te gustaría que preparemos una cotización personalizada para ti?"`,

    soporte: `${base}
REGLAS: Empatía primero. Si la solución está en el CONTEXTO, explícala paso a paso. Si no, ofrece contacto humano inmediato: "Voy a transferirte con nuestro equipo de soporte."`,

    objecion: `${base}
REGLAS: Valida la preocupación, usa el CONTEXTO para mostrar valor/resultados específicos, cierra con: "¿Te gustaría que un especialista te muestre cómo funciona en tu caso particular?"`,

    general: `${base}
REGLAS: Cálido, profesional, consultivo. Guía la conversación hacia entender necesidades. Si no sabes algo del contexto, ofrece conectar con humano.`
  };

  const promptsPorEtapa: Record<EtapaFunnel, string> = {
    descubrimiento: "ETAPA: Exploración. Sé informativo, genera interés, haz preguntas de descubrimiento.",
    consideracion: "ETAPA: Comparación. Destaca diferenciadores únicos, usa pruebas del contexto.",
    decision: "ETAPA: Cierre. Detecta señales de compra y acelera hacia conversión o demo.",
    postventa: "ETAPA: Cliente existente. Soporte técnico o upsell basado en historial."
  };

  return `${promptsPorIntencion[intencion]}\n\n${promptsPorEtapa[etapa]}\n\nTONO: Profesional, cálido, experto. Longitud: 2-4 oraciones salvo que requiera detalle.`;
}