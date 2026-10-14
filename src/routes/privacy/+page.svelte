<script lang="ts">
	import { ArrowLeft, ShieldCheck } from 'lucide-svelte';
	import { getLocale } from '#paraglide/runtime.js';

	const copy = {
		en: {
			title: 'Privacy policy',
			intro:
				'This policy explains what BA Eventos collects, why we use it, and the choices available to you.',
			updated: 'Last updated: October 14, 2026',
			sections: [
				{
					title: 'Information we collect',
					body: [
						'If you create an account, we receive your email address and basic profile information. Google sign-in may provide your name and profile image. We use this information only to create your account, authenticate you, and display your profile.',
						'If you are signed in, we store your saved events, language preference, profile name, and chat conversations. Guest chat history is stored in your browser. To troubleshoot failures, we also keep a protected server-side diagnostic copy of guest chat text, language, IP address, and request details for up to 30 days.',
						'When you send feedback, we store the message and, if you are signed in, your user ID. We may email the feedback to the site operator so it can be reviewed.',
						'In the Telegram private-chat pilot, we process your Telegram user and chat identifiers and the messages you send. For identity, BA Eventos stores only a one-way HMAC, not your raw Telegram identifiers, username, or name; conversation messages are stored for the retention period below after the bot shows a privacy notice and you continue using it. Telegram is not linked to a BA Eventos account, and event saving is unavailable there.'
					]
				},
				{
					title: 'Google user data',
					body: [
						'BA Eventos uses Google only for sign-in. We request basic identity information: your email address and public profile information. We do not request access to Gmail, Drive, Calendar, contacts, or other Google services.',
						'We do not sell Google user data or use it for advertising.'
					]
				},
				{
					title: 'Chat and AI processing',
					body: [
						'Your chat messages, including Telegram messages, are sent to AI service providers, including DeepSeek and OpenAI, when needed to understand your request, search events, and generate a response. The bot shows a privacy notice describing this processing; continued use indicates agreement. The webhook uses a transient encrypted handoff to deliver requests. Do not include sensitive personal information in a chat message.'
					]
				},
				{
					title: 'Product analytics',
					body: [
						'On baeventos.com, PostHog records page views, interaction and scroll metadata, session replays, and limited product events such as message length, response time, event clicks, saves, optional helpfulness ratings linked by an opaque response identifier, errors, and language. Session replay records page text, attributes and entered values without masking. People with access to our PostHog recordings can view that content. Google Analytics records acquisition, redacted page paths, and the same limited product outcomes without user IDs. We do not include email addresses, chat text, search text, feedback text, or error messages in custom analytics events. PostHog respects Do Not Track and Global Privacy Control. Google Analytics respects Do Not Track.'
					]
				},
				{
					title: 'Service providers',
					body: [
						'We use service providers to run BA Eventos: Supabase for authentication, stored account data, and Telegram pilot conversations; Cloudflare Workers for the Telegram webhook and encrypted background processing; Google for optional sign-in and limited analytics; DeepSeek and OpenAI for AI processing; PostHog for limited product analytics; and Resend for feedback alerts. These providers may process data outside Argentina under their own terms and privacy policies.'
					]
				},
				{
					title: 'Retention and your choices',
					body: [
						'Account data is kept while your account is active. You can delete your account, profile, saved events, and account conversations from Settings. You can delete guest conversations in the app or clear them by removing this site’s browser data. Telegram pilot data is kept for no more than 30 days. Using /delete immediately removes the conversation and HMAC identity; a minimal operational delivery record, without chat or user identifiers or message text, may remain until it ages out. A feedback message may be retained for review after account deletion, without its link to your account.',
						'You may ask to access, correct, update, or delete your personal data. In Argentina, these rights are protected by Law 25,326. Use the Feedback option in BA Eventos to contact us about a privacy request.'
					]
				},
				{
					title: 'Changes',
					body: [
						'We may update this policy when the product or its data practices change. The date above shows the latest revision.'
					]
				}
			]
		},
		es: {
			title: 'Política de privacidad',
			intro:
				'Esta política explica qué recopila BA Eventos, para qué lo usamos y qué opciones tenés.',
			updated: 'Última actualización: 14 de octubre de 2026',
			sections: [
				{
					title: 'Información que recopilamos',
					body: [
						'Si creás una cuenta, recibimos tu correo electrónico e información básica de perfil. El acceso con Google puede proporcionar tu nombre y foto de perfil. Usamos esta información únicamente para crear tu cuenta, autenticarte y mostrar tu perfil.',
						'Si iniciás sesión, guardamos tus eventos, preferencia de idioma, nombre de perfil y conversaciones. El historial de chat de invitado se guarda en tu navegador. Para diagnosticar fallas, también conservamos una copia protegida en el servidor con el texto del chat, idioma, dirección IP y detalles de la solicitud durante un máximo de 30 días.',
						'Cuando enviás comentarios, guardamos el mensaje y, si iniciaste sesión, tu identificador de usuario. Podemos enviar el comentario por correo al responsable del sitio para revisarlo.',
						'En el piloto de chat privado de Telegram, procesamos tus identificadores de usuario y chat de Telegram y los mensajes que enviás. Para la identidad, BA Eventos guarda únicamente un HMAC unidireccional, no tus identificadores sin procesar, usuario ni nombre de Telegram; los mensajes se guardan durante el plazo indicado abajo después de que el bot muestra un aviso de privacidad y continuás usándolo. No vinculamos Telegram con una cuenta de BA Eventos y allí no se pueden guardar eventos.'
					]
				},
				{
					title: 'Datos de Google',
					body: [
						'BA Eventos usa Google únicamente para iniciar sesión. Solicitamos información básica de identidad: tu correo electrónico y datos públicos de perfil. No solicitamos acceso a Gmail, Drive, Calendar, contactos ni otros servicios de Google.',
						'No vendemos datos de Google ni los usamos para publicidad.'
					]
				},
				{
					title: 'Chat y procesamiento con IA',
					body: [
						'Tus mensajes, incluidos los mensajes de Telegram, se envían a proveedores de IA, incluidos DeepSeek y OpenAI, cuando es necesario para interpretar tu pedido, buscar eventos y generar una respuesta. El bot muestra un aviso de privacidad sobre este procesamiento; al continuar usándolo, indicás tu acuerdo. El webhook usa una transferencia cifrada transitoria para entregar las solicitudes. No incluyas información personal sensible en un mensaje.'
					]
				},
				{
					title: 'Analítica del producto',
					body: [
						'En baeventos.com, PostHog registra visitas de páginas, metadatos de interacción y desplazamiento, repeticiones de sesión y eventos limitados del producto, como longitud del mensaje, tiempo de respuesta, clics en eventos, guardados, valoraciones opcionales de utilidad vinculadas por un identificador opaco de respuesta, errores e idioma. Las repeticiones de sesión registran el texto de las páginas, atributos y valores ingresados sin ocultarlos. Las personas con acceso a nuestras grabaciones de PostHog pueden ver ese contenido. Google Analytics registra la adquisición, rutas de página protegidas y los mismos resultados limitados del producto sin identificadores de usuario. No incluimos correos electrónicos, texto de chats o búsquedas, comentarios ni mensajes de error en eventos de analítica personalizados. Google Analytics respeta Do Not Track.'
					]
				},
				{
					title: 'Proveedores',
					body: [
						'Usamos proveedores para operar BA Eventos: Supabase para autenticación, datos de cuenta y conversaciones del piloto de Telegram; Cloudflare Workers para el webhook de Telegram y el procesamiento cifrado en segundo plano; Google para el acceso opcional y analítica limitada; DeepSeek y OpenAI para procesamiento con IA; PostHog para analítica limitada; y Resend para alertas de comentarios. Estos proveedores pueden procesar datos fuera de Argentina según sus propios términos y políticas de privacidad.'
					]
				},
				{
					title: 'Conservación y tus opciones',
					body: [
						'Conservamos los datos de la cuenta mientras esté activa. Podés eliminar tu cuenta, perfil, eventos guardados y conversaciones de la cuenta desde Configuración. Podés borrar conversaciones de invitado en la app o eliminar los datos de este sitio del navegador. Los datos del piloto de Telegram se conservan como máximo 30 días. Al usar /delete se borran inmediatamente la conversación y la identidad HMAC; un registro operativo mínimo de entrega, sin identificadores de chat o usuario ni texto de mensajes, puede permanecer hasta vencer. Un comentario puede conservarse para revisión después de eliminar la cuenta, sin el vínculo con tu cuenta.',
						'Podés pedir acceso, rectificación, actualización o supresión de tus datos personales. En Argentina, estos derechos están protegidos por la Ley 25.326. Usá la opción Comentarios de BA Eventos para contactarnos por una solicitud de privacidad.'
					]
				},
				{
					title: 'Cambios',
					body: [
						'Podemos actualizar esta política cuando cambien el producto o sus prácticas de datos. La fecha de arriba indica la última revisión.'
					]
				}
			]
		}
	} as const;

	const locale = getLocale() === 'es' ? 'es' : 'en';
	const text = copy[locale];
