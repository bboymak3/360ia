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
        
        console.log(`[SCRAPING] HTML obtenido: ${html.length} caracteres`);
        
        if (html.length < 100) {
          throw new Error("No se pudo obtener contenido válido de la web");
        }

        const datosExtraidos = extraerDatosDetallados(html, siteUrl);
        
        console.log(`[SCRAPING] WhatsApp: ${datosExtraidos.whatsapp.length}, Teléfonos: ${datosExtraidos.telefonos.length}, Precios: ${datosExtraidos.precios.length}`);
        
        const textoLimpio = limpiarHTMLPreservandoDatos(html, datosExtraidos);

        if (textoLimpio.length < 50) {
          throw new Error("No se pudo extraer contenido procesable");
        }

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
          stats: {
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
          error: err.message
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

        const html = await scrapeInteligente(actual.url_web_escaneada as string);
        const datosExtraidos = extraerDatosDetallados(html, actual.url_web_escaneada as string);
        const nuevoTexto = limpiarHTMLPreservandoDatos(html, datosExtraidos);

        const analisisCambios = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          messages: [
            {
              role: "system",
              content: `Compara cambios. Responde SOLO JSON:
                       {"cambios_detectados": ["..."], "prioridad": "alta|media|baja", "resumen": "..."}`
            },
            {
              role: "user",
              content: `ANTERIOR: ${(actual.contexto_entrenamiento as string).substring(0, 2000)}
                       NUEVO: ${nuevoTexto.substring(0, 2000)}`
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

    // 5. CHAT CON IA NATURAL
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

// ============ SCRAPING INTELIGENTE ============

async function scrapeInteligente(siteUrl: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  
  console.log("[SCRAPING] Intentando con User-Agent Googlebot...");
  
  try {
    const resGoogle = await fetch(siteUrl, { 
      signal: controller.signal,
      headers: { 
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8,en-US;q=0.7,fr;q=0.6,pt;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'max-age=0'
      },
      redirect: 'follow'
    });
    
    clearTimeout(timeoutId);
    
    if (resGoogle.ok) {
      const html = await resGoogle.text();
      
      const esSPAVacio = html.length < 2000 || 
                        (html.includes('id="root"') && html.length < 5000) ||
                        (html.includes('id="app"') && html.length < 5000);
      
      if (!esSPAVacio && html.length > 500) {
        console.log(`[SCRAPING] Éxito con Googlebot: ${html.length} chars`);
        return html;
      }
      
      console.log(`[SCRAPING] Detectado SPA o contenido corto, intentando truco 2...`);
    }
  } catch (e) {
    console.log("[SCRAPING] Falló Googlebot:", (e as Error).message);
  }
  
  console.log("[SCRAPING] Intentando con _escaped_fragment_...");
  
  try {
    const urlConFragment = siteUrl.includes('?') 
      ? `${siteUrl}&_escaped_fragment_=` 
      : `${siteUrl}?_escaped_fragment_=`;
    
    const resFragment = await fetch(urlConFragment, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
        'Accept': 'text/html'
      }
    });
    
    if (resFragment.ok) {
      const html = await resFragment.text();
      if (html.length > 1000) {
        console.log(`[SCRAPING] Éxito con escaped_fragment: ${html.length} chars`);
        return html;
      }
    }
  } catch (e) {
    console.log("[SCRAPING] Falló escaped_fragment");
  }
  
  console.log("[SCRAPING] Intentando fetch normal...");
  
  try {
    const resNormal = await fetch(siteUrl, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html'
      }
    });
    
    if (resNormal.ok) {
      const html = await resNormal.text();
      console.log(`[SCRAPING] Éxito con fetch normal: ${html.length} chars`);
      return html;
    }
  } catch (e) {
    console.log("[SCRAPING] Falló fetch normal");
  }
  
  throw new Error("No se pudo obtener contenido de la URL con ningún método");
}

// ============ EXTRACCIÓN UNIVERSAL DE DATOS ============

