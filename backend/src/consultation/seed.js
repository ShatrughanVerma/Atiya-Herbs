// Clinics (the real AIHM list the app already shows) and, only when asked, PLACEHOLDER doctors for testing the
// booking flow. Real doctors, photos, fees and timings must be entered by the company before launch.

const CLINICS = [
  {id: 'lucknow', name: 'AIHM Lucknow Clinic', area: 'Lucknow', city: 'Lucknow', state: 'Uttar Pradesh', address: '1st Floor, 264, KBS Spaces, Vijay Nagar, Krishna Nagar, Lucknow - 226023', lat: 26.8467, lng: 80.9462},
  {id: 'karol-bagh', name: 'AIHM Karol Bagh Delhi Clinic', area: 'Delhi/NCR', city: 'Delhi', state: 'Delhi', lat: 28.6519, lng: 77.1909},
  {id: 'jaipur', name: 'AIHM Jaipur Clinic', area: 'Rajasthan/Jaipur', city: 'Jaipur', state: 'Rajasthan', lat: 26.9124, lng: 75.7873},
  {id: 'indore', name: 'AIHM Indore Clinic', area: 'MP/Indore', city: 'Indore', state: 'Madhya Pradesh', lat: 22.7196, lng: 75.8577},
  {id: 'ghaziabad', name: 'AIHM Ghaziabad Clinic', area: 'Ghaziabad', city: 'Ghaziabad', state: 'Uttar Pradesh', lat: 28.6692, lng: 77.4538},
  {id: 'hyderabad', name: 'AIHM Hyderabad Clinic', area: 'Hyderabad', city: 'Hyderabad', state: 'Telangana', lat: 17.385, lng: 78.4867},
  {id: 'ahmedabad', name: 'AIHM Ahmedabad Clinic', area: 'Gujarat', city: 'Ahmedabad', state: 'Gujarat', lat: 23.0225, lng: 72.5714},
  {id: 'ludhiana', name: 'AIHM Ludhiana Clinic', area: 'Punjab', city: 'Ludhiana', state: 'Punjab', lat: 30.901, lng: 75.8573},
  {id: 'reay-road', name: 'AIHM Reay Road Mumbai Clinic', area: 'Mumbai', city: 'Mumbai', state: 'Maharashtra', lat: 18.9772, lng: 72.8447},
];

// Mon-Sat, two sessions a day, 20-minute slots
const WEEK = [1, 2, 3, 4, 5, 6].flatMap(weekday => [
  {weekday, startTime: '10:00', endTime: '13:00', slotMinutes: 20},
  {weekday, startTime: '17:00', endTime: '20:00', slotMinutes: 20},
]);

// The doctors shown in the approved app design. Only what the design shows is filled in (name, qualifications,
// system, focus, years, rating, languages, clinic, fee); the concerns, bio, photo and timetable are first guesses
// for the company to correct. Safe to run again: an existing doctor is left as it is.
const DOCTORS = [
  {id: 'dr-zafar-siddiqui', clinicId: 'lucknow', name: 'Dr. Zafar Siddiqui', qualifications: 'BUMS, MD (Unani)', system: 'Unani', specialization: 'Digestive wellness', concerns: ['General Wellness', 'Gut Health', 'Acidity', 'Liver Care'], experienceYears: 0, languages: 'Hindi, Urdu, English', fee: 300, rating: 5, reviewCount: 0, modes: ['text', 'audio', 'video', 'clinic']},
  {id: 'dr-surendra-sharma', clinicId: 'karol-bagh', name: 'Dr. Surendra Sharma', qualifications: 'BUMS', system: 'Unani', specialization: 'Joint & Mobility', concerns: ['Joint & Mobility', 'General Wellness'], experienceYears: 18, languages: 'Hindi, English, Urdu', fee: 300, rating: 4.9, reviewCount: 0, modes: ['text', 'audio', 'video', 'clinic']},
  {id: 'dr-vishal', clinicId: 'jaipur', name: 'Dr. Vishal', qualifications: 'BAMS', system: 'Ayurveda', specialization: 'Skin & Hair', concerns: ['Skin & Hair', 'General Wellness'], experienceYears: 11, languages: 'Hindi, English, Rajasthani', fee: 300, rating: 5, reviewCount: 0, modes: ['text', 'audio', 'video', 'clinic']},
];

const PLACEHOLDER_DOCTORS = [
  {id: 'sample-doctor-one', clinicId: 'lucknow', name: 'Sample Doctor One', system: 'Unani', concerns: ['General Wellness', 'Gut Health'], specialization: 'General Physician', qualifications: 'Placeholder', experienceYears: 10, fee: 300, rating: 4.5, reviewCount: 10, modes: ['text', 'audio', 'video', 'clinic'], bio: 'Placeholder doctor for testing. Replace with a real doctor.'},
  {id: 'sample-doctor-two', clinicId: 'karol-bagh', name: 'Sample Doctor Two', system: 'Ayurveda', concerns: ['Joint & Mobility'], specialization: 'Joint & Bone Care', qualifications: 'Placeholder', experienceYears: 8, fee: 400, rating: 4.2, reviewCount: 5, modes: ['text', 'video', 'clinic'], bio: 'Placeholder doctor for testing. Replace with a real doctor.'},
];

async function seedClinics(prisma) {
  for (const clinic of CLINICS) {
    const existing = await prisma.clinic.findUnique({where: {id: clinic.id}});
    // an existing clinic keeps what was typed in later (phone, timings, ...): only a missing one is created
    if (!existing) {
      await prisma.clinic.create({data: clinic});
    }
  }
  return {clinics: CLINICS.length};
}

async function seedDoctors(prisma, list = DOCTORS) {
  let created = 0;
  for (const doctor of list) {
    if (!(await prisma.doctor.findUnique({where: {id: doctor.id}}))) {
      await prisma.doctor.create({data: doctor});
      await prisma.doctorSchedule.createMany({data: WEEK.map(slot => ({...slot, doctorId: doctor.id}))});
      created += 1;
    }
  }
  return {doctors: created};
}

const seedPlaceholderDoctors = prisma => seedDoctors(prisma, PLACEHOLDER_DOCTORS);

module.exports = {CLINICS, DOCTORS, seedClinics, seedDoctors, seedPlaceholderDoctors};
