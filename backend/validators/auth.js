const { z } = require('zod');

const registerSchema = z.object({
  name: z.string({ required_error: 'Name is required.' })
    .trim()
    .min(2, 'Name must be at least 2 characters.')
    .max(100, 'Name must not exceed 100 characters.'),
  email: z.string({ required_error: 'Email is required.' })
    .trim()
    .toLowerCase()
    .email('Invalid email address.')
    .max(255, 'Email must not exceed 255 characters.'),
  password: z.string({ required_error: 'Password is required.' })
    .min(8, 'Password must contain at least 8 characters.')
    .max(128, 'Password exceeds maximum length of 128 characters.')
}).strict();

const loginSchema = z.object({
  email: z.string({ required_error: 'Email is required.' })
    .trim()
    .toLowerCase()
    .email('Invalid email address.')
    .max(255, 'Email must not exceed 255 characters.'),
  password: z.string({ required_error: 'Password is required.' })
    .min(1, 'Password is required.')
    .max(128, 'Password exceeds maximum length of 128 characters.')
}).strict();

const updateProfileSchema = z.object({
  name: z.string({ required_error: 'Name is required.' })
    .trim()
    .min(2, 'Name must be at least 2 characters.')
    .max(100, 'Name must not exceed 100 characters.')
}).strict();

const updatePasswordSchema = z.object({
  currentPassword: z.string({ required_error: 'Current password is required.' })
    .min(1, 'Current password is required.')
    .max(128, 'Password exceeds maximum length.'),
  newPassword: z.string({ required_error: 'New password is required.' })
    .min(8, 'New password must contain at least 8 characters.')
    .max(128, 'New password exceeds maximum length of 128 characters.')
}).strict();

module.exports = {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  updatePasswordSchema
};
