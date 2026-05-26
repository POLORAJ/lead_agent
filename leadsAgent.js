const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

const SERPAPI_KEY = process.env.SERPAPI_KEY;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

const CITY_COORDS = {
  guwahati:   [26.1445, 91.7362],
  mumbai:     [19.0760, 72.8777],
  delhi:      [28.6139, 77.2090],
  bangalore:  [12.9716, 77.5946],
  bengaluru:  [12.9716, 77.5946],
  hyderabad:  [17.3850, 78.4867],
  chennai:    [13.0827, 80.2707],
  kolkata:    [22.5726, 88.3639],
  pune:       [18.5204, 73.8567],
  ahmedabad:  [23.0225, 72.5714],
  jaipur:     [26.9124, 75.7873],
  surat:      [21.1702, 72.8311],
  lucknow:    [26.8467, 80.9462],
  nagpur:     [21.1458, 79.0882],
  indore:     [22.7196, 75.8577],
  bhopal:     [23.2599, 77.4126],
  patna:      [25.5941, 85.1376],
  coimbatore: [11.0168, 76.9558],
  shilchar:   [24.8333, 92.7789],
  silchar:    [24.8333, 92.7789],
  dibrugarh:  [27.4728, 94.9120],
};

const BUSINESS_OSM_TAGS = {
  dental:      [['amenity','dentist'],['amenity','clinic']],
  dentist:     [['amenity','dentist']],
  gym:         [['leisure','fitness_centre'],['leisure','sports_centre'],['amenity','gym']],
  gyms:        [['leisure','fitness_centre'],['leisure','sports_centre'],['amenity','gym']],
  fitness:     [['leisure','fitness_centre'],['leisure','sports_centre']],
  restaurant:  [['amenity','restaurant'],['amenity','fast_food']],
  restaurants: [['amenity','restaurant'],['amenity','fast_food']],
  cafe:        [['amenity','cafe']],
  cafes:       [['amenity','cafe']],
  salon:       [['shop','hairdresser'],['shop','beauty']],
  salons:      [['shop','hairdresser'],['shop','beauty']],
  coaching:    [['amenity','school'],['amenity','college']],
  clinic:      [['amenity','clinic'],['amenity','doctors']],
  hospital:    [['amenity','hospital'],['amenity','clinic']],
  hospitals:   [['amenity','hospital'],['amenity','clinic']],
  pharmacy:    [['amenity','pharmacy']],
  pharmacies:  [['amenity','pharmacy']],
  hotel:       [['tourism','hotel'],['tourism','guest_house']],
  hotels:      [['tourism','hotel'],['tourism','guest_house']],
  spa:         [['leisure','spa'],['shop','beauty']],
  spas:        [['leisure','spa'],['shop','beauty']],
};

async function geocodeLocation(location) {
  const cityKey = location.toLowerCase().split(',')[0].trim();
  if (CITY_COORDS[cityKey]) return CITY_COORDS[cityKey];
  try {
    const res = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: location, format: 'json', limit: 1 },
      headers: { 'User-Agent': 'WebNestLeadAgent/1.0' },
      timeout: 8000,
    });
    if (res.data.length) return [parseFloat(res.data[0].lat), parseFloat(res.data[0].lon)];
  } catch (e) {
    console.error('  Nominatim failed:', e.message);
  }
  throw new Error(`Could not geocode "${location}". Add it to CITY_COORDS.`);
}

