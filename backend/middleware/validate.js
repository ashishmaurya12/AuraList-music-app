/**
 * Express middleware to validate request data using Zod schemas
 * @param {import('zod').ZodSchema} schema - The Zod schema to parse against
 * @param {'body' | 'params' | 'query'} source - Request property to validate (default: 'body')
 */
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const dataToValidate = req[source] || {};
    const result = schema.safeParse(dataToValidate);

    if (!result.success) {
      const issues = result.error.issues || result.error.errors || [];
      const details = issues.map(err => ({
        field: err.path.length > 0 ? err.path.join('.') : source,
        message: err.message
      }));


      // Return explicit error message for playlist ID or resource ID errors when requested via params
      if (source === 'params' && details.some(d => d.message === 'Invalid ID')) {
        return res.status(400).json({
          error: req.params && req.params.id ? 'Invalid playlist ID.' : 'Invalid ID.',
          details
        });
      }

      return res.status(400).json({
        error: 'Validation failed.',
        details
      });
    }

    // Replace request value with validated/transformed data
    req[source] = result.data;
    next();
  };
};

module.exports = validate;
