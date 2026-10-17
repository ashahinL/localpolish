import preact from '@preact/preset-vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  outDirTemplate: '.',
  vite: () => ({
    plugins: [preact()],
  }),
  manifest: {
    name: 'LocalPolish',
    description:
      'Private writing assistant: fix and rephrase text in any field using your own AI subscriptions.',
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoyrMQ5xUDqTXT2eIU4bzerK4IF6mT8P3vU/hHWVsE+3iIHZwvNCe/E/rgjRYpiddQBK+iKbxvVsN+NsJQJA3Lq35LnKMSf3ZQIMS6epCsGjnXZJ+PGF4Ak1udIe7eBeZ1qe63zo/fzKFUJ+jgUFEab49vpkhssWhvsMw7g2AoLBZ2xcnuW77J3ujaWWoIQnCQuCX9qPoTwEhujjKTC2OJvDM0CAdq9/uOGTTbleCEFlIce2hm8ffEXFIdMOkhLdVa7f4/pa1pBZIAnq5egzmLLWrpEpFv2UgeSMzpcihEagoErndkTudeKeHp+pKHJU9X/rKldWhv63x+FRA5KK0EwIDAQAB',
    permissions: ['storage', 'nativeMessaging'],
    host_permissions: ['<all_urls>'],
    commands: {
      polish: {
        suggested_key: {
          default: 'Ctrl+Shift+K',
          mac: 'Command+Shift+K',
        },
        description: 'Polish the selected text',
      },
    },
  },
});