async function sourceGoogle(businessType, location, maxLeads) {
  const places = [];
  try {
    const res = await axios.get('https://serpapi.com/search', {
      params: { engine: 'google_maps', q: `${businessType} in ${location}`, api_key: SERPAPI_KEY, hl: 'en', gl: 'in', type: 'search' },
      timeout: 15000,
    });
    for (const r of (res.data.local_results || [])) {
      if (typeof r !== 'object') continue;
      places.push({
        name: r.title || r.name || '',
        phone: r.phone || null,
        website: r.website || null,
        email: null,
        address: r.address || null,
        googleMapsLink: r.directions || r.place_id_search || null,
        source: 'Google Maps',
      });
    }
    console.log(`  Google Maps → ${places.length} results`);
  } catch (e) {
    console.error('  Google Maps failed:', e.message);
  }

  if (!places.length) {
    try {
      const res = await axios.get('https://serpapi.com/search', {
        params: { engine: 'google', q: `${businessType} in ${location}`, api_key: SERPAPI_KEY, num: maxLeads, hl: 'en', gl: 'in' },
        timeout: 15000,
      });
      const results = res.data.local_results?.length ? res.data.local_results : (res.data.organic_results || []);
      for (const r of results) {
        if (typeof r !== 'object') continue;
        places.push({
          name: r.title || r.name || '',
          phone: r.phone || null,
          website: r.website || r.link || null,
          email: null,
          address: r.address || null,
          googleMapsLink: r.directions || r.maps_link || null,
          source: 'Google',
        });
      }
      console.log(`  Google Search → ${places.length} results`);
    } catch (e) {
      console.error('  Google search failed:', e.message);
    }
  }
  return places;
}

async function sourceJustDial(businessType, location) {
  const places = [];
  try {
    const city = location.split(',')[0].trim().toLowerCase().replace(/ /g, '-');
    const query = businessType.toLowerCase().replace(/ /g, '-');
    const url = `https://www.justdial.com/${city}/${query}`;
    const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const $ = cheerio.load(res.data);

    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html() || '');
        const items = Array.isArray(data) ? data : [data];
        const validTypes = ['LocalBusiness','MedicalBusiness','HealthAndBeautyBusiness','SportsActivityLocation','FoodEstablishment'];
        for (const item of items) {
          if (!validTypes.includes(item['@type'])) continue;
          const addr = item.address || {};
          places.push({
            name: item.name || null,
            phone: item.telephone || null,
            website: item.url || null,
            email: item.email || null,
            address: [addr.streetAddress, addr.addressLocality, addr.addressRegion].filter(Boolean).join(', '),
            googleMapsLink: null,
            source: 'JustDial',
          });
        }
      } catch (_) {}
    });

    if (!places.length) {
      $('li.cntanr, div.resultbox_info').each((_, card) => {
        const name = $(card).find('span.lng_cont_name, p.store-name, h2').first().text().trim();
        if (!name) return;
        places.push({
          name,
          phone: $(card).find('p.contact-info, span[class*="phone"]').first().text().trim() || null,
          website: null, email: null,
          address: $(card).find('span.cont_fl_addr, p.address').first().text().trim() || null,
          googleMapsLink: null,
          source: 'JustDial',
        });
      });
    }
    console.log(`  JustDial → ${places.length} results`);
  } catch (e) {
    console.error('  JustDial failed:', e.message);
  }
  return places;
}

async function sourceInstagram(businessType, location) {
  const places = [];
  try {
    const res = await axios.get('https://serpapi.com/search', {
      params: { q: `site:instagram.com ${businessType} ${location}`, api_key: SERPAPI_KEY, num: 10, hl: 'en', gl: 'in' },
      timeout: 15000,
    });
    for (const r of (res.data.organic_results || [])) {
      if (!r.link?.includes('instagram.com')) continue;
      places.push({
        name: r.title.replace(' • Instagram', '').split('(')[0].trim(),
        phone: null, website: null, email: null,
        address: location,
        googleMapsLink: null,
        instagram: r.link,
        source: 'Instagram',
      });
    }
    console.log(`  Instagram → ${places.length} results`);
  } catch (e) {
    console.error('  Instagram failed:', e.message);
  }
  return places;
}

