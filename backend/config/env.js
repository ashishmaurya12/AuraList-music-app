const KNOWN_PLACEHOLDER_SECRETS = [
  'your_long_random_jwt_secret_key_minimum_32_characters_here',
  'your_super_secret_jwt_key_at_least_32_characters',
  'change_this_secret_in_production_at_least_32_chars',
  'default_development_secret_key_must_be_changed',
  'your_jwt_secret_must_be_at_least_32_characters_long'
];

const validateEnv = () => {
  const missing = [];
  const errors = [];

  const jwt = process.env.JWT_SECRET ? process.env.JWT_SECRET.trim() : '';

  if (!jwt) {
    missing.push('JWT_SECRET');
  } else if (jwt.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters long for adequate security.');
  } else {
    const lower = jwt.toLowerCase();
    const isPlaceholder = KNOWN_PLACEHOLDER_SECRETS.some(p => lower === p.toLowerCase()) ||
      lower.includes('your_long_random_jwt_secret') ||
      lower.includes('your_super_secret_jwt_key') ||
      lower.includes('change_this_secret');
    if (isPlaceholder) {
      errors.push('JWT_SECRET contains an unconfigured example or placeholder secret. Please generate a strong random secret.');
    }
  }

  if (!process.env.MONGODB_URI || !process.env.MONGODB_URI.trim()) {
    missing.push('MONGODB_URI');
  }

  const jamendo = process.env.JAMENDO_CLIENT_ID ? process.env.JAMENDO_CLIENT_ID.trim() : '';
  if (jamendo) {
    const jamLower = jamendo.toLowerCase();
    const isJamendoPlaceholder =
      jamLower.includes('your_jamendo_client_id') ||
      jamLower.includes('placeholder') ||
      jamLower === 'client_id_here' ||
      jamLower === 'test_client_id';
    if (isJamendoPlaceholder) {
      if (process.env.NODE_ENV === 'production') {
        errors.push('JAMENDO_CLIENT_ID contains an unconfigured placeholder. Provide a valid client ID or leave it empty to disable Jamendo.');
      } else {
        console.warn('⚠️ [Config] JAMENDO_CLIENT_ID contains a placeholder. Jamendo integration will remain disabled.');
      }
    }
  }

  if (missing.length > 0 || errors.length > 0) {
    console.error(`=================================================`);
    console.error(`  ❌ FATAL CONFIGURATION ERROR:`);
    if (missing.length > 0) {
      console.error(`  Missing required environment variable(s): ${missing.join(', ')}`);
    }
    errors.forEach(e => console.error(`  ${e}`));
    console.error(`  Please define these variables in your .env file or environment.`);
    console.error(`=================================================`);
    process.exit(1);
  }
};

const getJwtSecret = () => {
  if (!process.env.JWT_SECRET || !process.env.JWT_SECRET.trim()) {
    throw new Error('JWT_SECRET environment variable is missing or empty.');
  }
  return process.env.JWT_SECRET.trim();
};

module.exports = {
  validateEnv,
  getJwtSecret
};
