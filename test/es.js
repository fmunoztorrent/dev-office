// Tests that check texts check them in Spanish: this module is imported first.
import { setLanguage } from '../public/i18n.js';

process.env.DEV_TEAM_OFFICE_LANG = 'es';
setLanguage('es');
