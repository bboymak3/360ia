import { Env } from "./types";

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// 1. Manejo de archivos estáticos (Frontend)
		if (url.pathname === "/" || url.pathname.endsWith(".html") || url.pathname.endsWith(".js")) {
			return env.ASSETS.fetch(request);
		}

		// 2. API: REGISTRO DE CLIENTE
		if (url.pathname === "/api/registrar" && request.method === "POST") {
			try {
				const { nombre, email, url: siteUrl } = await request.json() as any;
				
				// Scraper básico para obtener información de la web
				const res = await fetch(siteUrl);
				const html = await res.text();
				const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').substring(0, 5000);
				
				const widgetId = Math.random().toString(36).substring(2, 10);

				// IMPORTANTE: El nombre de la tabla entre comillas dobles ""
				await env.DB.prepare(
					`INSERT INTO "360ia_db" (email_usuario, nombre_negocio, url_web_escaneada, contexto_entrenamiento, widget_id) 
					 VALUES (?, ?, ?, ?, ?)`
				).bind(email, nombre, siteUrl, text, widgetId).run();

				return new Response(JSON.stringify({ success: true, widgetId }), {
					headers: { "Content-Type": "application/json" }
				});
			} catch (e: any) {
				return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500 });
			}
		}

		// 3. API: CHAT DEL BOT
		if (url.pathname === "/api/chat" && request.method === "POST") {
			const { messages, widgetId } = await request.json() as any;

			// IMPORTANTE: El nombre de la tabla entre comillas dobles ""
			const cliente = await env.DB.prepare('SELECT * FROM "360ia_db" WHERE widget_id = ?')
				.bind(widgetId)
				.first() as any;

			if (!cliente) return new Response("Bot no configurado", { status: 404 });

			const systemPrompt = `Eres el asistente de ${cliente.nombre_negocio}. Usa esta info: ${cliente.contexto_entrenamiento}`;
			messages.unshift({ role: "system", content: systemPrompt });

			const aiResponse = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", { messages, stream: true });
			return new Response(aiResponse, { headers: { "content-type": "text/event-stream" } });
		}

		return new Response("Ruta no encontrada", { status: 404 });
	}
};
			const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').substring(0, 7000);

			await env.DB.prepare("UPDATE 360ia_db SET contexto_entrenamiento = ? WHERE widget_id = ?").bind(text, widgetId).run();
			
			return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
		}

		return new Response("No encontrado", { status: 404 });
	}
};
