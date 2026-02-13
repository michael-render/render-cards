const express = require('express');
const path = require('path');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', apiRoutes);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Render Stat Cards running on port ${PORT}`);
  console.log(`AI features: ${process.env.OPENAI_API_KEY ? 'enabled' : 'disabled'}`);
});