async function sourceLinkedIn(businessType, location) {
  const places = [];
  try {
    const res = await axios.get('https://serpapi.com/search', {
      params: { q: `site:linkedin.com/company ${businessType} ${location}`, api_key: SERPAPI_KEY, num: 10, hl: 'en', gl: 'in' },
      timeout: 15000,
    });
    for (const r of (res.data.organic_results || [])) {
      if (!r.link?.includes('linkedin.com/company')) continue;
      places.push({
        name: r.title.replace(' | LinkedIn', '').trim(),
        phone: null, website: null, email: null,
        address: location,
        googleMapsLink: null,
        linkedin: r.link,
        source: 'LinkedIn',
      });
    }
    console.log(`  LinkedIn → ${places.length} results`);
  } catch (e) {
    console.error('  LinkedIn failed:', e.message);
  }
  return places;
}

async function sourceOSM(businessType, location) {
  const places = [];
  try {
    const [lat, lon] = await geocodeLocation(location);
    const key = businessType.toLowerCase().split(' ')[0];
    const tagList = BUSINESS_OSM_TAGS[key + 's'] || BUSINESS_OSM_TAGS[key] || [['amenity', key]];
    const nodeWays = tagList.map(([k, v]) =>
      `node["${k}"="${v}"](around:15000,${lat},${lon});way["${k}"="${v}"](around:15000,${lat},${lon});`
    ).join('');
    const query = `[out:json][timeout:30];(${nodeWays});out center tags;`;
    const res = await axios.post('https://overpass-api.de/api/interpreter',
      new URLSearchParams({ data: query }),
      { headers: { 'User-Agent': 'WebNestLeadAgent/1.0', 'Accept': 'application/json' }, timeout: 35000 }
    );
    for (const e of (res.data.elements || [])) {
      const tags = e.tags || {};
      const latE = e.lat || e.center?.lat;
      const lonE = e.lon || e.center?.lon;
      places.push({
        name: tags.name || null,
        phone: tags.phone || tags['contact:phone'] || null,
        website: tags.website || tags['contact:website'] || null,
        email: tags.email || tags['contact:email'] || null,
        address: [tags['addr:housenumber'], tags['addr:street'], tags['addr:city'], tags['addr:state']].filter(Boolean).join(', '),
        googleMapsLink: latE ? `https://www.openstreetmap.org/?mlat=${latE}&mlon=${lonE}` : null,
        source: 'OpenStreetMap',
      });
    }
    console.log(`  OSM → ${places.length} results`);
  } catch (e) {
    console.error('  OSM failed:', e.message);
  }
  return places;
}

async function enrichFromGoogleMaps(name, location) {
  try {
    const res = await axios.get('https://serpapi.com/search', {
      params: { engine: 'google_maps', q: `${name} ${location}`, api_key: SERPAPI_KEY, hl: 'en', gl: 'in', type: 'search' },
      timeout: 10000,
    });
    for (const r of (res.data.local_results || [])) {
      if (typeof r !== 'object') continue;
      if ((r.title || '').toLowerCase().includes(name.toLowerCase())) {
        return { phone: r.phone, address: r.address, website: r.website, googleMapsLink: r.directions || r.place_id_search };
      }
    }
  } catch (_) {}
  return {};
}

async function extractEmailFromPage(url) {
  try {
    const res = await axios.get(url, { headers: HEADERS, timeout: 10000 });
    const emails = res.data.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g);
    return emails ? emails[0] : null;
  } catch (_) { return null; }
}

async function extractSocialLinks(url) {
  const socials = { instagram: null, facebook: null };
  try {
    const res = await axios.get(url, { headers: HEADERS, timeout: 10000 });
    const $ = cheerio.load(res.data);
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!socials.instagram && href.includes('instagram.com')) socials.instagram = href;
      if (!socials.facebook && href.includes('facebook.com')) socials.facebook = href;
    });
  } catch (_) {}
  return socials;
}

async function checkWebsite(url) {
  const result = { exists: false, is_outdated: false, mobile_poor: false, broken: false };
  if (!url) return result;
  try {
    const res = await axios.get(url, { headers: HEADERS, timeout: 10000 });
    if (res.status >= 400) { result.broken = true; return result; }
    result.exists = true;
    const $ = cheerio.load(res.data);
    result.mobile_poor = !$('meta[name="viewport"]').length;
    result.is_outdated = $('table').length > 5 || res.data.substring(0, 500).toLowerCase().includes('transitional');
  } catch (_) { result.broken = true; }
  return result;
}

