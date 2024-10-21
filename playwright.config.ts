import type { PlaywrightTestConfig } from '@playwright/test';
import { devices } from '@playwright/test';

const config: PlaywrightTestConfig = {
  timeout: 100 * 1000, // 100 secondes, c'est bon
  //testMatch: ["e2e/GrandLivre.spec.ts"],
  //testMatch: ["e2e/CompteAPayerFournisseurs.spec.ts"],
  workers: process.env.CI ? 2 : undefined,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 1, // Moins de retries en développement local
  use: {
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: "only-on-failure",
    baseURL: "https://logic.cogiweb.com",
    // baseURL: "https://formation-logic.cogiweb.com/",

    // Ajouts recommandés
    actionTimeout: 15000, // 15 secondes pour les actions comme les clics
    navigationTimeout: 30000, // 30 secondes pour les navigations
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true, // Ignore les erreurs HTTPS si nécessaire
  },
  projects: [
    {
      name: 'Chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
    },
    /* {
      name: 'Firefox',
      use: {
        ...devices['Desktop Firefox'],
      },
    }, */
  ],
  // Ajouts recommandés
  reporter: [
    ['html'],
    ['list'],
    ['junit', { outputFile: 'test-results/results.xml' }]
  ],
  expect: {
    timeout: 10000, // 10 secondes pour les assertions
  },
};

export default config;