// Ensure test environment variables are set BEFORE any module imports
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_key_1234567890123456';
process.env.MONGODB_TEST_URI = process.env.MONGODB_TEST_URI || 'mongodb://127.0.0.1:27017/auralist_test';
process.env.MONGODB_URI = process.env.MONGODB_TEST_URI;