function scoreLead(websiteUrl, webStatus) {
  if (!websiteUrl || webStatus.broken)                          return ['HOT LEAD',    'No website or broken website'];
  if (webStatus.is_outdated && webStatus.mobile_poor)          return ['HOT LEAD',    'Website outdated and not mobile responsive'];
  if (webStatus.is_outdated)                                   return ['HOT LEAD',    'Website design is outdated'];
  if (webStatus.mobile_poor)                                   return ['MEDIUM LEAD', 'Website not mobile responsive'];
  return ['LOW LEAD', 'Website exists and appears modern'];
}

async function buildLead(place) {
  const website = place.website || '';
  const webStatus = await checkWebsite(website);
  const email = place.email || (webStatus.exists ? await extractEmailFromPage(website) : null);
  const socials = webStatus.exists ? await extractSocialLinks(website) : { instagram: null, facebook: null };
  const [leadScore, reason] = scoreLead(website, webStatus);
  return {
    businessName:    place.name || null,
    ownerName:       null,
    website:         website || null,
    instagram:       place.instagram || socials.instagram,
    facebook:        socials.facebook,
    linkedin:        place.linkedin || null,
    email,
    phone:           place.phone || null,
    address:         place.address || null,
    googleMapsLink:  place.googleMapsLink || null,
    source:          place.source || 'Unknown',
    websiteExists:   webStatus.exists,
    websiteOutdated: webStatus.is_outdated,
    mobilePoor:      webStatus.mobile_poor,
    leadScore,
    reason,
  };
}

async function* runSearch(businessType, location, maxLeads) {
  const ev = (data) => `data: ${JSON.stringify(data)}\n\n`;
  try {
    yield ev({ type: 'status', msg: `Searching ${businessType} in ${location}...`, step: 1 });

    let allPlaces = [];

    yield ev({ type: 'status', msg: 'Fetching from Google Maps...', step: 2 });
    allPlaces = allPlaces.concat(await sourceGoogle(businessType, location, maxLeads));

    yield ev({ type: 'status', msg: 'Fetching from JustDial...', step: 3 });
    allPlaces = allPlaces.concat(await sourceJustDial(businessType, location));

    yield ev({ type: 'status', msg: 'Fetching from Instagram...', step: 4 });
    allPlaces = allPlaces.concat(await sourceInstagram(businessType, location));

    yield ev({ type: 'status', msg: 'Fetching from LinkedIn...', step: 5 });
    allPlaces = allPlaces.concat(await sourceLinkedIn(businessType, location));

    yield ev({ type: 'status', msg: 'Fetching from OpenStreetMap...', step: 6 });
    allPlaces = allPlaces.concat(await sourceOSM(businessType, location));

    yield ev({ type: 'status', msg: `Processing ${allPlaces.length} raw results...`, step: 7 });

    const leads = [];
    const seen = new Set();

    for (const place of allPlaces) {
      if (leads.length >= maxLeads) break;
      const name = (place.name || '').trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());

      if (place.source === 'OpenStreetMap' && !place.phone) {
        const enriched = await enrichFromGoogleMaps(name, location);
        if (enriched) {
          place.phone          = place.phone          || enriched.phone;
          place.address        = place.address        || enriched.address;
          place.website        = place.website        || enriched.website;
          place.googleMapsLink = place.googleMapsLink || enriched.googleMapsLink;
        }
        await sleep(300);
      }

      const lead = await buildLead(place);
      leads.push(lead);
      yield ev({ type: 'lead', data: lead });
      await sleep(100);
    }

    yield ev({ type: 'done', total: leads.length });
  } catch (e) {
    yield `data: ${JSON.stringify({ type: 'error', msg: e.message })}\n\n`;
    yield `data: ${JSON.stringify({ type: 'done', total: 0 })}\n\n`;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { runSearch, sourceGoogle, sourceJustDial, sourceInstagram, sourceLinkedIn, sourceOSM, buildLead };
