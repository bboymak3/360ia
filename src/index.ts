export interface Env {
	DB: D1Database;
	AI: any;
	ASSETS: fetcher;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// 1. MANEJO DE ARCHIVOS ESTÁTICOS (Frontend: index, dashboard, login, widget)
		if (url.pathname === "/" || url.pathname.endsWith(".html") || url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) {
			return await env.ASSETS.fetch(request);
		}

		// 2. API: REGISTRO Y SCRAPING
		if (url.pathname === "/api/registrar" && request.method === "POST") {
			try {
				const { nombre, email, url: siteUrl } = await request.json() as any;

				// Scraper: Leemos la web del cliente
				const response = await fetch(siteUrl);
				const html = await response.text();
				// Limpiamos el HTML para dejar solo texto útil (máximo 4000 caracteres)
				const textoLimpio = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').substring(0, 4000);

				const widgetId = Math.random().toString(36).substring(2, 10);

				// INSERT con comillas dobles para evitar el error de "360"
				await env.DB.prepare(
					`INSERT INTO "360ia_db" (email_usuario, nombre_negocio, url_web_escaneada, contexto_entrenamiento, widget_id) VALUES (?, ?, ?, ?, ?)`
				).bind(email, nombre, siteUrl, textoLimpio, widgetId).run();

				return new Response(JSON.stringify({ success: true, widgetId }), {
					headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
				});

			} catch (error: any) {
				return new Response(JSON.stringify({ success: false, error: error.message }), {
					status: 500,
					headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
				});
			}
		}

		// 3. API: LOGIN
		if (url.pathname === "/api/login" && request.method === "POST") {
			try {
				const { email } = await request.json() as any;
				const cliente: any = await env.DB.prepare('SELECT widget_id, nombre_negocio FROM "360ia_db" WHERE email_usuario = ?')
					.bind(email)
					.first();

				if (cliente) {
					return new Response(JSON.stringify({ 
						success: true, 
						widgetId: cliente.widget_id, 
						nombre: cliente.nombre_negocio 
					}), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
				} else {
					return new Response(JSON.stringify({ success: false, error: "Email no registrado" }), { 
						status: 404,
						headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
					});
				}
			} catch (error: any) {
				return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
			}
		}

		// 4. NUEVA RUTA: OBTENER DATOS PARA EL DASHBOARD (Estabilidad de datos)
		if (url.pathname === "/api/datos-cliente" && request.method === "GET") {
			try {
				const id = url.searchParams.get("id");
				const cliente: any = await env.DB.prepare('SELECT nombre_negocio, contexto_entrenamiento FROM "360ia_db" WHERE widget_id = ?')
					.bind(id)
					.first();

				if (cliente) {
					return new Response(JSON.stringify({ 
						success: true, 
						nombre: cliente.nombre_negocio, 
						contexto: cliente.contexto_entrenamiento 
					}), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
				}
				return new Response(JSON.stringify({ success: false }), { status: 404 });
			} catch (error: any) {
				return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
			}
		}

		// 5. API: CHAT DE LA IA
		if (url.pathname === "/api/chat" && request.method === "POST") {
			try {
				const { messages, widgetId } = await request.json() as any;

				const cliente: any = await env.DB.prepare('SELECT * FROM "360ia_db" WHERE widget_id = ?')
					.bind(widgetId)
					.first();

				if (!cliente) {
					return new Response(JSON.stringify({ error: "Widget no encontrado" }), { status: 404 });
				}

				const systemPrompt = `Eres un asistente inteligente para el negocio "${cliente.nombre_negocio}". 
				Usa la siguiente información para responder dudas: ${cliente.contexto_entrenamiento}. 
				Responde de forma amable y profesional en español.`;

				messages.unshift({ role: "system", content: systemPrompt });

				const aiRes = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
					messages: messages,
					stream: true,
				});

				return new Response(aiRes, {
					headers: { "content-type": "text/event-stream", "Access-Control-Allow-Origin": "*" },
				});

			} catch (error: any) {
				return new Response(JSON.stringify({ error: error.message }), { status: 500 });
			}
		}

		return new Response("Ruta no encontrada", { status: 404 });
	},
};