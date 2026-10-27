// Names of the simulated contacts and their villages in each language.
// The database rows hold Bangla only (sql/001 seed); the app shows them in the farmer's language.
export const SIM_NAMES = {
  'ডা. অমিত সেন (পশু চিকিৎসক)': { bn: 'ডা. অমিত সেন (পশু চিকিৎসক)', hi: 'डॉ. अमित सेन (पशु चिकित्सक)', en: 'Dr. Amit Sen (Vet)' },
  'রহমান স্টোর': { bn: 'রহমান স্টোর', hi: 'रहमान स्टोर', en: 'Rahman Store' },
  'নিউ মা তারা ভ্যারাইটি': { bn: 'নিউ মা তারা ভ্যারাইটি', hi: 'न्यू मा तारा वैरायटी', en: 'New Ma Tara Variety' },
  'হোটেল সোনার বাংলা': { bn: 'হোটেল সোনার বাংলা', hi: 'होटल सोनार बांग्ला', en: 'Hotel Sonar Bangla' },
  'বোলপুর': { bn: 'বোলপুর', hi: 'बोलपुर', en: 'Bolpur' },
  'শান্তিনিকেতন': { bn: 'শান্তিনিকেতন', hi: 'शांतिनिकेतन', en: 'Santiniketan' },
};

// Adds { names, villages } in three languages to a contact row (null when not known).
export function withNames(contact) {
  if (!contact) return null;
  return { ...contact, names: SIM_NAMES[contact.name] || null, villages: SIM_NAMES[contact.village] || null };
}

export const nameIn = (contact, lang) => contact?.names?.[lang] || SIM_NAMES[contact?.name]?.[lang] || contact?.name || '';