</script>

<svelte:head>
	<title>{text.title} | BA Eventos</title>
	<meta name="description" content={text.intro} />
</svelte:head>

<div class="h-full overflow-auto px-5 py-8 sm:px-8">
	<article class="mx-auto max-w-3xl pb-12">
		<a
			href="/"
			class="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
		>
			<ArrowLeft class="h-4 w-4" />
			BA Eventos
		</a>

		<header class="mb-10 border-b border-border/60 pb-8">
			<div class="mb-4 flex items-center gap-3">
				<div class="rounded-lg border border-primary/20 bg-primary/10 p-2">
					<ShieldCheck class="h-5 w-5 text-primary" />
				</div>
				<h1 class="font-display text-3xl font-semibold tracking-tight">{text.title}</h1>
			</div>
			<p class="max-w-2xl text-base leading-7 text-muted-foreground">{text.intro}</p>
			<p class="mt-3 text-sm text-muted-foreground">{text.updated}</p>
		</header>

		<div class="space-y-9">
			{#each text.sections as section (section.title)}
				<section>
					<h2 class="font-display mb-3 text-xl font-medium">{section.title}</h2>
					<div class="space-y-3 text-[0.95rem] leading-7 text-foreground/80">
						{#each section.body as paragraph (paragraph)}
							<p>{paragraph}</p>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	</article>
</div>
