const express = require('express');
const path = require('path');
const fs = require('fs');
const apiRoutes = require('./routes/api');
const { initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', apiRoutes);

// Ensure card storage directory exists
const storagePath = process.env.CARD_STORAGE_PATH || path.join(__dirname, 'card-images');
fs.mkdirSync(storagePath, { recursive: true });

async function start() {
  try {
    await initDb();
    console.log('Postgres connected');
  } catch (err) {
    console.warn('Database not available — gallery disabled:', err.message);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Render Stat Cards running on port ${PORT}`);
    console.log(`AI features: ${process.env.OPENAI_API_KEY ? 'enabled' : 'disabled'}`);
    console.log(`Card storage: ${storagePath}`);
  });
}

start();
