## ❌ Field Validation Errors

The following fields have validation errors that need to be corrected:

<% invalidFields.forEach(function(field) { %>
### Field: \`<%= field.path %>\`
**Error**: <%= field.error %>

<% }); %>

Please provide valid values for these fields and try again.

---
**Tips for fixing validation errors:**
- Check required fields are not empty
- Verify email addresses are properly formatted
- Ensure numbers are within allowed ranges
- Check text length meets minimum/maximum requirements
- Verify patterns match expected formats (phone numbers, postal codes, etc.)