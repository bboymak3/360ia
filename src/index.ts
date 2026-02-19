import { Env, ChatMessage } from "./types";

const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// 1. HOME Y REGISTRO (Pestaña pública)
		if (url.pathname === "/" || url.pathname === "/index.html") {
			return env.ASSETS.fetch(request);
		}

		// 2. API: REGISTRAR Y ESCANEAR URL
		if (url.pathname === "/api/registrar" && request.method === "POST") {
			return handleRegistration(request, env);
		}

		// 3. API: CHAT DINÁMICO (Usando el Widget ID)
		if (url.pathname === "/api/chat" && request.method === "POST") {
			return handleChatRequest(request, env);
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * LÓGICA DE REGISTRO Y SCRAPING
 */
async function handleRegistration(request: Request, env: Env): Promise<Response> {
	try {
		const { email, url, nombre } = await request.json() as any;
		
		// Scraper básico integrado
		const siteRes = await fetch(url);
		const html = await siteRes.text();
		const textoLimpio = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').substring(0, 8000);

		const widgetId = btoa(email + Date.now()).substring(0, 10);

		// Guardar en tu DB 360ia_db
		await env.DB.prepare(
			"INSERT INTO 360ia_db (email_usuario, nombre_negocio, url_web_escaneada, contexto_entrenamiento, widget_id) VALUES (?, ?, ?, ?, ?)"
		).bind(email, nombre, url, textoLimpio, widgetId).run();

		return new Response(JSON.stringify({ success: true, widgetId }), {
			headers: { "Content-Type": "application/json" }
		});
	} catch (e) {
		return new Response(JSON.stringify({ error: e.message }), { status: 500 });
	}
}

/**
 * LÓGICA DEL CHAT CON CONTEXTO DE DB
 */
async function handleChatRequest(request: Request, env: Env): Promise<Response> {
	const { messages, widgetId } = await request.json() as any;

	// Buscar el contexto del cliente en la DB
	const cliente = await env.DB.prepare("SELECT * FROM 360ia_db WHERE widget_id = ?")
		.bind(widgetId)
		.first() as any;

	if (!cliente) return new Response("Cliente no encontrado", { status: 404 });

	const systemPrompt = `Eres el asistente de ${cliente.nombre_negocio}. Usa esta info: ${cliente.contexto_entrenamiento}`;
	messages.unshift({ role: "system", content: systemPrompt });

	const stream = await env.AI.run(MODEL_ID, { messages, stream: true });
	return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}
