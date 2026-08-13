/* Harrison Hot Springs family activity catalogue.
   Same schema as vancouver-guide.js on purpose, so Explore can render either
   leg's catalogue through one card renderer. Research refreshed 2026-08-13
   from official BC Parks, Tourism Harrison, and operator sources.
   'placeQuery' addresses are the real ones already saved as activities in
   the live database (via trip_planner_add_activity) — reused here rather
   than re-geocoded, so a scheduled card routes to the same pin either way. */
'use strict';

window.HARRISON_GUIDE = Object.freeze([
  {
    id: 'harrison-mineral-baths', rank: 1, icon: '♨️', name: 'Harrison Mineral Baths',
    aliases: ['Harrison Hot Springs Public Mineral Pool'], placeQuery: '101 Hot Springs Rd, Harrison Hot Springs, BC V0M 1K0, Canada',
    category: 'attraction', area: 'Village lakefront', duration: '45–90 min', cost: '$', weather: 'mixed',
    filters: ['rain'],
    why: 'The classic Harrison thing to do: a public mineral hot pool right in the village, indoors-adjacent so weather matters less.',
    current: 'Closed for renovations as of spring 2026 with no confirmed reopening date. Call the resort (604-796-2244 ext. 5) before counting on this — it may still be closed during your stay.',
    booking: 'Confirm it has reopened before building a day around it.', pair: 'Visitor Centre and Sasquatch Museum, or a lakefront walk',
    sourceUrl: 'https://tourismharrison.com/explore/harrison-river-valley/our-region/our-hot-springs/', sourceLabel: 'Tourism Harrison hot springs info',
  },
  {
    id: 'harrison-watersports', rank: 2, icon: '🛟', name: 'Harrison WaterSports and Waterpark',
    aliases: ['Harrison WaterSports and Waterpark', 'Harrison Water Park'], placeQuery: '100 Esplanade Ave, Harrison Hot Springs, BC V0M 1K0, Canada',
    category: 'outdoor', area: 'Lakefront', duration: '1.5 hr session', cost: '$$', weather: 'sunny',
    filters: ['top', 'outdoor'],
    why: 'A giant floating inflatable obstacle course on the lake — the single biggest-energy outdoor activity in Harrison.',
    current: 'Ages 6 and up; ages 6–9 need paid adult supervision on the course. Open daily June 20–Sept 6, 2026.',
    booking: 'Sessions run 1.5 hours — go earlier in the day when energy is highest.', pair: 'Harrison Lagoon beach right next door',
    sourceUrl: 'https://harrisonwatersports.com/our-activities/harrison-lake-inflatable-water-park/', sourceLabel: 'Harrison WaterSports official info',
  },
  {
    id: 'sasquatch-hicks-lake', rank: 3, icon: '🏞️', name: 'Sasquatch Provincial Park — Hicks Lake',
    aliases: ['Sasquatch Provincial Park', 'Hicks Lake'], placeQuery: 'Rockwell Dr, Harrison Hot Springs, BC V0M 1A0, Canada',
    category: 'outdoor', area: '20 min north', duration: '2–3 hr', cost: 'Free', weather: 'sunny',
    filters: ['top', 'free', 'outdoor'],
    why: 'A sandy lake beach with short, flat family trails — a calmer, less crowded swim than the village lagoon.',
    booking: 'Day-use is generally free; a parking fee can apply in peak season, confirm at BC Parks.', pair: 'A picnic lunch at the day-use area',
    sourceUrl: 'https://bcparks.ca/sasquatch-park/', sourceLabel: 'BC Parks official page',
  },
  {
    id: 'kilby-historic-site', rank: 4, icon: '🚜', name: 'Kilby Historic Site',
    aliases: ['Kilby Historic Site', 'Kilby Farm'], placeQuery: '215 Kilby Rd, Harrison Mills, BC V0M 1L0, Canada',
    category: 'attraction', area: 'Harrison Mills, ~20 min', duration: '1.5–2.5 hr', cost: '$$', weather: 'mixed',
    filters: ['top'],
    why: 'Farm animals and a hands-on 1920s general store aimed squarely at this age — a real change of pace from lake and beach days.',
    current: 'Summer 2026 hours (Jun 25–Sep 7) are Thu–Mon 10am–4pm, so it’s open every day of your Harrison stay. Adult $16, youth (6–16) $11, family (2+2) $42.',
    booking: 'Last admission is 30 minutes before closing.', pair: 'Nothing nearby — treat it as its own outing',
    sourceUrl: 'https://kilby.ca/visit/hours-fees/', sourceLabel: 'Kilby hours + fees',
  },
  {
    id: 'bridal-veil-falls', rank: 5, icon: '💦', name: 'Bridal Veil Falls Provincial Park',
    aliases: ['Bridal Veil Falls Provincial Park', 'Bridal Veil Falls'], placeQuery: 'Page Rd, Bridal Falls, BC V0X 1X1, Canada',
    category: 'outdoor', area: '25 min south, near Chilliwack', duration: '30–45 min', cost: 'Free', weather: 'dry',
    filters: ['free', 'outdoor'],
    why: 'A short, well-groomed trail to a big, dramatic waterfall — high payoff for very little walking, good for a half-morning.',
    booking: 'The loop to the viewing platform is about 30 minutes return.', pair: 'Minter Country Garden, a few minutes further on',
    sourceUrl: 'https://bcparks.ca/bridal-veil-falls-park/', sourceLabel: 'BC Parks official page',
  },
  {
    id: 'minter-country-garden', rank: 6, icon: '🌷', name: 'Minter Country Garden',
    aliases: ['Minter Country Garden'], placeQuery: '10015 Young Rd, Chilliwack, BC V2P 8C3, Canada',
    category: 'attraction', area: '30 min, Chilliwack', duration: '1–2 hr', cost: '$', weather: 'mixed',
    filters: [],
    why: 'Gardens with a cafe, an easy pairing with Bridal Veil Falls on the same drive.',
    current: 'A dedicated kids’ play area is mentioned in older listings but wasn’t independently confirmed in 2026 research — check when you arrive rather than promising it.',
    booking: 'Store hours: Mon–Sat 9am–5pm, Sun/holidays 10am–4pm.', pair: 'Bridal Veil Falls on the way back',
    sourceUrl: 'https://mintergardening.com/', sourceLabel: 'Minter Country Garden official site',
  },
  {
    id: 'harrison-visitor-centre', rank: 7, icon: '🦶', name: 'Harrison Visitor Centre and Sasquatch Museum',
    aliases: ['Harrison Visitor Centre and Sasquatch Museum', 'Sasquatch Museum'], placeQuery: '499 Hot Springs Rd, Harrison Hot Springs, BC V0M 1K0, Canada',
    category: 'attraction', area: 'Village', duration: '30–45 min', cost: 'Free', weather: 'indoors',
    filters: ['rain', 'free'],
    why: 'A free, fully accessible indoor break with interactive displays, Sts’ailes stories and an 8-foot Sasquatch photo stop.',
    booking: 'Open 7 days a week; a good rainy-morning first stop.', pair: 'Mineral Baths (if reopened) or a lakefront walk',
    sourceUrl: 'https://tourismharrison.com/listing/visitor-centre-sasquatch-museum/', sourceLabel: 'Tourism Harrison listing',
  },
  {
    id: 'spirit-trail', rank: 8, icon: '🌲', name: 'Spirit Trail',
    aliases: ['Spirit Trail'], placeQuery: 'Harrison Hot Springs, BC V0M 1K0, Canada',
    category: 'outdoor', area: 'Village edge', duration: '30 min', cost: 'Free', weather: 'dry',
    filters: ['free', 'outdoor'],
    why: 'An easy 1.1 km cedar-forest loop dotted with dozens of carved tree masks — turn it into a scavenger hunt rather than a hike.',
    booking: 'Optional if beach and pool time already fill the day.', pair: 'Harrison Lagoon or the Pirate Playground',
    sourceUrl: 'https://tourismharrison.com/', sourceLabel: 'Tourism Harrison trail info',
  },
  {
    id: 'harrison-lagoon', rank: 9, icon: '🏖️', name: 'Harrison Lagoon',
    aliases: ['Harrison Lagoon'], placeQuery: 'Lagoon, Harrison, Harrison Hot Springs, BC V0M 1K0, Canada',
    category: 'outdoor', area: 'Main lakefront drag', duration: '1–3 hr', cost: 'Free', weather: 'sunny',
    filters: ['top', 'free', 'outdoor'],
    why: 'A sandy, shallow, warm lagoon right on the main strip — the easy default beach stop.',
    current: 'The Vancouver Airbnb has beach gear; this one doesn’t. Bring your own chairs and sand toys.',
    booking: 'Shallow and warm enough for confident wading at six.', pair: 'Harrison Beach Pirate Playground, right beside it',
    sourceUrl: 'https://tourismharrison.com/', sourceLabel: 'Tourism Harrison beaches',
  },
  {
    id: 'harrison-pirate-playground', rank: 10, icon: '🏴‍☠️', name: 'Harrison Beach Pirate Playground + Playboxes',
    aliases: ['Harrison Beach Pirate Playground + Playboxes', 'Pirate Playground'], placeQuery: '234 Esplanade Ave, Harrison Hot Springs, BC V0M 1K0, Canada',
    category: 'outdoor', area: 'Beachfront', duration: '30–60 min', cost: 'Free', weather: 'sunny',
    filters: ['top', 'free', 'outdoor'],
    why: 'An inclusive beachfront playground right beside the sand, plus free Playbox balls and games — an easy drop-in between swims.',
    booking: 'Seasonal washrooms and outdoor showers are nearby.', pair: 'Harrison Lagoon, right next to it',
    sourceUrl: 'https://tourismharrison.com/', sourceLabel: 'Tourism Harrison beaches',
  },
]);
