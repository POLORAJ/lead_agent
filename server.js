require('dotenv').config();
const express = require('express');
const path = require('path');
const { Parser } = require('json2csv');
const { runSearch, sourceGoogle, sourceJustDial, sourceInstagram, sourceLinkedIn, sourceOSM, buildLead } = require('./leadsAgent');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// SSE search stream
app.get('/search', async (req, res) => {
  const { business_type, location, max_leads = 20 } = req.query;
  if (!business_type || !location) {
    return res.status(400).json({ error: 'business_type and location are required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let cancelled = false;
  req.on('close', () => { cancelled = true; });

  const gen = runSearch(business_type, location, parseInt(max_leads));
  for await (const chunk of gen) {
    if (cancelled || res.writableEnded) break;
    res.write(chunk);
  }
  if (!res.writableEnded) res.end();
});

// CSV download
app.post('/download', async (req, res) => {
  const { business_type, location, max_leads = 20 } = req.body;
  if (!business_type || !location) {
    return res.status(400).json({ error: 'business_type and location are required' });
  }

  try {
    let allPlaces = [];
    allPlaces = allPlaces.concat(await sourceGoogle(business_type, location, max_leads));
    allPlaces = allPlaces.concat(await sourceJustDial(business_type, location));
    allPlaces = allPlaces.concat(await sourceInstagram(business_type, location));
    allPlaces = allPlaces.concat(await sourceLinkedIn(business_type, location));
    allPlaces = allPlaces.concat(await sourceOSM(business_type, location));

    const leads = [];
    const seen = new Set();
    for (const place of allPlaces) {
      if (leads.length >= max_leads) break;
      const name = (place.name || '').trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      leads.push(await buildLead(place));
    }

    if (!leads.length) return res.status(404).json({ error: 'No leads found' });

    const parser = new Parser({ fields: Object.keys(leads[0]) });
    const csv = parser.parse(leads);
    const fname = `leads_${business_type.replace(/ /g, '_')}_${location.split(',')[0].trim()}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WebNest Lead Agent running at http://localhost:${PORT}`));
