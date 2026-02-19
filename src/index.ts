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
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        
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

        console.log(`[SCRAPING] Extrayendo datos estructurados...`);
        const datosExtraidos = extraerDatosDetallados(html, siteUrl);
        
        console.log(`[SCRAPING] Encontrados: ${datosExtraidos.whatsapp.length} WhatsApp, ${datosExtraidos.telefonos.length} teléfonos, ${datosExtraidos.precios.length} precios, ${datosExtraidos.emails.length} emails`);
        
        console.log(`[SCRAPING] Limpiando HTML preservando datos...`);
        const textoLimpio = limpiarHTMLPreservandoDatos(html, datosExtraidos);

        if (textoLimpio.length < 50) {
          throw new Error("No se pudo extraer contenido válido de la web");
        }

        console.log(`[SCRAPING] Contenido final: ${textoLimpio.length} caracteres`);

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
            precios: datosExtraidos.precios.slice(0, 5),
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

    // 5. CHAT CON IA DUAL - NATURAL
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const { widgetId, messages, historialResumido } = await request.json() as any;
        
        const data = await env.DB.prepare(
          `SELECT contexto_entrenamiento, nombre_negocio FROM "360ia_db" WHERE widget_id = ?`
        ).bind(widgetId).first();

        if (!data) return new Response("Widget no encontrado", { status: 404, headers: corsHeaders });

        const ultimoMensaje = messages[messages.length - 1]?.content || "";

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

        const promptEspecializado = generarPromptNatural(
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
          puntos = ["Asistente IA listo", "Información del negocio cargada", "Atención 24/7", "Respuestas instantáneas"];
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

// ============ SCRAPING DETALLADO ============

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

  // 1. WHATSAPP
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
      numero = numero.replace(/[^\d+]/g, '');
      if (numero.length >= 10 && !datos.whatsapp.includes(numero)) {
        datos.whatsapp.push(numero);
      }
    }
  });

  // 2. TELÉFONOS - Formato venezolano completo
  const telefonoPatterns = [
    /\+\d{1,3}\d{10,11}/g,
    /\+\d{1,3}[\s\-]?\d{3,4}[\s\-]?\d{3}[\s\-]?\d{4}/g,
    /0\d{3}[\s\-]?\d{7}/g,
    /(?:tel[eé]fono|tel|ll[aá]manos|contacto)[:\s]+([\+\d\s\-\(\)]{10,})/gi,
    /href=["']tel:([\+\d]{10,})["']/gi
  ];

  telefonoPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      let tel = match[1] || match[0];
      tel = tel.replace(/[^\d+]/g, '');
      if (tel.length >= 10 && tel.length <= 13 && !datos.telefonos.includes(tel)) {
        datos.telefonos.push(tel);
      }
    }
  });

  // 3. EMAILS
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let emailMatch;
  while ((emailMatch = emailRegex.exec(html)) !== null) {
    if (!datos.emails.includes(emailMatch[0])) {
      datos.emails.push(emailMatch[0]);
    }
  }

  // 4. PRECIOS
  const precioPatterns = [
    /\$\s*[\d.,]+(?:\s*(?:USD|EUR|MXN|COP|ARS|VES|Bs\.?|Bolívares?|pesos?))?/gi,
    /(?:desde|from|a partir de)[:\s]*\$?\s*[\d.,]+/gi,
    /(?:precio|price|costo|valor|inversi[oó]n)[:\s]*\$?\s*[\d.,]+/gi,
    /[\d.,]+\s*(?:USD|EUR|MXN|COP|ARS|VES|Bs\.?|Bolívares?|\$)/gi,
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

  // 6. TÍTULOS
  const tituloRegex = /<h[1-3][^>]*>([^<]*)<\/h[1-3]>/gi;
  let tituloMatch;
  while ((tituloMatch = tituloRegex.exec(html)) !== null) {
    const titulo = tituloMatch[1].replace(/<[^>]*>/g, '').trim();
    if (titulo.length > 3 && titulo.length < 200) {
      datos.titulos.push(titulo);
    }
  }

  // 7. SECCIONES
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

  // 8. JSON-LD
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jsonLdMatch;
  while ((jsonLdMatch = jsonLdRegex.exec(html)) !== null) {
    try {
      const jsonData = JSON.parse(jsonLdMatch[1]);
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

function limpiarHTMLPreservandoDatos(html: string, datos: DatosExtraidos): string {
  let seccionesTexto: string[] = [];

  // 1. CONTACTO
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

  // 2. PRECIOS
  if (datos.precios.length > 0) {
    let preciosSection = "=== PRECIOS Y TARIFAS ===\n";
    datos.precios.slice(0, 20).forEach(p => {
      preciosSection += `- ${p}\n`;
    });
    seccionesTexto.push(preciosSection);
  }

  // 3. METADATOS
  let metaSection = "=== INFORMACIÓN GENERAL ===\n";
  if (datos.metaTags.title) metaSection += `Nombre: ${datos.metaTags.title}\n`;
  if (datos.metaTags.description) metaSection += `Descripción: ${datos.metaTags.description}\n`;
  if (datos.metaTags.keywords) metaSection += `Palabras clave: ${datos.metaTags.keywords}\n`;
  seccionesTexto.push(metaSection);

  // 4. TÍTULOS
  if (datos.titulos.length > 0) {
    let titulosSection = "=== SERVICIOS Y SECCIONES ===\n";
    datos.titulos.slice(0, 15).forEach(t => {
      titulosSection += `- ${t}\n`;
    });
    seccionesTexto.push(titulosSection);
  }

  // 5. SECCIONES ESPECÍFICAS
  datos.secciones.slice(0, 5).forEach((seccion, i) => {
    seccionesTexto.push(`=== CONTENIDO ${i + 1} ===\n${seccion}`);
  });

  // 6. LIMPIEZA SUAVE
  const parrafosRegex = /<p[^>]*>([^<]{30,500})<\/p>/gi;
  let parrafoMatch;
  const parrafosUtiles: string[] = [];
  while ((parrafoMatch = parrafosRegex.exec(html)) !== null) {
    const texto = parrafoMatch[1].replace(/<[^>]*>/g, ' ').trim();
    if (texto.length > 30) {
      parrafosUtiles.push(texto);
    }
  }

  let limpio = html
    .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (match, content) => {
      if (/tel:|mailto:|price|precio|whatsapp/i.test(content)) {
        const urls = content.match(/https?:\/\/[^\s"']+/g) || [];
        return urls.join(' ');
      }
      return ' ';
    })
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<canvas\b[^>]*>[\s\S]*?<\/canvas>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 7. COMBINAR
  let resultado = seccionesTexto.join('\n\n');

  if (parrafosUtiles.length > 0) {
    resultado += '\n\n=== CONTENIDO ADICIONAL ===\n';
    resultado += parrafosUtiles.slice(0, 10).join('\n\n');
  }

  if (limpio.length > 100) {
    resultado += '\n\n=== DESCRIPCIÓN GENERAL ===\n';
    resultado += limpio.substring(0, 3000);
  }

  resultado = resultado
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  return resultado.substring(0, 12000);
}

// ============ PROMPT NATURAL ============

function generarPromptNatural(
  intencion: Intencion,
  etapa: EtapaFunnel,
  nombreNegocio: string,
  contexto: string,
  historialResumido?: string,
  buscaContacto: boolean = false,
  buscaPrecio: boolean = false
): string {
  
  // Extraer datos específicos del contexto para el prompt
  const whatsappMatch = contexto.match(/WhatsApp:\s*(\+?\d[\d\s]+)/);
  const telefonoMatch = contexto.match(/Tel[eé]fonos?:\s*(\+?\d[\d\s]+)/);
  const emailMatch = contexto.match(/Emails?:\s*([^\s@]+@[^\s@]+)/);
  
  const numeroPrincipal = whatsappMatch?.[1]?.trim() || telefonoMatch?.[1]?.trim() || '';
  const emailPrincipal = emailMatch?.[1]?.trim() || '';

  let contextoEspecifico = '';
  
  if (buscaContacto && numeroPrincipal) {
    contextoEspecifico = `
DATO ESPECÍFICO DISPONIBLE: WhatsApp/Teléfono ${numeroPrincipal}

INSTRUCCIÓN ABSOLUTA: 
- NUNCA digas "encontré en la sección X"
- NUNCA uses comillas alrededor del número
- NUNCA expliques que "según el contexto"
- Responde como si supieras el número de memoria: "Claro, el WhatsApp es ${numeroPrincipal}. ¿Te sirve o necesitas el email también?"
`;
  }

  if (buscaPrecio) {
    const preciosEncontrados = contexto.match(/=== PRECIOS Y TARIFAS ===\n([\s\S]*?)(?:\n===|$)/);
    if (preciosEncontrados) {
      contextoEspecifico += `
PRECIOS DISPONIBLES: ${preciosEncontrados[1].substring(0, 200).replace(/\n/g, ', ')}

INSTRUCCIÓN: Menciona precios de forma natural, no como lista. Ej: "Tenemos opciones desde $500, depende de lo que necesites específicamente."
`;
    }
  }

  return `Eres un asistente de ventas de ${nombreNegocio}. Hablas como un humano profesional y cercano, NUNCA como un robot de atención al cliente.

${contextoEspecifico}

INFORMACIÓN DEL NEGOCIO (tu conocimiento interno):
"""
${contexto}
"""

${historialResumido ? `CONVERSACIÓN RECIENTE: ${historialResumido}` : ''}

REGLAS ABSOLUTAS:
1. NUNCA digas "en el contexto", "encontré que", "según la información", "en la sección X"
2. NUNCA cites textualmente con comillas
3. SIEMPRE responde directo, como si supieras los datos de memoria
4. SIEMPRE ofrece ayuda adicional casualmente al final
5. SI NO SABES algo: "Déjame conectarte con un especialista que te ayude mejor con eso"

EJEMPLOS DE RESPUESTAS CORRECTAS:
- "Claro, el WhatsApp es +58 416-7775771. ¿Prefieres escribir o llamar?"
- "Tenemos planes desde $500. ¿Qué tipo de proyecto tienes en mente?"
- "Hacemos diseño web, SEO y marketing. ¿Cuál te interesa más?"

EJEMPLOS PROHIBIDOS (NUNCA hagas esto):
- ❌ "En la sección === DATOS DE CONTACTO === encontré..."
- ❌ "Según el contexto oficial del negocio..."
- ❌ "El número es '584167775771'"
- ❌ "Encontré que el WhatsApp es..."

COMPORTAMIENTO: ${intencion === 'factual' ? 'Directo, da el dato que piden sin rodeos' : 
                 intencion === 'precio' ? 'Menciona rangos naturales, pregunta detalles' :
                 intencion === 'comparar' ? 'Destaca beneficios únicos sin ser lista' :
                 intencion === 'soporte' ? 'Empatía inmediata, solución rápida' :
                 intencion === 'objecion' ? 'Valida, muestra valor, pregunta para avanzar' :
                 'Conversación natural, consultiva, busca entender necesidades'}

TONO: ${etapa === 'descubrimiento' ? 'Curioso, pregunta para entender' :
        etapa === 'consideracion' ? 'Informativo, destaca diferenciadores' :
        etapa === 'decision' ? 'Directo, facilita siguiente paso' :
        'Servicial, resolutivo'}

Responde en 1-2 oraciones. Máximo 3. Sé útil y directo.`;
}