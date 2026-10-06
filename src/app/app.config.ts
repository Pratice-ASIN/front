import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import localeFr from '@angular/common/locales/fr';

import { currentUserInterceptor } from './api';

// Amounts and dates in French format (e.g. 3 100 FCFA).
registerLocaleData(localeFr);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([currentUserInterceptor])),
    { provide: LOCALE_ID, useValue: 'fr' },
  ],
};
