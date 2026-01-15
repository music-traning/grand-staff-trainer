import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

export default defineConfig({
	plugins: [
		sveltekit(),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			manifest: {
				name: 'Grand Staff Trainer',
				short_name: 'StaffTrainer',
				description: 'Guitar & Bass Sight Reading Trainer',
				theme_color: '#050505',
				background_color: '#050505',
				display: 'standalone',
				scope: '/',
				start_url: '/',
				icons: [
					{
						src: 'pwa-192.png',
						sizes: '192x192',
						type: 'image/png'
					},
					{
						src: 'pwa-512.png',
						sizes: '512x512',
						type: 'image/png'
					}
				]
			}
		})
	]
});