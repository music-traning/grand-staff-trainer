<script>
  // 【重要】SvelteKit専用の読み込み方です
  import { injectAnalytics } from '@vercel/analytics/sveltekit';
  import { dev } from '$app/environment';

  // アプリが起動した瞬間に解析を開始するコマンド
  // dev（開発中）か production（本番）かを自動判別させます
  injectAnalytics({ mode: dev ? 'development' : 'production' });
</script>

<slot />