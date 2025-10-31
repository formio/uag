## ❌ Field Validation Errors

The following fields have validation errors that need to be corrected:
<% invalidFields.forEach(function(field) { %>
 - **<%= field.label %> (<%= field.path %>)**: <%= field.error %><% }); %>

Please provide valid values for these fields and try again.