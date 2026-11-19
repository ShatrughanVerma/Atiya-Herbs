// Contact details and links taken from www.atiyaherbs.com.
const SITE = 'https://www.atiyaherbs.com';

export const CONTACT = {
  phone: '011 4000 7716',
  phoneUrl: 'tel:01140007716',
  whatsapp: '+91 99109 98460',
  whatsappUrl: 'https://wa.me/919910998460?text=Hi%20Atiya%20Herbs%2C%20I%20need%20advice%20for%20',
  email: 'helpdesk@atiyaherbs.com',
  emailUrl: 'mailto:helpdesk@atiyaherbs.com',
};

export const PAGES = {
  website: SITE,
  clinics: `${SITE}/pages/clinics`,
  expertAdvice: `${SITE}/pages/expert-advice`,
  sulemaniNuskhe: `${SITE}/pages/sulemani-nuskhe`,
  patientSpeaks: `${SITE}/pages/patient-speaks`,
  about: `${SITE}/pages/about-atiya-herbs`,
  hakeem: `${SITE}/pages/hakeem-suleman-khan`,
  franchise: `${SITE}/pages/franchise`,
  privacy: `${SITE}/pages/privacy-policy`,
  refund: `${SITE}/pages/refund-policy`,
  returns: `${SITE}/pages/return-and-replacement`,
  terms: `${SITE}/pages/terms-conditions`,
};

