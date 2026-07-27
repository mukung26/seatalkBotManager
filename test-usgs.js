const https = require('https');
https.get('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    const ph = json.features.filter(f => f.properties.place.toLowerCase().includes('philippines'));
    console.log(ph.map(f => f.properties.title));
  });
});
