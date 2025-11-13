 import { defineConfig } from 'vite';
 import electron from 'vite-plugin-electron';
 import path from 'node:path';
 
 export default defineConfig({
  plugins: [
    electron({
      main: {
        entry: 'electron/main.ts',
        onstart({ startup }) {
          // Launch Electron once Vite dev server is ready
          startup();
        }
      },
      preload: {
        input: {
          preload: path.join(__dirname, 'electron/preload.ts')
        }
      },
      renderer: {}
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer')
    }
  }
 });