import { Env } from "./types";

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// Rutas de archivos estáticos (Frontend)
		if (url.pathname === "/" || url.pathname.endsWith(".html")) {
			return env.ASSETS.fetch(request);
		}

		// API: Registro de nuevos usuarios
		if (url.pathname === "/api/registrar" && request.method === "POST") {
			const { nombre, email, url: siteUrl } = await request.json() as any;
			
			// Scraping inicial
			const res = await fetch(siteUrl);
			const html = await res.text();
			const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').substring(0, 7000);
			
			const widgetId = crypto.randomUUID().substring(0, 8);

			await env.DB.prepare(
				"INSERT INTO 360ia_db (email_usuario, nombre_negocio, url_web_escaneada, contexto_entrenamiento, widget_id) VALUES (?, ?, ?, ?, ?)"
			).bind(email, nombre, siteUrl, text, widgetId).run();

			return new Response(JSON.stringify({ success: true, widgetId }), { headers: { "Content-Type": "application/json" } });
		}

		// API: Sincronización desde el Dashboard
		if (url.pathname === "/api/sincronizar" && request.method === "POST") {
			const { widgetId } = await request.json() as any;
			const cliente = await env.DB.prepare("SELECT url_web_escaneada FROM 360ia_db WHERE widget_id = ?").bind(widgetId).first() as any;
			
			const res = await fetch(cliente.url_web_escaneada);
			const html = await res.text();
			const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').substring(0, 7000);

			await env.DB.prepare("UPDATE 360ia_db SET contexto_entrenamiento = ? WHERE widget_id = ?").bind(text, widgetId).run();
			
			return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
		}

		return new Response("No encontrado", { status: 404 });
	}
};