// AIHM clinics. `area` is the label shown in the list; city/state are matched against an entered
// pincode, and lat/lng sort the list by distance from the user.
// lat/lng are city-centre approximations (accurate enough to pick the nearest city).
// TODO: replace with each clinic's exact coordinates, and add address, phone and timings
// address = shown to people (as on the website); mapQuery = a short clean version for Google Maps to search, because
// words like "2nd Floor, Above KIA Showroom" stop Google from finding the place.
// Addresses are the ones published at atiyaherbs.com/pages/clinics. lat/lng are the clinic's AREA (found by
// OpenStreetMap from that address, usually within about 1 km), so distances are close but not door-to-door;
// the Directions and map buttons use the full address, which Google Maps places exactly.
export const CLINICS = [
  {
    id: 'lucknow',
    mapQuery: 'KBS Spaces, 264 Vijay Nagar, Krishna Nagar, Lucknow 226023',
    name: 'AIHM Lucknow Clinic',
    area: 'Lucknow',
    address: '1st Floor, 264, KBS Spaces, Vijay Nagar, Krishna Nagar, Lucknow – 226023',
    city: 'Lucknow',
    state: 'Uttar Pradesh',
    lat: 26.794391,
    lng: 80.891762,
  },
  {
    id: 'karol-bagh',
    mapQuery: '65/9 New Rohtak Road, Karol Bagh, Delhi 110005',
    name: 'AIHM Karol Bagh Delhi Clinic',
    area: 'Delhi/NCR',
    address: 'AIHM, 2nd Floor, Above KIA Showroom, 65/9 New Rohtak Road, Karol Bagh, Near Jeevan Mala Hospital, Delhi – 110005',
    city: 'Delhi',
    state: 'Delhi',
    // Karol Bagh Metro Station: the geocoder put New Rohtak Road's far end (about 3.6 km away) for this address
    lat: 28.644199,
    lng: 77.188947,
  },
  {
    id: 'jaipur',
    mapQuery: 'Hawa Sarak, Civil Lines, Jaipur 302006',
    name: 'AIHM Jaipur Clinic',
    area: 'Rajasthan/Jaipur',
    address: 'Ground Floor, 04, Hawa Sarak, Civil Lines, Opposite Sodala Police Thana, Jaipur, Rajasthan – 302006',
    city: 'Jaipur',
    state: 'Rajasthan',
    lat: 26.909678,
    lng: 75.781249,
  },
  {
    id: 'indore',
    mapQuery: 'Classic Center, 575 MG Road, Indore 452003',
    name: 'AIHM Indore Clinic',
    area: 'MP/Indore',
    address: '102, First Floor, Classic Center, 575, MG Road, Opposite TI Mall, Indore, Madhya Pradesh – 452003',
    city: 'Indore',
    state: 'Madhya Pradesh',
    lat: 22.729321,
    lng: 75.873353,
  },
  {
    id: 'ghaziabad',
    mapQuery: 'G-4, Rakesh Marg, Nehru Nagar, Ghaziabad',
    name: 'AIHM Ghaziabad Clinic',
    area: 'Ghaziabad',
    address: 'Building Number 3, G-4, Rakesh Marg, Nehru Nagar, Ghaziabad',
    city: 'Ghaziabad',
    state: 'Uttar Pradesh',
    lat: 28.654359,
    lng: 77.448451,
  },
  {
    id: 'hyderabad',
    mapQuery: '5-9-62 Khan Lateef Khan Estate, LB Stadium Road, Fateh Maidan, Abids, Hyderabad 500001',
    name: 'AIHM Hyderabad Clinic',
    area: 'Hyderabad',
    address: '1st Floor, 5-9-62, Khan Lateef Khan Estate, LB Stadium Road, Fateh Maidan, Abids, Hyderabad – 500001',
    city: 'Hyderabad',
    state: 'Telangana',
    lat: 17.389478,
    lng: 78.477182,
  },
  {
    id: 'ahmedabad',
    mapQuery: 'Prism Mall, Kankariya Road, Maninagar, Ahmedabad 380022',
    name: 'AIHM Ahmedabad Clinic',
    area: 'Gujarat',
    address: '303, 3rd Floor, Prism Mall, Kankariya Road, Shahalam Tolnaka, Kankaria, Maninagar, Ahmedabad, Gujarat – 380022',
    city: 'Ahmedabad',
    state: 'Gujarat',
    lat: 23.015457,
    lng: 72.607002,
  },
  {
    id: 'ludhiana',
    mapQuery: '258 AX, Shastri Nagar, Model Town Extension, Ludhiana 141002',
    name: 'AIHM Ludhiana Clinic',
    area: 'Punjab',
    address: '258 AX, Shastri Nagar, Model Town Extension, Model Town, near Tuition Market Lane and Krishna Mandir Road, Ludhiana, Punjab – 141002',
    city: 'Ludhiana',
    state: 'Punjab',
    lat: 30.888444,
    lng: 75.840396,
  },
  {
    id: 'reay-road',
    mapQuery: 'Kaif Tower, Tank Bunder Road, Reay Road Station, Mumbai 400010',
    name: 'AIHM Reay Road Mumbai Clinic',
    area: 'Mumbai',
    address: 'Tank Bunder Road, Kaif Tower, Shop No. 5, Reay Road Station (W), Mumbai – 400010',
    city: 'Mumbai',
    state: 'Maharashtra',
    lat: 18.977551,
    lng: 72.844101,
  },
  {
    id: 'kolkata',
    mapQuery: '224 A AJC Bose Road, Kolkata 700017',
    name: 'AIHM Kolkata Clinic',
    area: 'West Bengal/Kolkata',
    address: '10th Floor, 1012, Krishna Building, 224 A, AJC Bose Road, Kolkata – 700017 (opposite La Martiniere school)',
    city: 'Kolkata',
    state: 'West Bengal',
    lat: 22.550451,
    lng: 88.362904,
  },
  {
    id: 'bangalore',
    mapQuery: '649 Art Arcade, Koramangala 6th Block, Bangalore',
    name: 'AIHM Bangalore Clinic',
    area: 'Karnataka/Bangalore',
    address: '#649, Art Arcade, 2nd Floor, Sony Signal, Koramangala 6th Block, Bangalore (above Giva gold and silver showroom)',
    city: 'Bangalore',
    state: 'Karnataka',
    lat: 12.939026,
    lng: 77.623848,
  },
  // TODO: the website does not list a Bihar clinic. Confirm its name, address and city (coordinates are Patna's)
  {id: 'bihar', name: 'Bihar', area: 'Bihar', city: null, state: 'Bihar', lat: 25.5941, lng: 85.1376},
];

export const SOCIAL = [
  {id: 'facebook', icon: 'facebook', color: '#1877F2', url: 'https://www.facebook.com/hakeemsulemankhan'},
  {id: 'instagram', icon: 'instagram', color: '#E4405F', url: 'https://www.instagram.com/hakim_sulemankhan/'},
  {id: 'youtube', icon: 'youtube', color: '#FF0000', url: 'https://www.youtube.com/c/atiyaherbs'},
  {id: 'x', label: 'X', color: '#000000', url: 'https://x.com/hakimsulemank'},
  {id: 'linkedin', icon: 'linkedin', color: '#0A66C2', url: 'https://www.linkedin.com/company/aatiya-healthcare-pvt-ltd/'},
];
