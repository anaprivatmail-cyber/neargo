// netlify/functions/check-env.js (ESM)
export const handler = async () => {
	const mask = (v) => (v ? true : false);
	try {
		const out = {
			ok: true,
			env: {
				SUPABASE_URL: mask(process.env.SUPABASE_URL),
				SUPABASE_SERVICE_ROLE_KEY: mask(process.env.SUPABASE_SERVICE_ROLE_KEY),
				SUPABASE_ANON_KEY: mask(process.env.SUPABASE_ANON_KEY),
				STRIPE_SECRET_KEY: mask(process.env.STRIPE_SECRET_KEY),
				STRIPE_WEBHOOK_SECRET: mask(process.env.STRIPE_WEBHOOK_SECRET),
				PUBLIC_BASE_URL: mask(process.env.PUBLIC_BASE_URL || process.env.URL || process.env.SITE_URL),
				EMAIL_FROM: mask(process.env.EMAIL_FROM),
				SUPPORT_EMAIL: mask(process.env.SUPPORT_EMAIL),
				BREVO_API_KEY: mask(process.env.BREVO_API_KEY),
				SMTP: {
					host: mask(process.env.SMTP_HOST),
					port: mask(process.env.SMTP_PORT),
					user: mask(process.env.SMTP_USER),
					pass: mask(process.env.SMTP_PASS)
				}
			}
		};
		return {
			statusCode: 200,
			headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
			body: JSON.stringify(out)
		};
	} catch (e) {
		return {
			statusCode: 200,
			headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
			body: JSON.stringify({ ok: false, error: String(e?.message || e) })
		};
	}
};
