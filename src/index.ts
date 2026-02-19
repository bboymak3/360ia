export interface Env {
	DB: D1Database;
	AI: any;
	ASSETS: fetcher;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// 1. Servir archivos de la carpeta /public (index.html, etc.)
		if (url.pathname === "/" || url.pathname.endsWith(".html") || url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) {
			return await env.ASSETS.fetch(request);
		}

		// 2. API: REGISTRO Y SCRAPING
		if (url.pathname === "/api/registrar" && request.method === "POST") {
			try {
				const { nombre, email, url: siteUrl } = await request.json() as any;

				// Scraper: Intentamos leer la web
				const response = await fetch(siteUrl);
				const html = await response.text();
				// Limpiamos el HTML para que no ocupe tanto espacio
				const textoLimpio = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').substring(0, 4000);

				const widgetId = Math.random().toString(36).substring(2, 10);

				// Guardamos en la tabla con COMILLAS por el nombre 360ia_db
				await env.DB.prepare(
					`INSERT INTO "360ia_db" (email_usuario, nombre_negocio, url_web_escaneada, contexto_entrenamiento, widget_id) VALUES (?, ?, ?, ?, ?)`
				).bind(email, nombre, siteUrl, textoLimpio, widgetId).run();

				return new Response(JSON.stringify({ success: true, widgetId }), {
					headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
				});

			} catch (error: any) {
				return new Response(JSON.stringify({ success: false, error: error.message }), {
					status: 500,
					headers: { "Content-Type": "application/json" }
				});
			}
		}

		// 3. API: CHAT DE LA IA
		if (url.pathname === "/api/chat" && request.method === "POST") {
			try {
				const { messages, widgetId } = await request.json() as any;

				// Buscamos al cliente en la DB
				const cliente: any = await env.DB.prepare('SELECT * FROM "360ia_db" WHERE widget_id = ?')
					.bind(widgetId)
					.first();

				if (!cliente) {
					return new Response(JSON.stringify({ error: "Widget no encontrado" }), { status: 404 });
				}

				const systemPrompt = `Eres un asistente inteligente para el negocio "${cliente.nombre_negocio}". 
				Usa la siguiente información para responder a los clientes: ${cliente.contexto_entrenamiento}. 
				Sé amable, profesional y responde en español.`;

				// Añadimos el prompt de sistema al inicio
				messages.unshift({ role: "system", content: systemPrompt });

				const aiRes = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
					messages: messages,
					stream: true,
				});

				return new Response(aiRes, {
					headers: { "content-type": "text/event-stream" },
				});

			} catch (error: any) {
				return new Response(JSON.stringify({ error: error.message }), { status: 500 });
			}
		}

		return new Response("No encontrado", { status: 404 });
	},
};