interface DatosExtraidos {
  whatsapp: string[];
  telefonos: string[];
  emails: string[];
  precios: string[];
  direcciones: string[];
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
    metaTags: {},
    titulos: [],
    secciones: []
  };

  // WHATSAPP - Universal
  const whatsappRegex = [
    /https?:\/\/wa\.me\/(\d{7,20})/gi,
    /https?:\/\/api\.whatsapp\.com\/send\?phone=(\d{7,20})/gi,
    /whatsapp[:\s]+(\+?\d{7,20})/gi,
    /wa\.me\/(\d{7,20})/gi,
    /chat\.whatsapp\.com\/[A-Za-z0-9]+/gi
  ];

  whatsappRegex.forEach(regex => {
    let match;
    while ((match = regex.exec(html)) !== null) {
      let numero = match[1] || match[0];
      numero = numero.replace(/[^\d+]/g, '');
      if (numero.length >= 7 && !datos.whatsapp.includes(numero)) {
        datos.whatsapp.push(numero);
      }
    }
  });

  // TELÉFONOS - Universal (todos los formatos internacionales)
  const telefonoPatterns = [
    // Formato internacional completo: +1234567890123
    /\+\d{1,4}\d{6,15}/g,
    // Con espacios/guises: +1 234-567-8901, +44 20 7946 0958
    /\+\d{1,4}[\s\-]?\(?\d{1,4}\)?[\s\-]?\d{1,4}[\s\-]?\d{1,4}[\s\-]?\d{0,4}/g,
    // Formatos locales con prefijo: (021) 1234-5678, 020 7946 0958
    /\(?0\d{1,4}\)?[\s\-]?\d{4}[\s\-]?\d{4}/g,
    // Teléfono en texto
    /(?:tel[eé]fono|tel|phone|ll[aá]manos|call|contact)[:\s]+([\+\d\s\-\(\)\.]{7,})/gi,
    // href="tel:+1234567890"
    /href=["']tel:([\+\d\s\-\(\)]{7,})["']/gi
  ];

  telefonoPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      let tel = (match[1] || match[0]).trim();
      tel = tel.replace(/[^\d+]/g, '');
      // Validar longitud internacional (mínimo 7, máximo 15 incluyendo +)
      if (tel.length >= 7 && tel.length <= 16 && !datos.telefonos.includes(tel)) {
        datos.telefonos.push(tel);
      }
    }
  });

  // EMAILS - Universal
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let emailMatch;
  while ((emailMatch = emailRegex.exec(html)) !== null) {
    if (!datos.emails.includes(emailMatch[0])) {
      datos.emails.push(emailMatch[0]);
    }
  }

  // PRECIOS - Universal (todas las monedas)
  const precioPatterns = [
    // Símbolos universales: $, €, £, ¥, ₹, etc.
    /[\$\€\£\¥\₹\₽\₩\R\]\s*[\d.,]+(?:\s*(?:USD|EUR|GBP|JPY|CNY|MXN|CAD|AUD|BRL|ARS|COP|CLP|PEN|UYU|PYG|BOB|VES|Bs\.?|Bolívares?|dollars?|euros?|pounds?|yen?))?/gi,
    // Palabras clave + monto
    /(?:desde|from|a partir de|starting at|price|precio|costo|valor|tarifa|fee)[:\s]*[\$\€\£\¥\₹\₽\₩\R]?[\s]*[\d.,]+/gi,
    // Montos con moneda al final: 1,234.56 USD, 500 euros
    /[\d.,]+\s*(?:USD|EUR|GBP|JPY|CNY|MXN|CAD|AUD|BRL|ARS|COP|CLP|PEN|UYU|PYG|BOB|VES|Bs\.?|Bolívares?|dollars?|euros?|pounds?)/gi,
    // Rangos: $500 - $1000, entre $200 y $500
    /[\$\€\£\¥\₹\₽\₩\R]?\s*[\d.,]+\s*(?:a|-|~|hasta|to|and)\s*[\$\€\£\¥\₹\₽\₩\R]?[\s]*[\d.,]+/gi
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

  // META TAGS
  const metaPatterns = {
    title: /<title[^>]*>([^<]*)<\/title>/i,
    description: /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)/i,
    keywords: /<meta[^>]*name=["']keywords["'][^>]*content=["']([^"']*)/i,
    ogTitle: /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)/i,
    ogDescription: /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)/i,
    ogLocale: /<meta[^>]*property=["']og:locale["'][^>]*content=["']([^"']*)/i
  };

  for (const [key, regex] of Object.entries(metaPatterns)) {
    const match = regex.exec(html);
    if (match) datos.metaTags[key] = match[1].trim();
  }

  // TÍTULOS H1-H4
  const tituloRegex = /<h[1-4][^>]*>([^<]*)<\/h[1-4]>/gi;
  let tituloMatch;
  while ((tituloMatch = tituloRegex.exec(html)) !== null) {
    const titulo = tituloMatch[1].replace(/<[^>]*>/g, '').trim();
    if (titulo.length > 3 && titulo.length < 200) {
      datos.titulos.push(titulo);
    }
  }

  // SECCIONES IMPORTANTES
  const seccionRegex = /<(div|section|article)[^>]*(?:id|class)=["'](?:[^"']*precio|[^"']*price|[^"']*cost|[^"']*tarifa|[^"']*fee|[^"']*contacto|[^"']*contact|[^"']*servicio|[^"']*service|[^"']*producto|[^"']*product|[^"']*about|[^"']*nosotros|[^"']*quienes|[^"']*who)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let seccionMatch;
  while ((seccionMatch = seccionRegex.exec(html)) !== null) {
    const contenido = seccionMatch[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (contenido.length > 20 && contenido.length < 1000) {
      datos.secciones.push(contenido);
    }
  }

  // JSON-LD (Schema.org)
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jsonLdMatch;
  while ((jsonLdMatch = jsonLdRegex.exec(html)) !== null) {
    try {
      const jsonData = JSON.parse(jsonLdMatch[1]);
      const tipos = ['Organization', 'LocalBusiness', 'Store', 'Service', 'Product', 'Restaurant', 'Hotel'];
      
      if (tipos.includes(jsonData['@type'])) {
        if (jsonData.telephone && !datos.telefonos.includes(jsonData.telephone)) {
          datos.telefonos.push(jsonData.telephone);
        }
        if (jsonData.email && !datos.emails.includes(jsonData.email)) {
          datos.emails.push(jsonData.email);
        }
        if (jsonData.priceRange) {
          datos.precios.push(`Rango: ${jsonData.priceRange}`);
        }
        // Dirección
        if (jsonData.address) {
          const direccion = typeof jsonData.address === 'string' 
            ? jsonData.address 
            : [
                jsonData.address.streetAddress,
                jsonData.address.addressLocality,
                jsonData.address.addressRegion,
                jsonData.address.addressCountry
              ].filter(Boolean).join(', ');
          if (direccion.trim()) datos.direcciones.push(direccion);
        }
      }
    } catch (e) {}
  }

  return datos;
}

// ============ LIMPIEZA PRESERVANDO DATOS ============

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
  if (datos.metaTags.ogLocale) metaSection += `Idioma/Región: ${datos.metaTags.ogLocale}\n`;
  seccionesTexto.push(metaSection);

  // 4. TÍTULOS
  if (datos.titulos.length > 0) {
    let titulosSection = "=== SERVICIOS Y SECCIONES ===\n";
    datos.titulos.slice(0, 15).forEach(t => {
      titulosSection += `- ${t}\n`;
    });
    seccionesTexto.push(titulosSection);
  }

  // 5. CONTENIDO DE SECCIONES
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
      if (/tel:|mailto:|price|precio|cost|whatsapp/i.test(content)) {
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
  
  const whatsappMatch = contexto.match(/WhatsApp:\s*(\+?\d[\d\s]+)/);
  const telefonoMatch = contexto.match(/Tel[eé]fonos?:\s*(\+?\d[\d\s]+)/);
  const emailMatch = contexto.match(/Emails?:\s*([^\s@]+@[^\s@]+)/);
  
  const numeroPrincipal = whatsappMatch?.[1]?.trim() || telefonoMatch?.[1]?.trim() || '';
  const emailPrincipal = emailMatch?.[1]?.trim() || '';

  let instrucciones = '';
  
  if (buscaContacto && numeroPrincipal) {
    instrucciones = `
DATO: ${numeroPrincipal}

INSTRUCCIÓN: Responde directo. Ej: "Claro, el número es ${numeroPrincipal}. ¿Necesitas algo más?"`;
  }

  if (buscaPrecio) {
    const preciosMatch = contexto.match(/=== PRECIOS Y TARIFAS ===\n([\s\S]*?)(?:\n===|$)/);
    if (preciosMatch) {
      instrucciones += `
PRECIOS: ${preciosMatch[1].substring(0, 150).replace(/\n/g, ', ')}`;
    }
  }

  return `Eres asistente de ${nombreNegocio}. Hablas como humano profesional, NUNCA como robot.

${instrucciones}

CONOCIMIENTO:
"""
${contexto}
"""

${historialResumido ? `CONVERSACIÓN: ${historialResumido}` : ''}

REGLAS:
1. NUNCA digas "en el contexto", "encontré que", "según la información"
2. NUNCA uses comillas alrededor de datos
3. SIEMPRE responde directo, como si supieras de memoria
4. SI NO SABES: "Déjame conectarte con un especialista"

EJEMPLOS BUENOS:
- "Claro, el WhatsApp es +1 234-567-8901"
- "Tenemos opciones desde $500 USD"

EJEMPLOS PROHIBIDOS:
- ❌ "En la sección === DATOS DE CONTACTO === encontré..."
- ❌ "El número es '+1234567890'"

COMPORTAMIENTO: ${intencion === 'factual' ? 'Directo' : 
                 intencion === 'precio' ? 'Menciona rangos naturales' :
                 intencion === 'comparar' ? 'Destaca beneficios únicos' :
                 intencion === 'soporte' ? 'Empatía inmediata' :
                 intencion === 'objecion' ? 'Valida, muestra valor' :
                 'Conversación natural, consultiva'}

Responde en 1-2 oraciones.`;
}