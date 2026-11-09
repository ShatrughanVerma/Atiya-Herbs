// The patient id that staff read out and search by: a short running number written as P000123.
// (The long id inside the database stays the real key.)
const formatPatientCode = patientNo => (Number.isInteger(patientNo) && patientNo > 0 ? `P${String(patientNo).padStart(6, '0')}` : null);

// "P000123", "p123" -> 123; anything else -> null
const parsePatientCode = text => {
  const match = /^p0*(\d{1,9})$/i.exec(String(text ?? '').trim());
  return match ? Number(match[1]) : null;
};

module.exports = {formatPatientCode, parsePatientCode};
