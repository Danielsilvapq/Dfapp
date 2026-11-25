const { openDb } = require('./db');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
const app = createApp(openDb());
app.listen(PORT, () => {
  console.log(`Gestão de Leads rodando em http://localhost:${PORT}`);
  console.log(`Formulário público (link na bio): http://localhost:${PORT}/formulario`);
});
