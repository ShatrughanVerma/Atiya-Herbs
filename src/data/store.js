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
export const CLINICS = [
  {
    id: 'lucknow',
    name: 'AIHM Lucknow Clinic',
    area: 'Lucknow',
    address: '1st Floor, 264, KBS Spaces, Vijay Nagar, Krishna Nagar, Lucknow – 226023',
    city: 'Lucknow',
    state: 'Uttar Pradesh',
    lat: 26.8467,
    lng: 80.9462,
  },
  {id: 'karol-bagh', name: 'AIHM Karol Bagh Delhi Clinic', area: 'Delhi/NCR', city: 'Delhi', state: 'Delhi', lat: 28.6519, lng: 77.1909},
  {id: 'jaipur', name: 'AIHM Jaipur Clinic', area: 'Rajasthan/Jaipur', city: 'Jaipur', state: 'Rajasthan', lat: 26.9124, lng: 75.7873},
  {id: 'indore', name: 'AIHM Indore Clinic', area: 'MP/Indore', city: 'Indore', state: 'Madhya Pradesh', lat: 22.7196, lng: 75.8577},
  {id: 'ghaziabad', name: 'AIHM Ghaziabad Clinic', area: 'Ghaziabad', city: 'Ghaziabad', state: 'Uttar Pradesh', lat: 28.6692, lng: 77.4538},
  {id: 'hyderabad', name: 'AIHM Hyderabad Clinic', area: 'Hyderabad', city: 'Hyderabad', state: 'Telangana', lat: 17.385, lng: 78.4867},
  {id: 'ahmedabad', name: 'AIHM Ahmedabad Clinic', area: 'Gujarat', city: 'Ahmedabad', state: 'Gujarat', lat: 23.0225, lng: 72.5714},
  {id: 'ludhiana', name: 'AIHM Ludhiana Clinic', area: 'Punjab', city: 'Ludhiana', state: 'Punjab', lat: 30.901, lng: 75.8573},
  {id: 'reay-road', name: 'AIHM Reay Road Mumbai Clinic', area: 'Mumbai', city: 'Mumbai', state: 'Maharashtra', lat: 18.9772, lng: 72.8447},
  // TODO: confirm the Bihar clinic's name and city (coordinates are Patna's)
  {id: 'bihar', name: 'Bihar', area: 'Bihar', city: null, state: 'Bihar', lat: 25.5941, lng: 85.1376},
];

export const SOCIAL = [
  {id: 'facebook', icon: 'facebook', color: '#1877F2', url: 'https://www.facebook.com/hakeemsulemankhan'},
  {id: 'instagram', icon: 'instagram', color: '#E4405F', url: 'https://www.instagram.com/hakim_sulemankhan/'},
  {id: 'youtube', icon: 'youtube', color: '#FF0000', url: 'https://www.youtube.com/c/atiyaherbs'},
  {id: 'x', label: 'X', color: '#000000', url: 'https://x.com/hakimsulemank'},
  {id: 'linkedin', icon: 'linkedin', color: '#0A66C2', url: 'https://www.linkedin.com/company/aatiya-healthcare-pvt-ltd/'},
];
