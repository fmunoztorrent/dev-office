// `npm start`: la oficina sin interfaz de terminal (API + vista web en el navegador).
import { startServer, DEFAULT_PORT, DEFAULT_HOST } from './server.js';

const port = Number(process.env.PORT) || DEFAULT_PORT;
const host = process.env.HOST || DEFAULT_HOST;

try {
  // DEV_TEAM_OFFICE_PROJECTS: proyectos para el diálogo de encargos, separados por ":"
  const projects = (process.env.DEV_TEAM_OFFICE_PROJECTS || '').split(':').filter(Boolean);
  const server = await startServer({ port, host, log: console.log, projects });
  const stop = async () => { await server.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (err) {
  if (err.code === 'EADDRINUSE') {
    console.error(`El puerto ${port} ya está en uso (¿otra instancia de la oficina corriendo?).`);
    console.error('Ciérrala, o usa otro puerto:  PORT=4318 npm start');
  } else {
    console.error(err.message);
  }
  process.exit(1);
}
