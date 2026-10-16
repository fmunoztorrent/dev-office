// Los tests que comprueban textos los comprueban en español: este módulo se importa primero.
import { setLanguage } from '../public/i18n.js';

process.env.DEV_TEAM_OFFICE_LANG = 'es';
setLanguage('es');
