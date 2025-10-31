Cannot submit the form due to the following reasons:
<% validationErrors.forEach(function(error) { %>
 - <% if (error.label && error.path) { %>**<%= error.label %> (<%= error.path %>)**: <% } %><%= error.message %><% }); %>

These validation errors are in one of the following format:
 - **Field Label (data_path)** - Error message:  If the error is attributed to a specific field value.
 - Error message:  If the error is a general error that is not specific to a field value.
