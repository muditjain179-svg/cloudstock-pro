import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Custom plugin to update Service Worker version during build
const swVersionPlugin = () => {
  return {
    name: 'sw-version-plugin',
    buildStart() {
      try {
        const swPath = path.resolve(__dirname, 'public/sw.js');
        if (fs.existsSync(swPath)) {
          let content = fs.readFileSync(swPath, 'utf-8');
          const timestamp = Date.now();
          // Replace CACHE_VERSION or CACHE_NAME value
          content = content.replace(
            /(const CACHE_VERSION\s*=\s*['"])([^'"]*)(['"])/,
            `$1${timestamp}$3`
          ).replace(
            /(const CACHE_NAME\s*=\s*['"])([^'"]*)(['"])/,
            `$1cloudstock-${timestamp}$3`
          );
          fs.writeFileSync(swPath, content);
          console.log(`[Vite Plugin] Service Worker version updated to: ${timestamp}`);
        }
      } catch (err) {
        console.error('[Vite Plugin] Error updating Service Worker version:', err);
      }
    }
  };
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  
  // Expose all VITE_ prefixed environment variables to process.env
  const viteEnv = Object.keys(env)
    .filter((key) => key.startsWith('VITE_'))
    .reduce((acc, key) => {
      acc[`process.env.${key}`] = JSON.stringify(env[key]);
      return acc;
    }, {} as Record<string, string>);

  return {
    plugins: [react(), tailwindcss(), swVersionPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      ...viteEnv,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor': ['react', 'react-dom', 'react-router-dom', 'lucide-react', 'motion'],
            'firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore']
          }
        }
      },
      chunkSizeWarningLimit: 1000
    },
  };
});
